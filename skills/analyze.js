// Analyze Skill — Analytics + KPI report
// AI agent that crunches numbers and delivers business intelligence
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Analytics Agent — a data-obsessed business analyst.

Your job: Turn raw store data into actionable insights.

## Key Metrics
- Revenue (total, daily average, trend)
- Orders (count, AOV, fulfillment rate)
- Products (top sellers, dead weight, conversion signals)
- Customers (new vs returning, geographic spread)
- Growth rate (week-over-week, month-over-month)

## Report Format
Always structure your analysis as:
1. HEADLINE NUMBERS — The 3-5 most important metrics right now
2. TRENDS — What's going up, what's going down
3. ALERTS — Anything that needs immediate attention
4. RECOMMENDATIONS — 2-3 specific actions to improve performance

Be concise. Executives don't read essays.`

const tools = [
  {
    name: 'get_revenue_data',
    description: 'Get order data for revenue analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Period: 7d, 30d, 90d', default: '30d' }
      },
      required: []
    },
    async execute(input) {
      try {
        const days = parseInt(input.period) || 30
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
        const orders = await shopify.getOrders({ created_at_min: since, limit: '250', status: 'any' })

        let totalRevenue = 0
        let totalOrders = 0
        let fulfilledOrders = 0
        let refundedOrders = 0
        const dailyRevenue = {}
        const productSales = {}

        for (const order of orders) {
          if (order.financial_status === 'refunded') { refundedOrders++; continue }
          totalOrders++
          const rev = parseFloat(order.total_price || 0)
          totalRevenue += rev

          if (order.fulfillment_status === 'fulfilled') fulfilledOrders++

          const day = order.created_at.split('T')[0]
          dailyRevenue[day] = (dailyRevenue[day] || 0) + rev

          for (const item of (order.line_items || [])) {
            const key = item.title
            if (!productSales[key]) productSales[key] = { title: key, units: 0, revenue: 0 }
            productSales[key].units += item.quantity
            productSales[key].revenue += parseFloat(item.price) * item.quantity
          }
        }

        const aov = totalOrders > 0 ? (totalRevenue / totalOrders) : 0
        const topProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 10)

        return {
          period: `${days}d`,
          totalRevenue: totalRevenue.toFixed(2),
          totalOrders,
          averageOrderValue: aov.toFixed(2),
          fulfillmentRate: totalOrders > 0 ? ((fulfilledOrders / totalOrders) * 100).toFixed(1) + '%' : 'N/A',
          refundedOrders,
          dailyRevenue,
          topProducts
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'get_product_health',
    description: 'Get product catalog health metrics.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const products = await shopify.getProducts({ fields: 'id,title,status,variants,product_type,created_at' })
        const active = products.filter(p => p.status === 'active')
        const draft = products.filter(p => p.status === 'draft')

        const pricePoints = active.map(p => parseFloat(p.variants?.[0]?.price || 0)).filter(p => p > 0)
        const avgPrice = pricePoints.length > 0 ? (pricePoints.reduce((a, b) => a + b, 0) / pricePoints.length) : 0

        return {
          totalProducts: products.length,
          active: active.length,
          draft: draft.length,
          averagePrice: avgPrice.toFixed(2),
          priceRange: pricePoints.length > 0 ? {
            min: Math.min(...pricePoints).toFixed(2),
            max: Math.max(...pricePoints).toFixed(2)
          } : { min: '0', max: '0' },
          categories: [...new Set(products.map(p => p.product_type).filter(Boolean))]
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'get_customer_data',
    description: 'Get customer analytics.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const customers = await shopify.getCustomers({ limit: '100' })
        const countries = {}
        let totalSpend = 0
        let repeatBuyers = 0

        for (const c of customers) {
          const spend = parseFloat(c.total_spent || 0)
          totalSpend += spend
          if (c.orders_count > 1) repeatBuyers++
          const country = c.default_address?.country || 'Unknown'
          countries[country] = (countries[country] || 0) + 1
        }

        return {
          totalCustomers: customers.length,
          repeatBuyers,
          repeatRate: customers.length > 0 ? ((repeatBuyers / customers.length) * 100).toFixed(1) + '%' : 'N/A',
          averageLifetimeValue: customers.length > 0 ? (totalSpend / customers.length).toFixed(2) : '0',
          topCountries: Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 5)
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'present_report',
    description: 'Present the analytics report.',
    inputSchema: {
      type: 'object',
      properties: {
        headline: {
          type: 'array',
          items: { type: 'object', properties: { metric: { type: 'string' }, value: { type: 'string' }, trend: { type: 'string' } } }
        },
        trends: { type: 'array', items: { type: 'string' } },
        alerts: { type: 'array', items: { type: 'string' } },
        recommendations: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' }
      },
      required: ['headline', 'summary']
    },
    async execute(input) {
      logger.header('Business Analytics Report')

      // Headlines
      for (const h of input.headline) {
        const trend = h.trend === 'up' ? '↑' : h.trend === 'down' ? '↓' : '→'
        logger.kv(h.metric, `${h.value} ${trend}`)
      }

      if (input.trends?.length) {
        logger.blank()
        logger.bold('Trends')
        for (const t of input.trends) logger.item(t)
      }

      if (input.alerts?.length) {
        logger.blank()
        logger.bold('Alerts')
        for (const a of input.alerts) logger.warn(a)
      }

      if (input.recommendations?.length) {
        logger.blank()
        logger.bold('Recommendations')
        for (const r of input.recommendations) logger.item(r)
      }

      logger.blank()
      logger.info(input.summary)

      return { displayed: true }
    }
  }
]

async function run(opts = {}) {
  logger.header('Analytics')
  logger.spin('Crunching numbers...')

  const period = opts.period || '30d'

  const result = await runAgent({
    system: SYSTEM,
    task: `Generate a comprehensive business analytics report for the last ${period}. Pull revenue data, product health, and customer analytics. Present clear headline numbers, trends, alerts, and recommendations.`,
    tools,
    maxIterations: 10,
    onAction(name) {
      if (name === 'get_revenue_data') logger.spin('Analyzing revenue...')
      if (name === 'get_product_health') logger.spin('Checking product health...')
      if (name === 'get_customer_data') logger.spin('Analyzing customers...')
    }
  })

  logger.stopSpin(result.success ? 'Analytics complete' : 'Analytics failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

// Quick status (for `dropship status`)
async function quickStatus() {
  logger.header('Store Status')
  logger.spin('Loading...')

  try {
    const shop = await shopify.getShopInfo()
    logger.stopSpin('Connected')
    logger.kv('Store', shop.name)
    logger.kv('Domain', shop.domain)

    const [products, orders] = await Promise.all([
      shopify.countProducts(),
      shopify.getOrders({ limit: '20', status: 'any' })
    ])

    const pendingOrders = orders.filter(o => !o.fulfillment_status || o.fulfillment_status === 'unfulfilled')
    const totalRevenue = orders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0)

    logger.kv('Products', products)
    logger.kv('Recent Orders', orders.length)
    logger.kv('Pending Fulfillment', pendingOrders.length)
    logger.kv('Recent Revenue', logger.money(totalRevenue))

    // DB status
    if (db.isAvailable()) {
      logger.kv('Database', 'Connected')
      const runs = await db.getRuns({ shop: config.getShop(), limit: 5 })
      if (runs.length > 0) {
        logger.blank()
        logger.bold('Recent Agent Runs')
        for (const r of runs) {
          const status = r.success ? '✓' : '✗'
          const time = new Date(r.created_at).toLocaleString()
          logger.item(`${status} ${r.agent_name} — ${time} (${r.duration_ms}ms)`)
        }
      }
    } else {
      logger.kv('Database', 'Not configured (local mode)')
    }
  } catch (err) {
    logger.stopSpin('Error', false)
    logger.error(err.message)
  }
}

export default { run, quickStatus }
