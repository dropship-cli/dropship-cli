// Supplier Skill — Supplier search and management agent
// AI agent that evaluates suppliers, compares costs, and manages supplier relationships
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Supplier Agent — a supply chain optimization specialist.

Your job: Ensure the store has the best suppliers with the best margins and reliability.

## Supplier Evaluation Criteria
1. **Cost** — Product cost + shipping cost = total landed cost
2. **Speed** — Average shipping time to primary customer markets
3. **Reliability** — Order fulfillment accuracy, return rate
4. **Quality** — Product quality signals (reviews, defect rates)
5. **Margin Impact** — What's the real profit after all supplier costs?

## Process
1. Pull current products and their vendors/SKUs
2. Analyze current cost structure (price vs estimated costs)
3. Identify products with thin margins (<30%) that need cheaper suppliers
4. Identify single-supplier dependencies (risk)
5. Recommend supplier changes and new supplier opportunities

## Rules
- Products with <30% margin → FLAG for supplier review
- Products with only one supplier → FLAG as supply chain risk
- Always consider shipping time (>15 days = customer risk)
- Factor in return rates when calculating true supplier cost
- A 5% cheaper supplier with 2x the defect rate is NOT cheaper

## Real Supplier Data
If CJ Dropshipping is connected, use search_supplier_pricing to find REAL supplier costs for existing products. This gives you actual margins instead of estimates. Always prefer real data over guesses.

## Output
Specific product-level recommendations. "Switch Product X from Supplier A ($12) to Supplier B ($9) — saves $3/unit, 25% margin improvement"`

const tools = [
  {
    name: 'analyze_supply_chain',
    description: 'Analyze current products, vendors, and cost structure.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const [products, orders] = await Promise.all([
          shopify.getProducts({ fields: 'id,title,variants,vendor,product_type,status' }),
          shopify.getOrders({ limit: '50', status: 'any' })
        ])

        // Vendor analysis
        const vendors = {}
        const productData = []

        for (const p of products) {
          const vendor = p.vendor || 'Unknown'
          if (!vendors[vendor]) vendors[vendor] = { products: 0, totalPrice: 0 }
          vendors[vendor].products++

          const price = parseFloat(p.variants?.[0]?.price || 0)
          vendors[vendor].totalPrice += price

          productData.push({
            id: p.id,
            title: p.title,
            vendor,
            price: price.toFixed(2),
            sku: p.variants?.[0]?.sku || 'none',
            type: p.product_type,
            status: p.status,
            variantCount: (p.variants || []).length
          })
        }

        // Sales velocity
        const salesByProduct = {}
        for (const order of orders) {
          for (const item of (order.line_items || [])) {
            const pid = item.product_id
            if (!pid) continue
            if (!salesByProduct[pid]) salesByProduct[pid] = { units: 0, revenue: 0 }
            salesByProduct[pid].units += item.quantity
            salesByProduct[pid].revenue += parseFloat(item.price) * item.quantity
          }
        }

        // Enrich product data with sales
        for (const p of productData) {
          const sales = salesByProduct[p.id]
          p.unitsSold = sales?.units || 0
          p.revenue = sales?.revenue?.toFixed(2) || '0'
        }

        const vendorSummary = Object.entries(vendors).map(([name, data]) => ({
          name,
          products: data.products,
          avgPrice: (data.totalPrice / data.products).toFixed(2)
        })).sort((a, b) => b.products - a.products)

        return {
          totalProducts: products.length,
          vendorCount: vendorSummary.length,
          vendors: vendorSummary,
          singleVendorRisk: vendorSummary.length === 1,
          products: productData.sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 30)
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'estimate_margins',
    description: 'Estimate margins based on typical dropshipping cost structures.',
    inputSchema: {
      type: 'object',
      properties: {
        products: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              price: { type: 'number' },
              estimatedCost: { type: 'number', description: 'Your estimate of supplier cost' },
              estimatedShipping: { type: 'number' }
            }
          }
        }
      },
      required: ['products']
    },
    async execute(input) {
      const results = input.products.map(p => {
        const totalCost = (p.estimatedCost || 0) + (p.estimatedShipping || 3)
        const margin = p.price > 0 ? ((p.price - totalCost) / p.price * 100) : 0
        return {
          title: p.title,
          price: p.price,
          estimatedCost: p.estimatedCost,
          estimatedShipping: p.estimatedShipping || 3,
          totalLandedCost: totalCost,
          estimatedMargin: margin.toFixed(1) + '%',
          healthy: margin >= 40,
          warning: margin >= 25 && margin < 40,
          critical: margin < 25
        }
      })

      return {
        analyzed: results.length,
        healthy: results.filter(r => r.healthy).length,
        warning: results.filter(r => r.warning).length,
        critical: results.filter(r => r.critical).length,
        products: results
      }
    }
  },
  {
    name: 'search_supplier_pricing',
    description: 'Search CJ Dropshipping for a product to get real supplier pricing. Compare actual supplier costs against the store selling price.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Product name or keyword to search' },
        currentPrice: { type: 'number', description: 'Current selling price on Shopify' }
      },
      required: ['keyword']
    },
    async execute(input) {
      try {
        const cj = await import('../lib/cj.js')
        const results = await cj.searchProducts(input.keyword, { pageSize: 5 })
        return {
          source: 'CJ Dropshipping',
          count: results.length,
          results: results.map(p => ({
            title: p.title,
            supplierPrice: p.price,
            currentRetailPrice: input.currentPrice || null,
            margin: input.currentPrice
              ? ((input.currentPrice - p.price - 3) / input.currentPrice * 100).toFixed(1) + '%'
              : 'unknown',
            shippingDays: p.shippingDays,
            variants: (p.variants || []).length
          }))
        }
      } catch (err) {
        return { error: err.message, source: 'CJ Dropshipping', results: [] }
      }
    }
  },
  {
    name: 'present_supplier_report',
    description: 'Present the supplier analysis report.',
    inputSchema: {
      type: 'object',
      properties: {
        vendorHealth: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              vendor: { type: 'string' },
              grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
              products: { type: 'number' },
              findings: { type: 'string' }
            }
          }
        },
        marginAlerts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product: { type: 'string' },
              currentMargin: { type: 'string' },
              recommendation: { type: 'string' }
            }
          }
        },
        supplyChainRisks: { type: 'array', items: { type: 'string' } },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              priority: { type: 'string' },
              action: { type: 'string' },
              impact: { type: 'string' }
            }
          }
        },
        summary: { type: 'string' }
      },
      required: ['recommendations', 'summary']
    },
    async execute(input) {
      logger.header('Supplier Analysis Report')

      if (input.vendorHealth?.length) {
        logger.bold('Vendor Health')
        for (const v of input.vendorHealth) {
          logger.kv(`  ${v.vendor} (${v.grade})`, `${v.products} products`)
          if (v.findings) logger.dim(`    ${v.findings}`)
        }
        logger.blank()
      }

      if (input.marginAlerts?.length) {
        logger.bold('Margin Alerts')
        for (const m of input.marginAlerts) {
          logger.warn(`${m.product}: ${m.currentMargin}`)
          logger.dim(`  → ${m.recommendation}`)
        }
        logger.blank()
      }

      if (input.supplyChainRisks?.length) {
        logger.bold('Supply Chain Risks')
        for (const r of input.supplyChainRisks) logger.error(r)
        logger.blank()
      }

      logger.bold('Recommendations')
      for (const r of input.recommendations) {
        const icon = r.priority === 'HIGH' ? '🔴' : r.priority === 'MEDIUM' ? '🟡' : '🟢'
        logger.info(`${icon} ${r.action}`)
        if (r.impact) logger.dim(`   Impact: ${r.impact}`)
      }

      logger.divider()
      logger.info(input.summary)

      await db.logAction({
        shop: config.getShop(),
        type: 'SUPPLIER',
        message: `Supplier analysis: ${input.recommendations.length} recommendations`,
        metadata: { alerts: input.marginAlerts?.length || 0, risks: input.supplyChainRisks?.length || 0 }
      })

      return { displayed: true }
    }
  }
]

async function run() {
  logger.header('Supplier Management')
  logger.spin('Analyzing supply chain...')

  const result = await runAgent({
    system: SYSTEM,
    task: 'Perform a comprehensive supplier and supply chain analysis. Analyze vendors, estimate margins, identify supply chain risks, and provide specific recommendations for improving supplier relationships and margins.',
    tools,
    maxIterations: 10,
    onAction(name) {
      if (name === 'analyze_supply_chain') logger.spin('Analyzing supply chain...')
      if (name === 'estimate_margins') logger.spin('Estimating margins...')
      if (name === 'search_supplier_pricing') logger.spin('Checking real supplier prices...')
    }
  })

  logger.stopSpin(result.success ? 'Supplier analysis complete' : 'Supplier analysis failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
