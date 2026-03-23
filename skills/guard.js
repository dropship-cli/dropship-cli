// Guard Skill — Revenue protection scan
// AI agent that detects threats: stockouts, margin erosion, fraud signals, ad waste
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Revenue Guard — a paranoid profit protector.

Your job: Find every threat to revenue and sound the alarm.

## Threat Categories
1. **Stockouts** — Products with 0-5 inventory that are still active/selling
2. **Margin Erosion** — Products where price is too close to cost (below 30% margin)
3. **Stale Orders** — Unfulfilled orders older than 48 hours (chargeback risk)
4. **Refund Surge** — Unusual spike in refunds/cancellations
5. **Dead Products** — Active products with zero sales in 30+ days (catalog bloat)
6. **Price Anomalies** — Products priced far outside their category norm

## Severity Levels
- CRITICAL: Revenue is actively being lost RIGHT NOW (stockout on bestseller, stale orders)
- WARNING: Revenue will be lost SOON (low stock, margin squeeze)
- INFO: Optimization opportunity (dead products, price adjustments)

## Process
1. Scan inventory levels → flag stockouts
2. Check order fulfillment status → flag stale orders
3. Analyze product catalog → find dead weight and pricing issues
4. Present a threat report with actionable fixes

Be paranoid. Better to over-flag than miss a threat.`

const tools = [
  {
    name: 'scan_inventory',
    description: 'Check inventory levels for all active products.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const products = await shopify.getProducts({ status: 'active', fields: 'id,title,variants,status' })
        const inventory = []
        for (const p of products) {
          for (const v of (p.variants || [])) {
            if (v.inventory_management === 'shopify' || v.inventory_quantity !== undefined) {
              inventory.push({
                productId: p.id,
                title: p.title,
                variantTitle: v.title === 'Default Title' ? null : v.title,
                sku: v.sku,
                quantity: v.inventory_quantity,
                price: v.price
              })
            }
          }
        }
        return {
          totalProducts: products.length,
          trackedVariants: inventory.length,
          outOfStock: inventory.filter(i => i.quantity <= 0),
          lowStock: inventory.filter(i => i.quantity > 0 && i.quantity <= 5),
          healthy: inventory.filter(i => i.quantity > 5)
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'scan_orders',
    description: 'Check for stale unfulfilled orders and refund patterns.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const [unfulfilled, allRecent] = await Promise.all([
          shopify.getOrders({ fulfillment_status: 'unfulfilled', financial_status: 'paid', limit: '50' }),
          shopify.getOrders({ limit: '50', status: 'any' })
        ])

        const now = Date.now()
        const staleOrders = unfulfilled.filter(o =>
          (now - new Date(o.created_at)) > 48 * 3600000
        ).map(o => ({
          id: o.id,
          number: o.order_number,
          age: Math.round((now - new Date(o.created_at)) / 3600000) + 'h',
          total: o.total_price
        }))

        const refunded = allRecent.filter(o =>
          o.financial_status === 'refunded' || o.financial_status === 'partially_refunded'
        )

        const cancelled = allRecent.filter(o => o.cancelled_at)

        return {
          pendingOrders: unfulfilled.length,
          staleOrders,
          refundedOrders: refunded.length,
          cancelledOrders: cancelled.length,
          totalRecentOrders: allRecent.length,
          refundRate: allRecent.length > 0 ? ((refunded.length / allRecent.length) * 100).toFixed(1) + '%' : '0%'
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'scan_catalog',
    description: 'Find dead products and pricing anomalies.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const [products, orders] = await Promise.all([
          shopify.getProducts({ status: 'active', fields: 'id,title,variants,product_type,created_at' }),
          shopify.getOrders({ limit: '50', status: 'any' })
        ])

        // Track which products have sold
        const soldProductIds = new Set()
        for (const order of orders) {
          for (const item of (order.line_items || [])) {
            if (item.product_id) soldProductIds.add(item.product_id)
          }
        }

        const deadProducts = products.filter(p => !soldProductIds.has(p.id)).map(p => ({
          id: p.id,
          title: p.title,
          price: p.variants?.[0]?.price,
          type: p.product_type,
          createdAt: p.created_at
        }))

        // Price analysis by category
        const byType = {}
        for (const p of products) {
          const type = p.product_type || 'uncategorized'
          if (!byType[type]) byType[type] = []
          byType[type].push(parseFloat(p.variants?.[0]?.price || 0))
        }

        const priceAnalysis = {}
        for (const [type, prices] of Object.entries(byType)) {
          const avg = prices.reduce((a, b) => a + b, 0) / prices.length
          priceAnalysis[type] = {
            count: prices.length,
            avgPrice: avg.toFixed(2),
            minPrice: Math.min(...prices).toFixed(2),
            maxPrice: Math.max(...prices).toFixed(2)
          }
        }

        return {
          totalActive: products.length,
          deadProducts: deadProducts.slice(0, 15),
          deadCount: deadProducts.length,
          priceAnalysis
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'present_threat_report',
    description: 'Show the revenue threat report.',
    inputSchema: {
      type: 'object',
      properties: {
        threats: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              severity: { type: 'string', enum: ['CRITICAL', 'WARNING', 'INFO'] },
              category: { type: 'string' },
              description: { type: 'string' },
              action: { type: 'string', description: 'Recommended fix' }
            },
            required: ['severity', 'category', 'description']
          }
        },
        overallRisk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        summary: { type: 'string' }
      },
      required: ['threats', 'overallRisk', 'summary']
    },
    async execute(input) {
      logger.header('Revenue Threat Report')

      const riskColor = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢' }
      logger.bold(`Overall Risk: ${riskColor[input.overallRisk] || ''} ${input.overallRisk}`)
      logger.blank()

      for (const threat of input.threats) {
        const icon = threat.severity === 'CRITICAL' ? '🔴' : threat.severity === 'WARNING' ? '🟡' : 'ℹ️'
        logger.info(`${icon} [${threat.severity}] ${threat.category}`)
        logger.dim(threat.description)
        if (threat.action) logger.dim(`→ Fix: ${threat.action}`)
        logger.blank()
      }

      logger.divider()
      logger.info(input.summary)

      await db.logAction({
        shop: config.getShop(),
        type: 'GUARD',
        message: `Revenue scan: ${input.overallRisk} risk, ${input.threats.length} threats`,
        metadata: { risk: input.overallRisk, threatCount: input.threats.length }
      })

      return { displayed: true, threats: input.threats.length, risk: input.overallRisk }
    }
  }
]

async function run() {
  logger.header('Revenue Guard')
  logger.spin('Scanning for threats...')

  const result = await runAgent({
    system: SYSTEM,
    task: 'Run a comprehensive revenue protection scan. Check inventory, orders, and catalog health. Identify ALL threats. Present a clear threat report with severity levels and recommended actions.',
    tools,
    maxIterations: 10,
    onAction(name) {
      if (name === 'scan_inventory') logger.spin('Scanning inventory...')
      if (name === 'scan_orders') logger.spin('Checking order health...')
      if (name === 'scan_catalog') logger.spin('Analyzing catalog...')
    }
  })

  logger.stopSpin(result.success ? 'Guard scan complete' : 'Guard scan failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
