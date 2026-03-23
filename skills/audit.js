// Audit Skill — Full business audit
// AI agent that performs a comprehensive health check across all business areas
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Business Auditor — a ruthlessly honest business evaluator.

Your job: Tell the operator exactly how their business is doing. No sugarcoating.

## Audit Areas
1. **Revenue Health** — Is revenue growing, flat, or declining?
2. **Product Portfolio** — Too many dead products? Missing bestsellers?
3. **Pricing Strategy** — Margins healthy? Competitive pricing?
4. **Operations** — Fulfillment speed? Order processing efficiency?
5. **Customer Health** — Repeat rate? Customer acquisition working?
6. **Risk Assessment** — What could go wrong? What's vulnerable?

## Grading Scale
- A: Excellent. Keep doing what you're doing.
- B: Good. Minor improvements needed.
- C: Average. Significant improvements needed.
- D: Poor. Urgent action required.
- F: Critical. Business at risk.

## Rules
- Grade each area honestly
- Back every grade with data
- Provide 3 specific actions per area
- Give an overall business grade
- Be direct. "Your fulfillment is slow" not "There may be opportunities to improve fulfillment"

The operator wants truth, not comfort.`

const tools = [
  {
    name: 'audit_revenue',
    description: 'Pull revenue and order data for the audit.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const orders = await shopify.getOrders({ limit: '100', status: 'any' })
        const now = Date.now()

        const last30d = orders.filter(o => (now - new Date(o.created_at)) < 30 * 86400000)
        const last7d = orders.filter(o => (now - new Date(o.created_at)) < 7 * 86400000)

        const rev30d = last30d.reduce((s, o) => s + parseFloat(o.total_price || 0), 0)
        const rev7d = last7d.reduce((s, o) => s + parseFloat(o.total_price || 0), 0)
        const aov = last30d.length > 0 ? rev30d / last30d.length : 0

        const fulfilled = last30d.filter(o => o.fulfillment_status === 'fulfilled')
        const refunded = last30d.filter(o => o.financial_status === 'refunded' || o.financial_status === 'partially_refunded')

        return {
          revenue30d: rev30d.toFixed(2),
          revenue7d: rev7d.toFixed(2),
          dailyAverage: (rev30d / 30).toFixed(2),
          orders30d: last30d.length,
          orders7d: last7d.length,
          aov: aov.toFixed(2),
          fulfillmentRate: last30d.length > 0 ? ((fulfilled.length / last30d.length) * 100).toFixed(1) + '%' : 'N/A',
          refundRate: last30d.length > 0 ? ((refunded.length / last30d.length) * 100).toFixed(1) + '%' : '0%',
          totalOrders: orders.length
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'audit_products',
    description: 'Audit product catalog health.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const [products, orders] = await Promise.all([
          shopify.getProducts({ fields: 'id,title,variants,status,product_type,created_at' }),
          shopify.getOrders({ limit: '100', status: 'any' })
        ])

        // Which products sell
        const soldIds = new Set()
        for (const o of orders) {
          for (const item of (o.line_items || [])) {
            if (item.product_id) soldIds.add(item.product_id)
          }
        }

        const active = products.filter(p => p.status === 'active')
        const selling = active.filter(p => soldIds.has(p.id))
        const dead = active.filter(p => !soldIds.has(p.id))

        const prices = active.map(p => parseFloat(p.variants?.[0]?.price || 0)).filter(p => p > 0)
        const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0

        // Inventory health
        const outOfStock = active.filter(p =>
          (p.variants || []).every(v => v.inventory_quantity !== undefined && v.inventory_quantity <= 0)
        )

        return {
          total: products.length,
          active: active.length,
          selling: selling.length,
          dead: dead.length,
          deadProducts: dead.slice(0, 10).map(p => p.title),
          avgPrice: avgPrice.toFixed(2),
          outOfStock: outOfStock.length,
          categories: [...new Set(products.map(p => p.product_type).filter(Boolean))]
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'audit_customers',
    description: 'Audit customer acquisition and retention.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const customers = await shopify.getCustomers({ limit: '250' })
        const now = Date.now()

        const newLast30d = customers.filter(c => (now - new Date(c.created_at)) < 30 * 86400000)
        const repeat = customers.filter(c => c.orders_count > 1)
        const highValue = customers.filter(c => parseFloat(c.total_spent || 0) > 100)
        const totalLTV = customers.reduce((s, c) => s + parseFloat(c.total_spent || 0), 0)

        return {
          total: customers.length,
          newLast30d: newLast30d.length,
          repeatBuyers: repeat.length,
          repeatRate: customers.length > 0 ? ((repeat.length / customers.length) * 100).toFixed(1) + '%' : 'N/A',
          highValueCustomers: highValue.length,
          averageLTV: customers.length > 0 ? (totalLTV / customers.length).toFixed(2) : '0'
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'present_audit',
    description: 'Present the full business audit report.',
    inputSchema: {
      type: 'object',
      properties: {
        overallGrade: { type: 'string', description: 'A through F' },
        areas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              grade: { type: 'string' },
              score: { type: 'number', description: '0-100' },
              findings: { type: 'array', items: { type: 'string' } },
              actions: { type: 'array', items: { type: 'string' } }
            },
            required: ['name', 'grade', 'findings', 'actions']
          }
        },
        criticalIssues: { type: 'array', items: { type: 'string' } },
        topPriorities: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' }
      },
      required: ['overallGrade', 'areas', 'summary']
    },
    async execute(input) {
      logger.header('Business Audit Report')
      logger.bold(`Overall Grade: ${input.overallGrade}`)
      logger.blank()

      for (const area of input.areas) {
        logger.bold(`${area.name} — ${area.grade}${area.score ? ` (${area.score}/100)` : ''}`)
        for (const f of area.findings) logger.dim(`  ${f}`)
        logger.blank()
        logger.info('  Actions:')
        for (const a of area.actions) logger.item(a, 4)
        logger.blank()
      }

      if (input.criticalIssues?.length) {
        logger.bold('CRITICAL ISSUES')
        for (const issue of input.criticalIssues) logger.error(issue)
        logger.blank()
      }

      if (input.topPriorities?.length) {
        logger.bold('Top 3 Priorities')
        input.topPriorities.forEach((p, i) => logger.info(`${i + 1}. ${p}`))
        logger.blank()
      }

      logger.divider()
      logger.info(input.summary)

      await db.logAction({
        shop: config.getShop(),
        type: 'AUDIT',
        message: `Business audit: Grade ${input.overallGrade}`,
        metadata: { grade: input.overallGrade, areas: input.areas.map(a => ({ name: a.name, grade: a.grade })) }
      })

      return { displayed: true }
    }
  }
]

async function run() {
  logger.header('Full Business Audit')
  logger.spin('Starting comprehensive audit...')

  const result = await runAgent({
    system: SYSTEM,
    task: 'Perform a full business audit. Analyze revenue, products, and customers. Grade each area A-F with specific findings and actions. Identify critical issues and top priorities. Be honest and direct.',
    tools,
    maxIterations: 10,
    onAction(name) {
      if (name === 'audit_revenue') logger.spin('Auditing revenue...')
      if (name === 'audit_products') logger.spin('Auditing products...')
      if (name === 'audit_customers') logger.spin('Auditing customers...')
    }
  })

  logger.stopSpin(result.success ? 'Audit complete' : 'Audit failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
