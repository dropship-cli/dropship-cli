// Profit Skill — Real P&L profit analysis agent
// AI agent that calculates true profit after ALL costs: COGS, shipping, fees, ad spend
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Profit Agent — a ruthless financial analyst.

Your job: Calculate REAL profit. Not vanity revenue. REAL profit after every cost.

## True Profit Formula
Revenue
  - COGS (cost of goods / supplier cost, typically 30-40% of retail)
  - Shipping costs (est $3-8 per order for dropshipping)
  - Payment processing fees (2.9% + $0.30 per transaction — Shopify Payments)
  - Shopify subscription ($39/month for Basic, $105 for Shopify, $399 for Advanced)
  - App fees (estimate $50-200/month for typical stack)
  - Refund costs (refunds + return shipping eat into profit)
  - Ad spend (if running ads)
= TRUE PROFIT

## Metrics to Calculate
1. **Gross Margin** — Revenue minus COGS
2. **Net Margin** — After ALL costs
3. **Profit per Order** — Average true profit per order
4. **Break-even Orders** — How many orders/day to cover fixed costs
5. **Burn Rate** — If losing money, how fast?
6. **Money Losers** — Products that lose money on every sale
7. **Profit Champions** — Products with the highest absolute profit contribution

## Rules
- NEVER use revenue as a success metric alone
- Always estimate conservatively (assume higher costs, not lower)
- A $50 product with 60% margin beats a $100 product with 20% margin
- Factor in return rates (industry average 15-20% for dropshipping)
- Flag any product where estimated true margin < 15%

Be brutally honest. "You made $5,000 in revenue but only $800 in profit" is more useful than "Revenue is $5,000!"`

const tools = [
  {
    name: 'get_financial_data',
    description: 'Get all financial data for profit analysis.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const orders = await shopify.getOrders({ limit: '100', status: 'any' })

        let totalRevenue = 0
        let totalOrders = 0
        let totalItems = 0
        let refundedOrders = 0
        let refundedRevenue = 0
        const productRevenue = {}

        for (const order of orders) {
          const rev = parseFloat(order.total_price || 0)

          if (order.financial_status === 'refunded') {
            refundedOrders++
            refundedRevenue += rev
            continue
          }
          if (order.financial_status === 'partially_refunded') {
            refundedOrders++
            refundedRevenue += rev * 0.5 // estimate
          }

          totalOrders++
          totalRevenue += rev

          for (const item of (order.line_items || [])) {
            totalItems += item.quantity
            const key = item.title
            if (!productRevenue[key]) productRevenue[key] = { title: key, revenue: 0, units: 0, price: parseFloat(item.price) }
            productRevenue[key].revenue += parseFloat(item.price) * item.quantity
            productRevenue[key].units += item.quantity
          }
        }

        const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0

        // Payment processing fees (Shopify Payments: 2.9% + $0.30)
        const processingFees = totalOrders * 0.30 + totalRevenue * 0.029

        // Product breakdown sorted by revenue
        const productBreakdown = Object.values(productRevenue)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 20)

        return {
          totalRevenue: totalRevenue.toFixed(2),
          totalOrders,
          totalItems,
          aov: aov.toFixed(2),
          refundedOrders,
          refundedRevenue: refundedRevenue.toFixed(2),
          refundRate: orders.length > 0 ? ((refundedOrders / orders.length) * 100).toFixed(1) + '%' : '0%',
          processingFees: processingFees.toFixed(2),
          productBreakdown,
          ordersAnalyzed: orders.length
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'get_product_costs',
    description: 'Get product data to estimate COGS.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const products = await shopify.getProducts({ fields: 'id,title,variants,vendor,product_type' })
        return {
          products: products.map(p => ({
            id: p.id,
            title: p.title,
            price: p.variants?.[0]?.price,
            compareAtPrice: p.variants?.[0]?.compare_at_price,
            sku: p.variants?.[0]?.sku,
            vendor: p.vendor,
            type: p.product_type
          }))
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'present_profit_report',
    description: 'Present the P&L profit analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        pnl: {
          type: 'object',
          properties: {
            revenue: { type: 'string' },
            estimatedCOGS: { type: 'string' },
            grossProfit: { type: 'string' },
            grossMargin: { type: 'string' },
            processingFees: { type: 'string' },
            estimatedShipping: { type: 'string' },
            refundCosts: { type: 'string' },
            estimatedFixedCosts: { type: 'string', description: 'Shopify + apps + tools' },
            estimatedAdSpend: { type: 'string' },
            netProfit: { type: 'string' },
            netMargin: { type: 'string' }
          }
        },
        perOrderMetrics: {
          type: 'object',
          properties: {
            avgRevenue: { type: 'string' },
            avgCost: { type: 'string' },
            avgProfit: { type: 'string' },
            breakEvenOrders: { type: 'string', description: 'Orders/month needed to break even' }
          }
        },
        profitChampions: { type: 'array', items: { type: 'object', properties: { product: { type: 'string' }, margin: { type: 'string' }, contribution: { type: 'string' } } } },
        moneyLosers: { type: 'array', items: { type: 'object', properties: { product: { type: 'string' }, margin: { type: 'string' }, issue: { type: 'string' } } } },
        recommendations: { type: 'array', items: { type: 'string' } },
        verdict: { type: 'string', description: 'One-line verdict on profitability' },
        summary: { type: 'string' }
      },
      required: ['pnl', 'verdict', 'summary']
    },
    async execute(input) {
      logger.header('Profit & Loss Analysis')
      logger.bold(input.verdict)
      logger.blank()

      // P&L
      const pnl = input.pnl
      if (pnl) {
        logger.bold('P&L Statement')
        logger.kv('  Revenue', pnl.revenue)
        logger.kv('  COGS (est)', `- ${pnl.estimatedCOGS}`)
        logger.kv('  Gross Profit', pnl.grossProfit)
        logger.kv('  Gross Margin', pnl.grossMargin)
        logger.divider()
        logger.kv('  Processing Fees', `- ${pnl.processingFees}`)
        logger.kv('  Shipping (est)', `- ${pnl.estimatedShipping}`)
        logger.kv('  Refund Costs', `- ${pnl.refundCosts}`)
        logger.kv('  Fixed Costs (est)', `- ${pnl.estimatedFixedCosts}`)
        if (pnl.estimatedAdSpend && pnl.estimatedAdSpend !== '$0') {
          logger.kv('  Ad Spend (est)', `- ${pnl.estimatedAdSpend}`)
        }
        logger.divider()
        logger.kv('  NET PROFIT', pnl.netProfit)
        logger.kv('  Net Margin', pnl.netMargin)
        logger.blank()
      }

      // Per-order
      if (input.perOrderMetrics) {
        const po = input.perOrderMetrics
        logger.bold('Per-Order Metrics')
        logger.kv('  Avg Revenue', po.avgRevenue)
        logger.kv('  Avg Cost', po.avgCost)
        logger.kv('  Avg Profit', po.avgProfit)
        logger.kv('  Break-even', `${po.breakEvenOrders} orders/month`)
        logger.blank()
      }

      // Champions & Losers
      if (input.profitChampions?.length) {
        logger.bold('Profit Champions')
        for (const p of input.profitChampions) {
          logger.success(`${p.product} — ${p.margin} margin, ${p.contribution} contribution`)
        }
        logger.blank()
      }

      if (input.moneyLosers?.length) {
        logger.bold('Money Losers')
        for (const p of input.moneyLosers) {
          logger.error(`${p.product} — ${p.margin} margin`)
          logger.dim(`  ${p.issue}`)
        }
        logger.blank()
      }

      if (input.recommendations?.length) {
        logger.bold('Recommendations')
        for (const r of input.recommendations) logger.item(r)
        logger.blank()
      }

      logger.divider()
      logger.info(input.summary)

      await db.logAction({
        shop: config.getShop(),
        type: 'PROFIT',
        message: `P&L: ${pnl?.netProfit || 'calculated'} net profit, ${pnl?.netMargin || '?'} margin`,
        metadata: { netProfit: pnl?.netProfit, netMargin: pnl?.netMargin }
      })

      return { displayed: true }
    }
  }
]

async function run() {
  logger.header('Profit Analysis')
  logger.spin('Crunching the real numbers...')

  const result = await runAgent({
    system: SYSTEM,
    task: 'Run a complete profit analysis. Pull all financial and product data. Calculate true profit after ALL costs (COGS, shipping, processing fees, refunds, fixed costs). Identify profit champions and money losers. Present a P&L statement.',
    tools,
    maxIterations: 10,
    onAction(name) {
      if (name === 'get_financial_data') logger.spin('Pulling financial data...')
      if (name === 'get_product_costs') logger.spin('Estimating product costs...')
    }
  })

  logger.stopSpin(result.success ? 'Profit analysis complete' : 'Profit analysis failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
