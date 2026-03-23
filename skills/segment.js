// Segment Skill — Customer segmentation
// AI agent that performs RFM analysis and identifies customer segments
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Segmentation Agent — a customer intelligence specialist.

Your job: Segment customers using RFM (Recency, Frequency, Monetary) analysis.

## Segments
- **VIP Champions** — Recent, frequent, high-spend. Treat like royalty.
- **Loyal Regulars** — Frequent buyers, moderate spend. Nurture them.
- **Big Spenders** — High AOV but infrequent. Encourage repeat purchases.
- **New Promising** — Recent first-time buyers with good AOV. Convert to repeat.
- **At Risk** — Were active but haven't bought in 30-60 days. Win them back NOW.
- **Lost** — No purchase in 60+ days. Last-chance re-engagement.
- **Window Shoppers** — One small purchase, never returned. Low priority.

## For Each Segment
1. Count of customers
2. Total revenue contribution
3. Average order value
4. Recommended action (specific, not generic)

## RFM Scoring
- Recency: Days since last order (lower = better)
- Frequency: Total order count (higher = better)
- Monetary: Total lifetime spend (higher = better)

Be specific with recommendations. "Send a 15% win-back email" not "engage customers".`

const tools = [
  {
    name: 'get_customers_with_orders',
    description: 'Get all customers with their order history for RFM analysis.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const customers = await shopify.getCustomers({ limit: '250' })
        const now = Date.now()

        return {
          count: customers.length,
          customers: customers.map(c => ({
            id: c.id,
            email: c.email,
            firstName: c.first_name,
            ordersCount: c.orders_count || 0,
            totalSpent: parseFloat(c.total_spent || 0),
            lastOrderDate: c.last_order_id ? c.updated_at : null,
            daysSinceLastOrder: c.updated_at ? Math.round((now - new Date(c.updated_at)) / 86400000) : 999,
            createdAt: c.created_at,
            country: c.default_address?.country || 'Unknown',
            tags: c.tags || ''
          }))
        }
      } catch (err) {
        return { error: err.message, count: 0, customers: [] }
      }
    }
  },
  {
    name: 'get_order_details',
    description: 'Get detailed order data for deeper analysis.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const orders = await shopify.getOrders({ limit: '100', status: 'any' })
        const customerOrders = {}

        for (const order of orders) {
          const customerId = order.customer?.id
          if (!customerId) continue
          if (!customerOrders[customerId]) customerOrders[customerId] = []
          customerOrders[customerId].push({
            id: order.id,
            total: parseFloat(order.total_price || 0),
            date: order.created_at,
            items: (order.line_items || []).length
          })
        }

        return {
          totalOrders: orders.length,
          uniqueCustomers: Object.keys(customerOrders).length,
          customerOrders
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'present_segmentation',
    description: 'Present the customer segmentation report.',
    inputSchema: {
      type: 'object',
      properties: {
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              count: { type: 'number' },
              revenue: { type: 'number' },
              avgOrderValue: { type: 'number' },
              avgRecencyDays: { type: 'number' },
              recommendation: { type: 'string' }
            },
            required: ['name', 'count', 'recommendation']
          }
        },
        totalCustomers: { type: 'number' },
        summary: { type: 'string' }
      },
      required: ['segments', 'summary']
    },
    async execute(input) {
      logger.header('Customer Segmentation')
      logger.kv('Total Customers', input.totalCustomers || '?')
      logger.blank()

      for (const seg of input.segments) {
        logger.bold(seg.name)
        logger.kv('  Customers', seg.count)
        if (seg.revenue) logger.kv('  Revenue', logger.money(seg.revenue))
        if (seg.avgOrderValue) logger.kv('  Avg Order', logger.money(seg.avgOrderValue))
        if (seg.avgRecencyDays) logger.kv('  Avg Recency', `${seg.avgRecencyDays} days`)
        logger.dim(`  → ${seg.recommendation}`)
        logger.blank()
      }

      logger.divider()
      logger.info(input.summary)

      await db.logAction({
        shop: config.getShop(),
        type: 'SEGMENT',
        message: `Segmented ${input.totalCustomers} customers into ${input.segments.length} groups`,
        metadata: { segments: input.segments.map(s => ({ name: s.name, count: s.count })) }
      })

      return { displayed: true }
    }
  }
]

async function run() {
  logger.header('Customer Segmentation')
  logger.spin('Loading customer data...')

  const result = await runAgent({
    system: SYSTEM,
    task: 'Perform a full RFM customer segmentation. Pull all customer and order data, score each customer, assign segments, and present actionable recommendations for each segment.',
    tools,
    maxIterations: 8,
    onAction(name) {
      if (name === 'get_customers_with_orders') logger.spin('Loading customers...')
      if (name === 'get_order_details') logger.spin('Analyzing order patterns...')
    }
  })

  logger.stopSpin(result.success ? 'Segmentation complete' : 'Segmentation failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
