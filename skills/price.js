// Price Skill — Optimize prices for maximum profit
// AI agent that analyzes margins, demand, competition and adjusts prices
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Pricing Agent — a profit maximization specialist.

Your job: Review every product's price and optimize for maximum profit.

## Pricing Rules
- Minimum 40% margin (below that = money loser after ads + shipping)
- Sweet spots: $19.99, $24.99, $29.99, $39.99, $49.99 (psychological pricing)
- If a product is selling well at current price → don't touch it
- If a product has zero sales → consider a 15-20% markdown to kickstart
- High-demand products → test a 10-15% price increase
- Never price below cost + $5 (shipping buffer)

## Process
1. Pull all products with current prices
2. Check recent sales velocity for each
3. Analyze margins (if cost data available)
4. Recommend price changes with reasoning
5. Apply changes (or preview in dry-run mode)

Be data-driven. Every price change needs a reason.`

const tools = [
  {
    name: 'get_all_products',
    description: 'Get all products with prices and variants.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const products = await shopify.getProducts({ fields: 'id,title,variants,product_type,status' })
        return {
          count: products.length,
          products: products.map(p => ({
            id: p.id,
            title: p.title,
            type: p.product_type,
            status: p.status,
            variants: (p.variants || []).map(v => ({
              id: v.id,
              price: v.price,
              compareAtPrice: v.compare_at_price,
              sku: v.sku,
              inventoryQuantity: v.inventory_quantity
            }))
          }))
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'get_sales_data',
    description: 'Get recent order data to analyze which products are selling.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const orders = await shopify.getOrders({ limit: '50', status: 'any' })
        const sales = {}
        let totalRevenue = 0

        for (const order of orders) {
          totalRevenue += parseFloat(order.total_price || 0)
          for (const item of (order.line_items || [])) {
            const key = item.product_id || item.title
            if (!sales[key]) sales[key] = { title: item.title, units: 0, revenue: 0, productId: item.product_id }
            sales[key].units += item.quantity
            sales[key].revenue += parseFloat(item.price) * item.quantity
          }
        }

        const sorted = Object.values(sales).sort((a, b) => b.revenue - a.revenue)
        return { totalOrders: orders.length, totalRevenue, productSales: sorted.slice(0, 20) }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'update_price',
    description: 'Update a product variant price.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'number', description: 'Shopify product ID' },
        variantId: { type: 'number', description: 'Shopify variant ID' },
        oldPrice: { type: 'string', description: 'Current price' },
        newPrice: { type: 'string', description: 'New price to set' },
        reason: { type: 'string', description: 'Why this price change' }
      },
      required: ['productId', 'variantId', 'newPrice', 'reason']
    },
    async execute(input) {
      logger.info(`${input.reason}`)
      logger.kv('Price', `${input.oldPrice || '?'} → ${input.newPrice}`)

      try {
        await shopify.updateProduct(input.productId, {
          variants: [{ id: input.variantId, price: input.newPrice }]
        })

        await db.logAction({
          shop: config.getShop(),
          type: 'REPRICE',
          message: `Updated price: ${input.oldPrice} → ${input.newPrice}`,
          metadata: { productId: input.productId, oldPrice: input.oldPrice, newPrice: input.newPrice, reason: input.reason }
        })

        return { updated: true, productId: input.productId, newPrice: input.newPrice }
      } catch (err) {
        return { updated: false, error: err.message }
      }
    }
  },
  {
    name: 'present_price_report',
    description: 'Show the price optimization report.',
    inputSchema: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product: { type: 'string' },
              oldPrice: { type: 'string' },
              newPrice: { type: 'string' },
              reason: { type: 'string' },
              expectedImpact: { type: 'string' }
            }
          }
        },
        unchanged: { type: 'number', description: 'Products that need no change' },
        summary: { type: 'string' }
      },
      required: ['changes', 'summary']
    },
    async execute(input) {
      logger.header('Price Optimization Report')

      if (input.changes.length > 0) {
        logger.table(input.changes.map(c => ({
          Product: c.product?.substring(0, 25),
          Old: c.oldPrice,
          New: c.newPrice,
          Reason: c.reason?.substring(0, 30)
        })))
      }

      logger.blank()
      logger.kv('Changed', input.changes.length)
      logger.kv('Unchanged', input.unchanged || 0)
      logger.blank()
      logger.info(input.summary)

      return { displayed: true }
    }
  }
]

async function run(opts = {}) {
  logger.header('Price Optimizer')

  const strategy = opts.aggressive ? 'aggressive (maximize margin, test higher prices)'
    : opts.conservative ? 'conservative (protect sales volume, small adjustments only)'
    : 'balanced (optimize margins without hurting conversion)'

  logger.kv('Strategy', strategy)
  logger.spin('Analyzing prices...')

  const result = await runAgent({
    system: SYSTEM,
    task: `Review all product prices using a ${strategy} strategy. Pull products and sales data, identify pricing opportunities, and update prices. Present a summary report.`,
    tools,
    maxIterations: 12,
    onAction(name) {
      if (name === 'get_all_products') logger.spin('Loading product catalog...')
      if (name === 'get_sales_data') logger.spin('Analyzing sales velocity...')
      if (name === 'update_price') logger.spin('Updating prices...')
    }
  })

  logger.stopSpin(result.success ? 'Pricing complete' : 'Pricing failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
