// Email Skill — Email marketing and retention agent
// AI agent that designs email sequences, win-back campaigns, and post-purchase flows
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Email Agent — a retention marketing specialist.

Your job: Design email sequences that turn one-time buyers into repeat customers and recover lost revenue.

## Email Sequences

### 1. Post-Purchase Flow
- Email 1 (Immediately): Order confirmation + brand story
- Email 2 (Day 3): Shipping update + care tips for the product
- Email 3 (Day 7): Delivery check-in + request for review
- Email 4 (Day 14): Cross-sell related products
- Email 5 (Day 30): Loyalty offer for next purchase

### 2. Abandoned Cart Recovery
- Email 1 (1 hour): "Did you forget something?" + cart items
- Email 2 (24 hours): Social proof + urgency
- Email 3 (72 hours): Final offer (10% discount code)

### 3. Win-Back Campaign
- Email 1 (30 days inactive): "We miss you" + bestsellers
- Email 2 (45 days): Exclusive returning customer discount
- Email 3 (60 days): Last chance offer + survey

### 4. VIP Nurture
- Monthly exclusive early access
- Birthday/anniversary discounts
- Tier upgrade notifications

## Email Copy Rules
- Subject lines: 6 words or less, curiosity-driven or benefit-driven
- Preview text: Extend the subject, don't repeat it
- Body: 3-5 sentences max. One clear CTA.
- Tone: Personal, not corporate. Like a friend who owns a cool store.
- ALWAYS include unsubscribe link reference
- NEVER use ALL CAPS or excessive exclamation marks

Generate COMPLETE email drafts — subject, preview, body, CTA.`

const tools = [
  {
    name: 'analyze_retention',
    description: 'Analyze customer retention data to inform email strategy.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const [customers, orders] = await Promise.all([
          shopify.getCustomers({ limit: '200' }),
          shopify.getOrders({ limit: '100', status: 'any' })
        ])

        const now = Date.now()

        // Segment customers
        const segments = {
          newBuyers: [],
          repeatBuyers: [],
          atRisk: [],
          lost: [],
          vip: []
        }

        for (const c of customers) {
          const daysSince = (now - new Date(c.updated_at)) / 86400000
          const spend = parseFloat(c.total_spent || 0)

          if (spend > 200 && c.orders_count > 2) segments.vip.push(c)
          else if (daysSince > 60) segments.lost.push(c)
          else if (daysSince > 30) segments.atRisk.push(c)
          else if (c.orders_count > 1) segments.repeatBuyers.push(c)
          else segments.newBuyers.push(c)
        }

        // Recent unfulfilled (potential frustration)
        const staleOrders = orders.filter(o =>
          (!o.fulfillment_status || o.fulfillment_status === 'unfulfilled') &&
          (now - new Date(o.created_at)) > 48 * 3600000
        )

        // Top products for recommendations
        const productCounts = {}
        for (const o of orders) {
          for (const item of (o.line_items || [])) {
            productCounts[item.title] = (productCounts[item.title] || 0) + item.quantity
          }
        }
        const topProducts = Object.entries(productCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([title, qty]) => ({ title, unitsSold: qty }))

        return {
          totalCustomers: customers.length,
          segments: {
            new: segments.newBuyers.length,
            repeat: segments.repeatBuyers.length,
            atRisk: segments.atRisk.length,
            lost: segments.lost.length,
            vip: segments.vip.length
          },
          staleOrders: staleOrders.length,
          topProducts,
          repeatRate: customers.length > 0
            ? ((segments.repeatBuyers.length + segments.vip.length) / customers.length * 100).toFixed(1) + '%'
            : 'N/A',
          atRiskEmails: segments.atRisk.map(c => c.email).slice(0, 10),
          lostEmails: segments.lost.map(c => c.email).slice(0, 10)
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'draft_email_sequence',
    description: 'Draft a complete email sequence.',
    inputSchema: {
      type: 'object',
      properties: {
        sequenceType: { type: 'string', description: 'post_purchase, abandoned_cart, winback, vip' },
        emails: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timing: { type: 'string', description: 'When to send' },
              subject: { type: 'string' },
              previewText: { type: 'string' },
              body: { type: 'string' },
              cta: { type: 'string', description: 'Call to action button text' },
              ctaUrl: { type: 'string', description: 'Where CTA links to' }
            },
            required: ['timing', 'subject', 'body', 'cta']
          }
        },
        targetSegment: { type: 'string' },
        estimatedReach: { type: 'number' },
        estimatedRevenue: { type: 'string' }
      },
      required: ['sequenceType', 'emails']
    },
    async execute(input) {
      logger.blank()
      logger.bold(`${input.sequenceType.replace(/_/g, ' ').toUpperCase()} Sequence`)
      if (input.targetSegment) logger.kv('Target', input.targetSegment)
      if (input.estimatedReach) logger.kv('Reach', `${input.estimatedReach} customers`)
      if (input.estimatedRevenue) logger.kv('Est. Revenue', input.estimatedRevenue)
      logger.blank()

      for (let i = 0; i < input.emails.length; i++) {
        const e = input.emails[i]
        logger.info(`Email ${i + 1} — ${e.timing}`)
        logger.kv('  Subject', e.subject)
        if (e.previewText) logger.kv('  Preview', e.previewText)
        logger.blank()
        for (const line of e.body.split('\n')) {
          console.log(`    ${line}`)
        }
        logger.blank()
        logger.kv('  CTA', `[${e.cta}]`)
        logger.divider()
      }

      await db.logAction({
        shop: config.getShop(),
        type: 'EMAIL',
        message: `Drafted ${input.sequenceType} sequence: ${input.emails.length} emails`,
        metadata: { type: input.sequenceType, emailCount: input.emails.length, reach: input.estimatedReach }
      })

      return { drafted: true, emails: input.emails.length }
    }
  },
  {
    name: 'present_email_strategy',
    description: 'Present the overall email marketing strategy.',
    inputSchema: {
      type: 'object',
      properties: {
        sequences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              emails: { type: 'number' },
              priority: { type: 'string' },
              expectedImpact: { type: 'string' }
            }
          }
        },
        quickWins: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' }
      },
      required: ['sequences', 'summary']
    },
    async execute(input) {
      logger.header('Email Strategy')

      for (const s of input.sequences) {
        const icon = s.priority === 'HIGH' ? '🔴' : s.priority === 'MEDIUM' ? '🟡' : '🟢'
        logger.info(`${icon} ${s.type} — ${s.emails} emails`)
        if (s.expectedImpact) logger.dim(`   Impact: ${s.expectedImpact}`)
      }

      if (input.quickWins?.length) {
        logger.blank()
        logger.bold('Quick Wins')
        for (const w of input.quickWins) logger.item(w)
      }

      logger.blank()
      logger.info(input.summary)
      return { displayed: true }
    }
  }
]

async function run() {
  logger.header('Email Marketing')
  logger.spin('Analyzing retention data...')

  const result = await runAgent({
    system: SYSTEM,
    task: 'Analyze customer retention and design email marketing sequences. Create specific email drafts for the highest-priority sequences (win-back, post-purchase, abandoned cart). Include subject lines, body copy, and CTAs.',
    tools,
    maxIterations: 12,
    onAction(name) {
      if (name === 'analyze_retention') logger.spin('Analyzing retention...')
      if (name === 'draft_email_sequence') logger.spin('Drafting emails...')
    }
  })

  logger.stopSpin(result.success ? 'Email strategy complete' : 'Email strategy failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
