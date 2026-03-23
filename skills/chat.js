// Chat Skill — Interactive conversational mode
// Like Claude Code, but for your dropshipping business
// Talk to AI about your store, ask questions, get insights, take actions
import { createInterface } from 'readline'
import Anthropic from '@anthropic-ai/sdk'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 4096

const SYSTEM = `You are Dropship — an AI assistant that runs a dropshipping business. You're inside a terminal CLI, talking directly to the store operator.

You have tools to access real Shopify store data and CJ Dropshipping supplier data. Use them freely to answer questions with real numbers.

## Personality
- Direct, no fluff. You're a business partner, not a chatbot.
- Use real data. Never guess when you can look it up.
- Proactive — if you see a problem while answering, mention it.
- Format numbers nicely (currency, percentages).

## What You Can Do
- Pull store metrics (revenue, orders, products, customers)
- Check product performance and pricing
- Search CJ supplier catalog for products and pricing
- Analyze orders, fulfillment status, customer data
- Give strategic advice backed by actual store data
- Run quick calculations (margins, break-even, ROI)

When the user asks something, grab the relevant data first, then answer. Don't say "I would need to check" — just check.`

const tools = [
  {
    name: 'get_store_overview',
    description: 'Get store name, domain, plan, and basic info.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const [shop, products, orders] = await Promise.all([
          shopify.getShopInfo(),
          shopify.countProducts(),
          shopify.countOrders()
        ])
        return { name: shop.name, domain: shop.domain, plan: shop.plan_name, currency: shop.currency, products, orders }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'get_products',
    description: 'Get product catalog with prices, vendors, variants, and status.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max products to return (default 50)' }
      },
      required: []
    },
    async execute(input) {
      try {
        const products = await shopify.getProducts({ fields: 'id,title,variants,vendor,product_type,status,created_at' })
        const list = products.slice(0, input?.limit || 50).map(p => ({
          id: p.id,
          title: p.title,
          price: p.variants?.[0]?.price,
          compareAtPrice: p.variants?.[0]?.compare_at_price,
          sku: p.variants?.[0]?.sku,
          vendor: p.vendor,
          type: p.product_type,
          status: p.status,
          variants: (p.variants || []).length
        }))
        return { count: products.length, products: list }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'get_orders',
    description: 'Get recent orders with totals, fulfillment status, and line items.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter: any, open, closed, cancelled', default: 'any' },
        limit: { type: 'number', description: 'Max orders (default 30)' }
      },
      required: []
    },
    async execute(input) {
      try {
        const orders = await shopify.getOrders({ status: input?.status || 'any', limit: String(input?.limit || 30) })
        const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0)
        return {
          count: orders.length,
          totalRevenue: totalRevenue.toFixed(2),
          orders: orders.map(o => ({
            id: o.id,
            number: o.order_number,
            total: o.total_price,
            currency: o.currency,
            fulfillment: o.fulfillment_status || 'unfulfilled',
            financial: o.financial_status,
            createdAt: o.created_at,
            itemCount: (o.line_items || []).length,
            customer: o.email
          }))
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'get_customers',
    description: 'Get customer list with order counts and spend.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const customers = await shopify.getCustomers()
        return {
          count: customers.length,
          customers: customers.slice(0, 30).map(c => ({
            id: c.id,
            email: c.email,
            name: (c.first_name || '') + ' ' + (c.last_name || ''),
            orders: c.orders_count,
            totalSpent: c.total_spent,
            city: c.default_address?.city,
            country: c.default_address?.country
          }))
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'search_supplier',
    description: 'Search CJ Dropshipping catalog for products with real supplier prices.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Product keyword to search' }
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
            category: p.category,
            shippingDays: p.shippingDays,
            variants: (p.variants || []).length
          }))
        }
      } catch (err) {
        return { error: err.message, source: 'CJ Dropshipping' }
      }
    }
  },
  {
    name: 'get_inventory',
    description: 'Check inventory levels for specific products.',
    inputSchema: {
      type: 'object',
      properties: {
        productTitle: { type: 'string', description: 'Product title to search for' }
      },
      required: []
    },
    async execute() {
      try {
        const products = await shopify.getProducts({ fields: 'id,title,variants' })
        return {
          products: products.map(p => ({
            title: p.title,
            variants: (p.variants || []).map(v => ({
              sku: v.sku,
              price: v.price,
              inventoryQuantity: v.inventory_quantity
            }))
          }))
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'get_product_mappings',
    description: 'Get CJ-to-Shopify product mappings (which supplier products are linked to which store products).',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      const mappings = config.getProductMappings()
      return { count: Object.keys(mappings).length, mappings }
    }
  }
]

// Convert tools to Anthropic API format
const anthropicTools = tools.map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema
}))

async function run() {
  logger.header('Chat Mode')
  logger.dim('Talk to AI about your business. Type "exit" to quit.')
  logger.blank()

  const apiKey = config.getAnthropicKey()
  if (!apiKey) {
    logger.error('AI not configured. Run: dropship connect')
    return
  }

  const client = new Anthropic({ apiKey })
  const messages = []

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[32m  you › \x1b[0m'
  })

  rl.prompt()

  rl.on('line', async (line) => {
    const input = line.trim()
    if (!input) { rl.prompt(); return }
    if (input === 'exit' || input === 'quit' || input === 'q') {
      logger.blank()
      logger.dim('Session ended.')
      rl.close()
      return
    }

    // Pause input while processing
    rl.pause()

    messages.push({ role: 'user', content: input })

    try {
      // Agent loop — keep going until Claude stops calling tools
      let iterations = 0
      while (iterations < 10) {
        iterations++

        const res = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          temperature: 0.3,
          system: SYSTEM,
          tools: anthropicTools,
          messages
        })

        const textBlocks = res.content.filter(b => b.type === 'text')
        const toolBlocks = res.content.filter(b => b.type === 'tool_use')

        // Print any text
        if (textBlocks.length > 0) {
          logger.blank()
          const text = textBlocks.map(b => b.text).join('\n')
          // Indent AI response
          for (const line of text.split('\n')) {
            console.log('\x1b[36m  ai › \x1b[0m' + line)
          }
        }

        // If no tool calls, we're done with this turn
        if (toolBlocks.length === 0) {
          messages.push({ role: 'assistant', content: res.content })
          break
        }

        // Execute tool calls
        messages.push({ role: 'assistant', content: res.content })
        const toolResults = []

        for (const block of toolBlocks) {
          const tool = tools.find(t => t.name === block.name)
          if (!tool) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: `Unknown tool: ${block.name}` })
            })
            continue
          }

          try {
            logger.spin(`Checking ${block.name.replace(/_/g, ' ')}...`)
            const result = await tool.execute(block.input)
            logger.stopSpin(block.name.replace(/_/g, ' '))
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result)
            })
          } catch (err) {
            logger.stopSpin(block.name, false)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: err.message })
            })
          }
        }

        messages.push({ role: 'user', content: toolResults })
      }
    } catch (err) {
      logger.error(`AI error: ${err.message}`)
    }

    logger.blank()
    rl.resume()
    rl.prompt()
  })

  rl.on('close', () => {
    process.exit(0)
  })

  // Keep process alive
  await new Promise(() => {})
}

export default { run }
