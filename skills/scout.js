// Scout Skill — Find trending products to sell
// AI agent that scouts market trends and finds winning products
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Product Scout — an elite trend hunter for a dropshipping store.

Your job: Find 3-5 products that will SELL. Not random items. Winners.

## What Makes a Winner
- Solves a real problem or triggers impulse buys
- $15-80 retail price sweet spot (3x+ markup from supplier)
- Lightweight (cheap to ship)
- Not easily found in local stores
- Rising search interest / social media buzz
- Low competition on the store's existing catalog

## Process
1. Check the store's current catalog to avoid duplicates
2. Analyze current trends (use your knowledge of what's trending)
3. Score each product on: demand, margin potential, competition, shipping ease
4. Present top picks with suggested retail price and estimated margin

## Supplier Catalog
If CJ Dropshipping is connected, use search_supplier_catalog to find REAL products with real supplier prices. This is far better than guessing — you get actual cost, actual availability. Search for products related to the store's niche and current catalog gaps.

Be specific. Real product names, real prices, real reasoning.`

const tools = [
  {
    name: 'get_current_products',
    description: 'Get the store\'s current product catalog to avoid duplicates.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const products = await shopify.getProducts({ fields: 'id,title,product_type,vendor,variants' })
        return {
          count: products.length,
          products: products.map(p => ({
            title: p.title,
            type: p.product_type,
            vendor: p.vendor,
            price: p.variants?.[0]?.price
          }))
        }
      } catch (err) {
        return { error: err.message, count: 0, products: [] }
      }
    }
  },
  {
    name: 'get_store_info',
    description: 'Get store details to understand the niche.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const shop = await shopify.getShopInfo()
        return { name: shop.name, domain: shop.domain, currency: shop.currency }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'get_recent_orders',
    description: 'Check recent orders to see what\'s already selling well.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const orders = await shopify.getOrders({ limit: '30', status: 'any' })
        const productCounts = {}
        for (const order of orders) {
          for (const item of (order.line_items || [])) {
            productCounts[item.title] = (productCounts[item.title] || 0) + item.quantity
          }
        }
        const sorted = Object.entries(productCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([title, qty]) => ({ title, unitsSold: qty }))

        return { totalOrders: orders.length, topSellers: sorted }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'search_supplier_catalog',
    description: 'Search CJ Dropshipping catalog for real products with real prices. Use this to find actual products available from suppliers.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Product keyword to search (e.g. "LED desk lamp", "phone case")' }
      },
      required: ['keyword']
    },
    async execute(input) {
      try {
        const cj = await import('../lib/cj.js')
        const products = await cj.searchProducts(input.keyword, { pageSize: 10 })
        return {
          source: 'CJ Dropshipping',
          count: products.length,
          products: products.map(p => ({
            id: p.id,
            title: p.title,
            supplierPrice: p.price,
            image: p.image,
            category: p.category,
            shippingDays: p.shippingDays,
            variants: (p.variants || []).length
          }))
        }
      } catch (err) {
        return { error: err.message, source: 'CJ Dropshipping', products: [] }
      }
    }
  },
  {
    name: 'present_recommendations',
    description: 'Present final product recommendations to the operator.',
    inputSchema: {
      type: 'object',
      properties: {
        products: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              category: { type: 'string' },
              estimatedCost: { type: 'number', description: 'Supplier cost in USD' },
              suggestedPrice: { type: 'number', description: 'Retail price in USD' },
              estimatedMargin: { type: 'number', description: 'Margin percentage' },
              demandScore: { type: 'number', description: '1-10 demand score' },
              reasoning: { type: 'string' }
            },
            required: ['name', 'category', 'estimatedCost', 'suggestedPrice', 'reasoning']
          }
        },
        summary: { type: 'string' }
      },
      required: ['products', 'summary']
    },
    async execute(input) {
      // Display recommendations
      logger.header('Product Recommendations')
      for (const p of input.products) {
        logger.bold(`${p.name}`)
        logger.kv('Category', p.category)
        logger.kv('Cost', logger.money(p.estimatedCost))
        logger.kv('Price', logger.money(p.suggestedPrice))
        logger.kv('Margin', logger.pct(p.estimatedMargin || ((p.suggestedPrice - p.estimatedCost) / p.suggestedPrice * 100)))
        logger.kv('Demand', `${p.demandScore || '?'}/10`)
        logger.dim(p.reasoning)
        logger.divider()
      }
      logger.blank()
      logger.info(input.summary)

      // Log to DB if available
      await db.logAction({
        shop: config.getShop(),
        type: 'SCOUT',
        message: `Found ${input.products.length} product recommendations`,
        metadata: { products: input.products }
      })

      return { displayed: true, count: input.products.length }
    }
  }
]

async function run(opts = {}) {
  logger.header('Product Scout')
  logger.spin('Scouting for winning products...')

  const task = opts.niche
    ? `Find ${opts.count || 5} winning products in the "${opts.niche}" niche. Check what the store already sells, then find products that complement or expand the catalog.`
    : `Find ${opts.count || 5} winning products for this store. Check the current catalog and recent sales, identify gaps, and recommend high-margin products that fit the store's brand.`

  const result = await runAgent({
    system: SYSTEM,
    task,
    tools,
    maxIterations: 8,
    onAction(name) {
      if (name === 'get_current_products') logger.spin('Checking current catalog...')
      if (name === 'get_store_info') logger.spin('Reading store info...')
      if (name === 'get_recent_orders') logger.spin('Analyzing recent sales...')
      if (name === 'search_supplier_catalog') logger.spin('Searching supplier catalog...')
      if (name === 'present_recommendations') logger.stopSpin('Analysis complete')
    }
  })

  logger.stopSpin(result.success ? 'Scout complete' : 'Scout failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
