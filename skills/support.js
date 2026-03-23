// Support Skill — Customer ticket handling
// AI agent that drafts responses, handles refunds, resolves issues
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Support Agent — a customer satisfaction specialist.

Your job: Handle customer issues quickly and fairly. Happy customers = repeat revenue.

## Resolution Priorities
1. **Shipping Issues** — "Where is my order?" → Check fulfillment status, provide tracking
2. **Refund Requests** — Evaluate legitimacy, recommend approve/deny with reasoning
3. **Product Issues** — Defective/wrong item → Recommend replacement or refund
4. **General Inquiries** — Answer quickly, upsell when appropriate

## Response Rules
- ALWAYS be empathetic (even if the customer is wrong)
- Use the customer's first name
- Provide specific information (tracking numbers, dates, amounts)
- If order is unfulfilled for 48h+ → apologize and prioritize fulfillment
- Refund threshold: Auto-approve under $25, flag above for review
- Response length: 2-4 sentences. Concise, helpful, warm.

## Tone
Professional but human. Not robotic. Not overly casual.
"Hi Sarah, I've checked on your order and..." not "Dear Valued Customer..."

Present all draft responses for operator review before sending.`

const tools = [
  {
    name: 'get_recent_orders',
    description: 'Get recent orders to identify potential support issues.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const orders = await shopify.getOrders({ limit: '30', status: 'any' })
        const now = Date.now()

        const issues = []
        for (const o of orders) {
          const ageHours = (now - new Date(o.created_at)) / 3600000

          // Stale unfulfilled
          if ((!o.fulfillment_status || o.fulfillment_status === 'unfulfilled') && ageHours > 48) {
            issues.push({
              type: 'stale_order',
              orderId: o.id,
              orderNumber: o.order_number,
              customer: o.customer?.first_name || o.email,
              email: o.email,
              age: Math.round(ageHours) + 'h',
              total: o.total_price
            })
          }

          // Refunded
          if (o.financial_status === 'refunded' || o.financial_status === 'partially_refunded') {
            issues.push({
              type: 'refund',
              orderId: o.id,
              orderNumber: o.order_number,
              customer: o.customer?.first_name || o.email,
              email: o.email,
              total: o.total_price,
              status: o.financial_status
            })
          }
        }

        return {
          totalOrders: orders.length,
          potentialIssues: issues,
          issueCount: issues.length
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'look_up_order',
    description: 'Look up a specific order by number or email.',
    inputSchema: {
      type: 'object',
      properties: {
        orderNumber: { type: 'string' },
        email: { type: 'string' }
      },
      required: []
    },
    async execute(input) {
      try {
        const params = {}
        if (input.email) params.email = input.email
        const orders = await shopify.getOrders({ ...params, limit: '10', status: 'any' })

        if (input.orderNumber) {
          const match = orders.find(o => String(o.order_number) === input.orderNumber)
          if (match) return { found: true, order: formatOrder(match) }
        }

        return {
          found: orders.length > 0,
          orders: orders.slice(0, 5).map(formatOrder)
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'draft_response',
    description: 'Draft a customer support response for operator review.',
    inputSchema: {
      type: 'object',
      properties: {
        customerName: { type: 'string' },
        customerEmail: { type: 'string' },
        issueType: { type: 'string' },
        response: { type: 'string', description: 'The drafted response' },
        action: { type: 'string', description: 'Recommended action (send, refund, escalate, etc.)' },
        amount: { type: 'number', description: 'Refund amount if applicable' }
      },
      required: ['customerName', 'issueType', 'response', 'action']
    },
    async execute(input) {
      logger.blank()
      logger.bold(`[${input.issueType.toUpperCase()}] ${input.customerName}`)
      if (input.customerEmail) logger.dim(input.customerEmail)
      logger.blank()
      logger.info('Draft Response:')
      console.log('')
      // Print response with indentation
      for (const line of input.response.split('\n')) {
        console.log(`    ${line}`)
      }
      console.log('')
      logger.kv('Action', input.action)
      if (input.amount) logger.kv('Amount', logger.money(input.amount))
      logger.divider()

      await db.logAction({
        shop: config.getShop(),
        type: 'SUPPORT',
        message: `Drafted ${input.issueType} response for ${input.customerName}`,
        metadata: { action: input.action, issueType: input.issueType }
      })

      return { drafted: true }
    }
  },
  {
    name: 'present_support_summary',
    description: 'Present the support session summary.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketsReviewed: { type: 'number' },
        responsesDrafted: { type: 'number' },
        refundsRecommended: { type: 'number' },
        totalRefundAmount: { type: 'number' },
        summary: { type: 'string' }
      },
      required: ['summary']
    },
    async execute(input) {
      logger.header('Support Summary')
      logger.kv('Tickets Reviewed', input.ticketsReviewed || 0)
      logger.kv('Responses Drafted', input.responsesDrafted || 0)
      if (input.refundsRecommended) {
        logger.kv('Refunds Recommended', input.refundsRecommended)
        logger.kv('Total Refund Amount', logger.money(input.totalRefundAmount || 0))
      }
      logger.blank()
      logger.info(input.summary)
      return { displayed: true }
    }
  }
]

function formatOrder(o) {
  return {
    id: o.id,
    number: o.order_number,
    email: o.email,
    customer: o.customer?.first_name,
    total: o.total_price,
    financial: o.financial_status,
    fulfillment: o.fulfillment_status || 'unfulfilled',
    created: o.created_at,
    items: (o.line_items || []).map(i => ({ title: i.title, qty: i.quantity, price: i.price }))
  }
}

async function run() {
  logger.header('Customer Support')
  logger.spin('Scanning for customer issues...')

  const result = await runAgent({
    system: SYSTEM,
    task: 'Scan recent orders for potential customer issues (stale fulfillments, refunds, etc). For each issue found, draft a professional support response. Present all drafts for operator review. Summarize at the end.',
    tools,
    maxIterations: 12,
    onAction(name) {
      if (name === 'get_recent_orders') logger.spin('Scanning orders...')
      if (name === 'look_up_order') logger.spin('Looking up order...')
    }
  })

  logger.stopSpin(result.success ? 'Support scan complete' : 'Support scan failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
