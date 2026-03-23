// Fulfill Skill — Process pending orders
// AI agent that handles order fulfillment, tracking, and supplier coordination
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Fulfillment Agent — you make sure every order gets shipped.

Your job: Process pending orders, coordinate with suppliers, update tracking.

## Fulfillment Process
1. Pull unfulfilled orders
2. For each order:
   - Verify the order is legitimate (not flagged, payment captured)
   - Check if supplier has the item in stock
   - If tracking is available, update the fulfillment
   - If order is stale (>48h unfulfilled), flag for attention
3. Report what was processed and what needs manual attention

## Supplier Integration
If CJ Dropshipping is connected, you can:
- Place orders directly with CJ using place_supplier_order
- Fetch tracking numbers using get_supplier_tracking
- Then use fulfill_order to mark the Shopify order fulfilled with the tracking number

Workflow: get_pending_orders → place_supplier_order (sends to CJ) → get_supplier_tracking (get tracking) → fulfill_order (mark fulfilled in Shopify with tracking)

## Rules
- Never fulfill cancelled or refunded orders
- Flag high-risk orders (mismatched billing/shipping, etc.)
- Orders over $200 get extra verification
- Always log what you do

Be efficient. Process fast. Report clearly.`

const tools = [
  {
    name: 'get_pending_orders',
    description: 'Get all unfulfilled orders that need processing.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const orders = await shopify.getOrders({
          fulfillment_status: 'unfulfilled',
          financial_status: 'paid',
          limit: '50'
        })
        return {
          count: orders.length,
          orders: orders.map(o => ({
            id: o.id,
            orderNumber: o.order_number,
            email: o.email,
            totalPrice: o.total_price,
            currency: o.currency,
            createdAt: o.created_at,
            shippingAddress: o.shipping_address ? {
              city: o.shipping_address.city,
              province: o.shipping_address.province,
              country: o.shipping_address.country,
              zip: o.shipping_address.zip
            } : null,
            lineItems: (o.line_items || []).map(li => ({
              title: li.title,
              quantity: li.quantity,
              price: li.price,
              sku: li.sku,
              productId: li.product_id,
              variantId: li.variant_id
            })),
            riskLevel: o.order_status_url ? 'normal' : 'unknown',
            ageHours: Math.round((Date.now() - new Date(o.created_at)) / 3600000)
          }))
        }
      } catch (err) {
        return { error: err.message, count: 0, orders: [] }
      }
    }
  },
  {
    name: 'fulfill_order',
    description: 'Mark an order as fulfilled with optional tracking info.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'number' },
        orderNumber: { type: 'number' },
        trackingNumber: { type: 'string' },
        trackingCompany: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['orderId', 'reason']
    },
    async execute(input) {
      try {
        await shopify.fulfillOrder(input.orderId, {
          trackingNumber: input.trackingNumber,
          trackingCompany: input.trackingCompany
        })

        logger.success(`Order #${input.orderNumber || input.orderId} fulfilled`)
        if (input.trackingNumber) logger.dim(`Tracking: ${input.trackingNumber}`)

        await db.logAction({
          shop: config.getShop(),
          type: 'FULFILL',
          message: `Fulfilled order #${input.orderNumber || input.orderId}`,
          metadata: { orderId: input.orderId, tracking: input.trackingNumber }
        })

        return { fulfilled: true, orderId: input.orderId }
      } catch (err) {
        logger.warn(`Order #${input.orderNumber || input.orderId}: ${err.message}`)
        return { fulfilled: false, error: err.message }
      }
    }
  },
  {
    name: 'flag_order',
    description: 'Flag an order that needs manual attention.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'number' },
        orderNumber: { type: 'number' },
        reason: { type: 'string', description: 'Why this order needs attention' },
        severity: { type: 'string', enum: ['low', 'medium', 'high'] }
      },
      required: ['orderId', 'reason', 'severity']
    },
    async execute(input) {
      const icon = input.severity === 'high' ? '🔴' : input.severity === 'medium' ? '🟡' : '🟢'
      logger.warn(`${icon} Order #${input.orderNumber || input.orderId}: ${input.reason}`)

      await db.logAction({
        shop: config.getShop(),
        type: 'FLAG',
        message: `Flagged order #${input.orderNumber || input.orderId}: ${input.reason}`,
        metadata: { orderId: input.orderId, severity: input.severity, reason: input.reason }
      })

      return { flagged: true }
    }
  },
  {
    name: 'place_supplier_order',
    description: 'Place an order with CJ Dropshipping for a specific Shopify order. Sends the order to the supplier for fulfillment.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'number', description: 'Shopify order ID' },
        orderNumber: { type: 'number' },
        cjVariantId: { type: 'string', description: 'CJ variant ID (vid) — uses line item SKU if not provided' }
      },
      required: ['orderId']
    },
    async execute(input) {
      try {
        const cj = await import('../lib/cj.js')
        const order = await shopify.getOrder(input.orderId)
        const result = await cj.placeOrder(order, input.cjVariantId)

        if (result.success) {
          logger.success(`Order #${input.orderNumber || input.orderId} sent to CJ`)
          if (result.cjOrderId) logger.dim(`  CJ Order ID: ${result.cjOrderId}`)

          await db.logAction({
            shop: config.getShop(),
            type: 'SUPPLIER_ORDER',
            message: `Placed CJ order for #${input.orderNumber || input.orderId}`,
            metadata: { orderId: input.orderId, cjOrderId: result.cjOrderId }
          })
        }

        return result
      } catch (err) {
        return { success: false, error: err.message }
      }
    }
  },
  {
    name: 'get_supplier_tracking',
    description: 'Get tracking number from CJ Dropshipping for an order that was already placed with them.',
    inputSchema: {
      type: 'object',
      properties: {
        cjOrderId: { type: 'string', description: 'CJ order ID to check tracking for' }
      },
      required: ['cjOrderId']
    },
    async execute(input) {
      try {
        const cj = await import('../lib/cj.js')
        return await cj.getTracking(input.cjOrderId)
      } catch (err) {
        return { trackingNumber: null, error: err.message }
      }
    }
  },
  {
    name: 'present_fulfillment_report',
    description: 'Show the fulfillment processing report.',
    inputSchema: {
      type: 'object',
      properties: {
        fulfilled: { type: 'number' },
        flagged: { type: 'number' },
        skipped: { type: 'number' },
        totalValue: { type: 'number' },
        summary: { type: 'string' }
      },
      required: ['fulfilled', 'summary']
    },
    async execute(input) {
      logger.header('Fulfillment Report')
      logger.kv('Fulfilled', input.fulfilled)
      logger.kv('Flagged', input.flagged || 0)
      logger.kv('Skipped', input.skipped || 0)
      if (input.totalValue) logger.kv('Total Value', logger.money(input.totalValue))
      logger.blank()
      logger.info(input.summary)
      return { displayed: true }
    }
  }
]

async function run(opts = {}) {
  logger.header('Order Fulfillment')

  if (opts.dryRun) {
    logger.warn('DRY RUN — no orders will be fulfilled')
  }

  logger.spin('Loading pending orders...')

  const task = opts.dryRun
    ? 'Review all pending orders. Analyze each one and report what WOULD be done, but do not actually fulfill any orders. Flag any that need attention.'
    : 'Process all pending orders. Fulfill orders that are ready. Flag any that need manual attention (high value, suspicious, missing info). Present a report.'

  // In dry-run mode, remove the fulfill tool so the AI can't call it
  const activeTools = opts.dryRun ? tools.filter(t => t.name !== 'fulfill_order') : tools

  const result = await runAgent({
    system: SYSTEM,
    task,
    tools: activeTools,
    maxIterations: 15,
    onAction(name) {
      if (name === 'get_pending_orders') logger.spin('Checking pending orders...')
      if (name === 'fulfill_order') logger.spin('Fulfilling orders...')
      if (name === 'place_supplier_order') logger.spin('Placing supplier order...')
      if (name === 'get_supplier_tracking') logger.spin('Fetching tracking...')
    }
  })

  logger.stopSpin(result.success ? 'Fulfillment complete' : 'Fulfillment failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
