// Forecast Skill — Inventory and revenue forecasting agent
// AI agent that predicts stockouts, revenue trends, and cash flow
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Forecasting Agent — a predictive analytics specialist.

Your job: See the future. Predict stockouts, revenue trends, and cash flow problems BEFORE they happen.

## Forecasting Models

### Inventory Forecasting
- Calculate daily sales velocity per product
- Days of stock remaining = current inventory / daily velocity
- If days remaining < 7 → URGENT reorder
- If days remaining < 14 → WARNING
- Account for lead time (supplier shipping = 7-15 days for dropshipping)

### Revenue Forecasting
- Linear trend: Compare last 7d to previous 7d
- Weekly seasonality: Some days sell more than others
- Project next 7d and next 30d revenue
- Flag if trending down >10% week-over-week

### Cash Flow Signals
- Revenue per day vs estimated costs per day
- If revenue declining + costs stable = margin squeeze
- If AOV declining = possible market/pricing issue
- If order volume declining but AOV up = fewer but bigger orders (may be OK)

## Rules
- Always show confidence level (HIGH/MEDIUM/LOW) for each forecast
- Base forecasts on real data, not guesses
- If insufficient data (<10 orders), say so and provide wider ranges
- Separate leading indicators (traffic, AOV trend) from lagging (revenue, profit)

Be precise. "$4,200 ± $500 next 7 days (MEDIUM confidence, based on 42 orders)" not "revenue should be okay".`

const tools = [
  {
    name: 'get_historical_data',
    description: 'Get historical orders and inventory for forecasting.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const [products, orders] = await Promise.all([
          shopify.getProducts({ fields: 'id,title,variants,status' }),
          shopify.getOrders({ limit: '250', status: 'any' })
        ])

        const now = Date.now()

        // Daily revenue
        const dailyData = {}
        for (const o of orders) {
          if (o.financial_status === 'refunded') continue
          const day = o.created_at.split('T')[0]
          if (!dailyData[day]) dailyData[day] = { revenue: 0, orders: 0, items: 0 }
          dailyData[day].revenue += parseFloat(o.total_price || 0)
          dailyData[day].orders++
          dailyData[day].items += (o.line_items || []).reduce((s, i) => s + i.quantity, 0)
        }

        // Product velocity (sales per day)
        const productVelocity = {}
        const ordersByProduct = {}
        for (const o of orders) {
          for (const item of (o.line_items || [])) {
            const pid = item.product_id
            if (!pid) continue
            if (!ordersByProduct[pid]) ordersByProduct[pid] = []
            ordersByProduct[pid].push({
              quantity: item.quantity,
              date: o.created_at
            })
          }
        }

        // Calculate velocity (units per day over last 30 days)
        const thirtyDaysAgo = now - 30 * 86400000
        for (const [pid, sales] of Object.entries(ordersByProduct)) {
          const recentSales = sales.filter(s => new Date(s.date) > new Date(thirtyDaysAgo))
          const totalUnits = recentSales.reduce((s, sale) => s + sale.quantity, 0)
          productVelocity[pid] = {
            totalUnits30d: totalUnits,
            dailyVelocity: (totalUnits / 30).toFixed(2)
          }
        }

        // Inventory status
        const inventoryForecast = products
          .filter(p => p.status === 'active')
          .map(p => {
            const variant = p.variants?.[0]
            const qty = variant?.inventory_quantity
            const vel = productVelocity[p.id]
            const dailyRate = vel ? parseFloat(vel.dailyVelocity) : 0
            const daysRemaining = qty !== undefined && dailyRate > 0 ? Math.round(qty / dailyRate) : null

            return {
              title: p.title,
              currentStock: qty ?? 'untracked',
              dailyVelocity: dailyRate,
              unitsSold30d: vel?.totalUnits30d || 0,
              daysOfStockRemaining: daysRemaining,
              status: daysRemaining === null ? 'untracked'
                : daysRemaining <= 0 ? 'OUT_OF_STOCK'
                : daysRemaining < 7 ? 'URGENT'
                : daysRemaining < 14 ? 'WARNING'
                : 'HEALTHY'
            }
          })
          .sort((a, b) => {
            const order = { OUT_OF_STOCK: 0, URGENT: 1, WARNING: 2, HEALTHY: 3, untracked: 4 }
            return (order[a.status] || 5) - (order[b.status] || 5)
          })

        // Weekly comparison
        const last7d = Object.entries(dailyData)
          .filter(([d]) => new Date(d) > new Date(now - 7 * 86400000))
          .reduce((s, [, v]) => s + v.revenue, 0)
        const prev7d = Object.entries(dailyData)
          .filter(([d]) => {
            const date = new Date(d)
            return date > new Date(now - 14 * 86400000) && date <= new Date(now - 7 * 86400000)
          })
          .reduce((s, [, v]) => s + v.revenue, 0)

        const weekOverWeekRaw = prev7d > 0 ? ((last7d - prev7d) / prev7d * 100).toFixed(1) : null
        const weekOverWeek = weekOverWeekRaw !== null ? weekOverWeekRaw + '%' : 'N/A'

        return {
          dailyRevenue: dailyData,
          totalDays: Object.keys(dailyData).length,
          last7dRevenue: last7d.toFixed(2),
          prev7dRevenue: prev7d.toFixed(2),
          weekOverWeekChange: weekOverWeek,
          averageDailyRevenue: Object.keys(dailyData).length > 0
            ? (Object.values(dailyData).reduce((s, d) => s + d.revenue, 0) / Object.keys(dailyData).length).toFixed(2)
            : '0',
          inventoryForecast: inventoryForecast.slice(0, 20),
          urgentRestocks: inventoryForecast.filter(i => i.status === 'URGENT' || i.status === 'OUT_OF_STOCK').length,
          totalProducts: products.length
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'present_forecast',
    description: 'Present the forecast report.',
    inputSchema: {
      type: 'object',
      properties: {
        revenueForecast: {
          type: 'object',
          properties: {
            next7d: { type: 'string' },
            next30d: { type: 'string' },
            confidence: { type: 'string' },
            trend: { type: 'string', enum: ['growing', 'stable', 'declining'] },
            reasoning: { type: 'string' }
          }
        },
        inventoryAlerts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product: { type: 'string' },
              status: { type: 'string' },
              daysRemaining: { type: 'number' },
              action: { type: 'string' }
            }
          }
        },
        cashFlowSignals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              signal: { type: 'string' },
              severity: { type: 'string' },
              action: { type: 'string' }
            }
          }
        },
        summary: { type: 'string' }
      },
      required: ['revenueForecast', 'summary']
    },
    async execute(input) {
      logger.header('Business Forecast')

      // Revenue
      const rf = input.revenueForecast
      const trendIcon = rf.trend === 'growing' ? '↑' : rf.trend === 'declining' ? '↓' : '→'
      logger.bold(`Revenue Trend: ${trendIcon} ${rf.trend?.toUpperCase()}`)
      logger.kv('Next 7 days', rf.next7d)
      logger.kv('Next 30 days', rf.next30d)
      logger.kv('Confidence', rf.confidence)
      if (rf.reasoning) logger.dim(rf.reasoning)
      logger.blank()

      // Inventory
      if (input.inventoryAlerts?.length) {
        logger.bold('Inventory Alerts')
        for (const a of input.inventoryAlerts) {
          const icon = a.status === 'OUT_OF_STOCK' || a.status === 'URGENT' ? '🔴'
            : a.status === 'WARNING' ? '🟡' : '🟢'
          logger.info(`${icon} ${a.product}`)
          logger.dim(`   ${a.daysRemaining !== undefined ? a.daysRemaining + ' days remaining — ' : ''}${a.action}`)
        }
        logger.blank()
      }

      // Cash flow
      if (input.cashFlowSignals?.length) {
        logger.bold('Cash Flow Signals')
        for (const s of input.cashFlowSignals) {
          const icon = s.severity === 'high' ? '🔴' : s.severity === 'medium' ? '🟡' : 'ℹ️'
          logger.info(`${icon} ${s.signal}`)
          if (s.action) logger.dim(`   → ${s.action}`)
        }
        logger.blank()
      }

      logger.divider()
      logger.info(input.summary)

      await db.logAction({
        shop: config.getShop(),
        type: 'FORECAST',
        message: `Forecast: ${rf.trend}, ${input.inventoryAlerts?.length || 0} inventory alerts`,
        metadata: { trend: rf.trend, confidence: rf.confidence }
      })

      return { displayed: true }
    }
  }
]

async function run() {
  logger.header('Business Forecasting')
  logger.spin('Building forecasts...')

  const result = await runAgent({
    system: SYSTEM,
    task: 'Build comprehensive forecasts for this business. Analyze historical data, predict revenue for next 7 and 30 days, identify inventory stockout risks, and flag cash flow signals. Be specific with numbers and confidence levels.',
    tools,
    maxIterations: 8,
    onAction(name) {
      if (name === 'get_historical_data') logger.spin('Analyzing historical data...')
    }
  })

  logger.stopSpin(result.success ? 'Forecasting complete' : 'Forecasting failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
