// Intel Skill — Competitor intelligence agent
// AI agent that monitors competitors, analyzes their pricing, products, and strategy
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Intelligence Agent — a competitive analysis specialist.

Your job: Analyze the store's competitive position and identify strategic opportunities.

## Intelligence Gathering
1. **Catalog Analysis** — What products does the store have? What's missing?
2. **Price Positioning** — How do prices compare to typical market rates?
3. **Product Gap Analysis** — Categories with few products = opportunity
4. **Trend Detection** — Which product types are selling vs dead?
5. **Strategic Recommendations** — What should the store do next?

## Competitive Frameworks
- **Porter's Five Forces** simplified for dropshipping:
  - Supplier power (single supplier = risk)
  - Buyer power (price sensitivity based on AOV)
  - New entrants (barrier = product curation + brand)
  - Substitutes (commoditized products = race to bottom)
  - Rivalry (category saturation)

- **SWOT Analysis** for the store:
  - Strengths: What's working (bestsellers, margins, retention)
  - Weaknesses: What's broken (dead products, low margins, slow fulfillment)
  - Opportunities: What to exploit (trending categories, underserved niches)
  - Threats: What to defend against (stockouts, competitor pricing)

## Output
Be specific. Name products, cite numbers, give actionable intel.
"Your electronics category has 3x the margin of apparel — shift ad spend" not "consider optimizing".`

const tools = [
  {
    name: 'analyze_catalog_position',
    description: 'Deep analysis of the store catalog for competitive positioning.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const [products, orders] = await Promise.all([
          shopify.getProducts({ fields: 'id,title,variants,product_type,vendor,created_at,status' }),
          shopify.getOrders({ limit: '100', status: 'any' })
        ])

        // Category breakdown
        const categories = {}
        for (const p of products) {
          const cat = p.product_type || 'Uncategorized'
          if (!categories[cat]) categories[cat] = { count: 0, totalPrice: 0, revenue: 0, units: 0 }
          categories[cat].count++
          categories[cat].totalPrice += parseFloat(p.variants?.[0]?.price || 0)
        }

        // Sales by category
        for (const order of orders) {
          for (const item of (order.line_items || [])) {
            const product = products.find(p => p.id === item.product_id)
            const cat = product?.product_type || 'Uncategorized'
            if (categories[cat]) {
              categories[cat].revenue += parseFloat(item.price) * item.quantity
              categories[cat].units += item.quantity
            }
          }
        }

        // Vendor diversity
        const vendors = [...new Set(products.map(p => p.vendor).filter(Boolean))]

        // Price distribution
        const prices = products.map(p => parseFloat(p.variants?.[0]?.price || 0)).filter(p => p > 0)
        const priceRanges = {
          under20: prices.filter(p => p < 20).length,
          '20to50': prices.filter(p => p >= 20 && p < 50).length,
          '50to100': prices.filter(p => p >= 50 && p < 100).length,
          over100: prices.filter(p => p >= 100).length
        }

        // Calculate category metrics
        const categoryMetrics = Object.entries(categories).map(([name, data]) => ({
          name,
          products: data.count,
          avgPrice: data.count > 0 ? (data.totalPrice / data.count).toFixed(2) : '0',
          totalRevenue: data.revenue.toFixed(2),
          unitsSold: data.units,
          revenuePerProduct: data.count > 0 ? (data.revenue / data.count).toFixed(2) : '0'
        })).sort((a, b) => parseFloat(b.totalRevenue) - parseFloat(a.totalRevenue))

        return {
          totalProducts: products.length,
          activeProducts: products.filter(p => p.status === 'active').length,
          vendors: vendors.length,
          vendorList: vendors.slice(0, 10),
          priceRanges,
          avgPrice: prices.length > 0 ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2) : '0',
          medianPrice: prices.length > 0 ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)].toFixed(2) : '0',
          categories: categoryMetrics
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'analyze_customer_behavior',
    description: 'Analyze customer purchase patterns and behavior signals.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const [customers, orders] = await Promise.all([
          shopify.getCustomers({ limit: '200' }),
          shopify.getOrders({ limit: '100', status: 'any' })
        ])

        const now = Date.now()
        const totalSpend = customers.reduce((s, c) => s + parseFloat(c.total_spent || 0), 0)
        const repeat = customers.filter(c => c.orders_count > 1)
        const recent30d = customers.filter(c => (now - new Date(c.created_at)) < 30 * 86400000)

        // Geographic distribution
        const geos = {}
        for (const c of customers) {
          const country = c.default_address?.country || 'Unknown'
          geos[country] = (geos[country] || 0) + 1
        }

        // Purchase timing patterns
        const hourCounts = new Array(24).fill(0)
        const dayCounts = new Array(7).fill(0)
        for (const o of orders) {
          const d = new Date(o.created_at)
          hourCounts[d.getHours()]++
          dayCounts[d.getDay()]++
        }

        const peakHour = hourCounts.indexOf(Math.max(...hourCounts))
        const peakDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayCounts.indexOf(Math.max(...dayCounts))]

        return {
          totalCustomers: customers.length,
          newLast30d: recent30d.length,
          repeatRate: customers.length > 0 ? ((repeat.length / customers.length) * 100).toFixed(1) + '%' : 'N/A',
          avgLTV: customers.length > 0 ? (totalSpend / customers.length).toFixed(2) : '0',
          topCountries: Object.entries(geos).sort((a, b) => b[1] - a[1]).slice(0, 5),
          peakPurchaseHour: `${peakHour}:00`,
          peakPurchaseDay: peakDay,
          avgOrdersPerCustomer: customers.length > 0 ? (customers.reduce((s, c) => s + (c.orders_count || 0), 0) / customers.length).toFixed(1) : '0'
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'present_intel_report',
    description: 'Present the competitive intelligence report.',
    inputSchema: {
      type: 'object',
      properties: {
        swot: {
          type: 'object',
          properties: {
            strengths: { type: 'array', items: { type: 'string' } },
            weaknesses: { type: 'array', items: { type: 'string' } },
            opportunities: { type: 'array', items: { type: 'string' } },
            threats: { type: 'array', items: { type: 'string' } }
          }
        },
        strategicActions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              priority: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
              action: { type: 'string' },
              expectedImpact: { type: 'string' },
              timeframe: { type: 'string' }
            },
            required: ['priority', 'action']
          }
        },
        competitiveEdge: { type: 'string', description: 'What makes this store defensible' },
        biggestRisk: { type: 'string' },
        summary: { type: 'string' }
      },
      required: ['swot', 'strategicActions', 'summary']
    },
    async execute(input) {
      logger.header('Competitive Intelligence Report')

      // SWOT
      if (input.swot) {
        logger.bold('SWOT Analysis')
        logger.blank()

        if (input.swot.strengths?.length) {
          logger.info('Strengths')
          for (const s of input.swot.strengths) logger.item(s)
        }
        if (input.swot.weaknesses?.length) {
          logger.info('Weaknesses')
          for (const w of input.swot.weaknesses) logger.item(w)
        }
        if (input.swot.opportunities?.length) {
          logger.info('Opportunities')
          for (const o of input.swot.opportunities) logger.item(o)
        }
        if (input.swot.threats?.length) {
          logger.info('Threats')
          for (const t of input.swot.threats) logger.item(t)
        }
        logger.blank()
      }

      // Strategic Actions
      logger.bold('Strategic Actions')
      for (const a of input.strategicActions) {
        const icon = a.priority === 'HIGH' ? '🔴' : a.priority === 'MEDIUM' ? '🟡' : '🟢'
        logger.info(`${icon} [${a.priority}] ${a.action}`)
        if (a.expectedImpact) logger.dim(`   Impact: ${a.expectedImpact}`)
        if (a.timeframe) logger.dim(`   Timeframe: ${a.timeframe}`)
      }
      logger.blank()

      if (input.competitiveEdge) logger.kv('Competitive Edge', input.competitiveEdge)
      if (input.biggestRisk) logger.kv('Biggest Risk', input.biggestRisk)

      logger.divider()
      logger.info(input.summary)

      await db.logAction({
        shop: config.getShop(),
        type: 'INTEL',
        message: `Intel report: ${input.strategicActions.length} strategic actions`,
        metadata: { actions: input.strategicActions.length }
      })

      return { displayed: true }
    }
  }
]

async function run() {
  logger.header('Competitive Intelligence')
  logger.spin('Gathering intelligence...')

  const result = await runAgent({
    system: SYSTEM,
    task: 'Perform a comprehensive competitive intelligence analysis. Analyze the catalog positioning, customer behavior patterns, and market position. Deliver a SWOT analysis and ranked strategic actions.',
    tools,
    maxIterations: 10,
    onAction(name) {
      if (name === 'analyze_catalog_position') logger.spin('Analyzing catalog...')
      if (name === 'analyze_customer_behavior') logger.spin('Analyzing customer behavior...')
    }
  })

  logger.stopSpin(result.success ? 'Intel complete' : 'Intel failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
