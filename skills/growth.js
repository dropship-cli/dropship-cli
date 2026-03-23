// Growth Skill — Ad campaign management
// AI agent that plans, analyzes, and optimizes marketing spend
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Growth Agent — a performance marketing specialist.

Your job: Maximize revenue per ad dollar. Every dollar counts.

## Growth Framework
1. **Product Selection** — Only advertise winners (proven sellers with healthy margins)
2. **Budget Allocation** — Never spend more than 25% of expected daily revenue
3. **Campaign Analysis** — Track ROAS (Return on Ad Spend) ruthlessly
4. **Kill Rules** — ROAS < 0.8 after $50 spent = kill immediately
5. **Scale Rules** — ROAS > 2.5 = increase budget 30% (max $500/day per campaign)

## Campaign Types
- **Testing** — $10-20/day, 3-5 products, find winners
- **Scaling** — $50-200/day, proven winners only
- **Retargeting** — $20-50/day, cart abandoners and site visitors
- **Lookalike** — Based on top customer segments

## Recommendations Should Include
- Which products to advertise (and which to STOP)
- Budget recommendations with reasoning
- Target audience suggestions
- Creative angles (what messaging to use)
- Expected ROAS range

Don't just report — prescribe specific actions.`

const tools = [
  {
    name: 'get_product_performance',
    description: 'Get product sales data to identify ad-worthy products.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const [products, orders] = await Promise.all([
          shopify.getProducts({ status: 'active', fields: 'id,title,variants,product_type,images' }),
          shopify.getOrders({ limit: '100', status: 'any' })
        ])

        const productPerf = {}
        for (const order of orders) {
          for (const item of (order.line_items || [])) {
            const pid = item.product_id
            if (!pid) continue
            if (!productPerf[pid]) productPerf[pid] = { title: item.title, units: 0, revenue: 0, orders: 0 }
            productPerf[pid].units += item.quantity
            productPerf[pid].revenue += parseFloat(item.price) * item.quantity
            productPerf[pid].orders++
          }
        }

        // Merge with product data
        const results = products.map(p => {
          const perf = productPerf[p.id] || { units: 0, revenue: 0, orders: 0 }
          return {
            id: p.id,
            title: p.title,
            price: p.variants?.[0]?.price,
            type: p.product_type,
            hasImage: (p.images || []).length > 0,
            ...perf,
            aov: perf.orders > 0 ? (perf.revenue / perf.orders).toFixed(2) : '0'
          }
        }).sort((a, b) => b.revenue - a.revenue)

        return { products: results, totalProducts: products.length, totalOrders: orders.length }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'get_customer_segments',
    description: 'Get customer data for targeting recommendations.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const customers = await shopify.getCustomers({ limit: '100' })
        const segments = {
          highValue: customers.filter(c => parseFloat(c.total_spent || 0) > 100),
          repeat: customers.filter(c => c.orders_count > 1),
          recent: customers.filter(c => {
            const daysSince = (Date.now() - new Date(c.updated_at)) / 86400000
            return daysSince < 30
          }),
          countries: {}
        }

        for (const c of customers) {
          const country = c.default_address?.country || 'Unknown'
          segments.countries[country] = (segments.countries[country] || 0) + 1
        }

        return {
          total: customers.length,
          highValue: segments.highValue.length,
          repeat: segments.repeat.length,
          recentActive: segments.recent.length,
          topCountries: Object.entries(segments.countries).sort((a, b) => b[1] - a[1]).slice(0, 5)
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'present_growth_plan',
    description: 'Present the growth/advertising plan.',
    inputSchema: {
      type: 'object',
      properties: {
        campaigns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'testing/scaling/retargeting/lookalike' },
              products: { type: 'array', items: { type: 'string' } },
              dailyBudget: { type: 'number' },
              targetAudience: { type: 'string' },
              creativeAngle: { type: 'string' },
              expectedROAS: { type: 'string' },
              reasoning: { type: 'string' }
            },
            required: ['type', 'dailyBudget', 'reasoning']
          }
        },
        killList: { type: 'array', items: { type: 'string' }, description: 'Products to STOP advertising' },
        totalDailyBudget: { type: 'number' },
        summary: { type: 'string' }
      },
      required: ['campaigns', 'summary']
    },
    async execute(input) {
      logger.header('Growth Plan')
      logger.kv('Total Daily Budget', logger.money(input.totalDailyBudget || 0))
      logger.blank()

      for (let i = 0; i < input.campaigns.length; i++) {
        const c = input.campaigns[i]
        logger.bold(`Campaign ${i + 1}: ${c.type.toUpperCase()}`)
        logger.kv('  Budget', `${logger.money(c.dailyBudget)}/day`)
        if (c.products?.length) logger.kv('  Products', c.products.join(', '))
        if (c.targetAudience) logger.kv('  Audience', c.targetAudience)
        if (c.creativeAngle) logger.kv('  Angle', c.creativeAngle)
        if (c.expectedROAS) logger.kv('  Expected ROAS', c.expectedROAS)
        logger.dim(`  ${c.reasoning}`)
        logger.blank()
      }

      if (input.killList?.length) {
        logger.bold('STOP Advertising')
        for (const p of input.killList) logger.item(`✗ ${p}`)
        logger.blank()
      }

      logger.divider()
      logger.info(input.summary)

      await db.logAction({
        shop: config.getShop(),
        type: 'GROWTH',
        message: `Growth plan: ${input.campaigns.length} campaigns, ${logger.money(input.totalDailyBudget || 0)}/day`,
        metadata: { campaigns: input.campaigns.length, budget: input.totalDailyBudget }
      })

      return { displayed: true }
    }
  }
]

async function run(opts = {}) {
  logger.header('Growth Manager')

  if (opts.budget) logger.kv('Budget Cap', `$${opts.budget}/day`)
  logger.spin('Analyzing growth opportunities...')

  const budgetNote = opts.budget ? ` Keep total daily budget under $${opts.budget}.` : ''

  const result = await runAgent({
    system: SYSTEM,
    task: `Analyze the store's products and customers. Create a growth plan with specific campaign recommendations. Identify top products to advertise, audiences to target, and budgets to allocate.${budgetNote} Present a clear plan.`,
    tools,
    maxIterations: 8,
    onAction(name) {
      if (name === 'get_product_performance') logger.spin('Analyzing product performance...')
      if (name === 'get_customer_segments') logger.spin('Analyzing customer segments...')
    }
  })

  logger.stopSpin(result.success ? 'Growth analysis complete' : 'Growth analysis failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
