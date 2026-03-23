// Autopilot Skill — Run everything autonomously
// AI meta-agent that decides what to run and when, orchestrating all other skills
import { runAgent, ask } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Autopilot Controller — the master orchestrator.

Your job: Run an entire dropshipping business cycle autonomously. You decide what needs attention, in what order, and execute it.

## Cycle Structure
Every cycle, evaluate and run (in priority order):

### Tier 1 — CRITICAL (every cycle)
1. **GUARD** — Always run first. Check for threats.
2. **FULFILL** — Process any pending orders.
3. **SUPPORT** — Handle customer issues.

### Tier 2 — DAILY (run once per day)
4. **SCOUT** — Find new products.
5. **PROFIT** — Real P&L check.
6. **FORECAST** — Revenue/inventory predictions.
7. **SUPPLIER** — Vendor health check.

### Tier 3 — OPTIMIZATION (run twice daily)
8. **PRICE** — Optimize prices.
9. **GROWTH** — Ad campaign review.
10. **ANALYZE** — Analytics report.

### Tier 4 — STRATEGIC (run weekly or on-demand)
11. **AUDIT** — Full business audit.
12. **INTEL** — Competitive intelligence.
13. **SEGMENT** — Customer segmentation.
14. **EMAIL** — Email sequence planning.

## Decision Rules
- If guard finds CRITICAL threats → handle them before anything else
- If 5+ pending orders → run fulfill immediately
- If revenue dropped > 20% → run profit + analyze + guard
- Skip scout if already ran in last 12 hours
- Skip price if already ran in last 6 hours
- Skip profit/forecast if already ran in last 24 hours
- Run audit/intel/segment max once per week
- Always end with a status summary
- Max 5 skills per cycle to avoid timeouts

## Cycle Report
After each cycle, report:
- What ran and why
- Key findings
- Actions taken
- Next recommended actions`

const tools = [
  {
    name: 'check_business_state',
    description: 'Get current business state to decide what to run.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        const [shopInfo, orders, products] = await Promise.all([
          shopify.getShopInfo(),
          shopify.getOrders({ limit: '30', status: 'any' }),
          shopify.countProducts()
        ])

        const pendingOrders = orders.filter(o =>
          !o.fulfillment_status || o.fulfillment_status === 'unfulfilled'
        )
        const recentRevenue = orders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0)

        // Get last run times from DB
        const lastRuns = {}
        if (db.isAvailable()) {
          const runs = await db.getRuns({ shop: config.getShop(), limit: 20 })
          for (const run of runs) {
            const skill = run.agent_name
            if (!lastRuns[skill]) lastRuns[skill] = run.created_at
          }
        }

        return {
          shop: shopInfo.name,
          products,
          totalOrders: orders.length,
          pendingOrders: pendingOrders.length,
          recentRevenue: recentRevenue.toFixed(2),
          lastRuns,
          currentTime: new Date().toISOString()
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },
  {
    name: 'run_skill',
    description: 'Execute a specific skill.',
    inputSchema: {
      type: 'object',
      properties: {
        skill: { type: 'string', enum: ['guard', 'fulfill', 'scout', 'price', 'analyze', 'segment', 'growth', 'support', 'audit', 'intel', 'supplier', 'forecast', 'profit', 'email'] },
        reason: { type: 'string', description: 'Why this skill is being run' }
      },
      required: ['skill', 'reason']
    },
    async execute(input) {
      logger.blank()
      logger.agent('AUTOPILOT', `Running ${input.skill}: ${input.reason}`)

      try {
        const mod = await import(`./${input.skill}.js`)
        const skill = mod.default

        const startTime = Date.now()
        await skill.run({})
        const duration = Date.now() - startTime

        // Log the run
        await db.logRun({
          agent: `autopilot-${input.skill}`,
          shop: config.getShop(),
          success: true,
          duration,
          result: input.reason
        })

        return { ran: true, skill: input.skill, duration }
      } catch (err) {
        logger.error(`${input.skill} failed: ${err.message}`)

        await db.logError({
          shop: config.getShop(),
          context: `autopilot-${input.skill}`,
          message: err.message,
          stack: err.stack
        })

        return { ran: false, skill: input.skill, error: err.message }
      }
    }
  },
  {
    name: 'present_cycle_report',
    description: 'Present the autopilot cycle summary.',
    inputSchema: {
      type: 'object',
      properties: {
        skillsRun: { type: 'array', items: { type: 'string' } },
        skillsSkipped: { type: 'array', items: { type: 'string' } },
        keyFindings: { type: 'array', items: { type: 'string' } },
        actionsTaken: { type: 'array', items: { type: 'string' } },
        nextRecommendations: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' }
      },
      required: ['skillsRun', 'summary']
    },
    async execute(input) {
      logger.header('Autopilot Cycle Complete')

      logger.bold('Skills Run')
      for (const s of input.skillsRun) logger.success(s)

      if (input.skillsSkipped?.length) {
        logger.blank()
        logger.bold('Skipped')
        for (const s of input.skillsSkipped) logger.dim(s)
      }

      if (input.keyFindings?.length) {
        logger.blank()
        logger.bold('Key Findings')
        for (const f of input.keyFindings) logger.item(f)
      }

      if (input.actionsTaken?.length) {
        logger.blank()
        logger.bold('Actions Taken')
        for (const a of input.actionsTaken) logger.item(a)
      }

      if (input.nextRecommendations?.length) {
        logger.blank()
        logger.bold('Next Cycle')
        for (const r of input.nextRecommendations) logger.item(r)
      }

      logger.blank()
      logger.info(input.summary)
      return { displayed: true }
    }
  }
]

async function run(opts = {}) {
  logger.header('Autopilot Mode')
  const intervalMin = parseInt(opts.interval) || 15
  const runOnce = opts.once

  if (!runOnce) {
    logger.info(`Running every ${intervalMin} minutes. Ctrl+C to stop.`)
    logger.blank()
  }

  async function executeCycle() {
    const cycleStart = Date.now()
    logger.spin('Starting autopilot cycle...')

    const result = await runAgent({
      system: SYSTEM,
      task: 'Run an autonomous business cycle. Check business state, decide which skills to run, execute them in priority order, and present a cycle report.',
      tools,
      maxIterations: 20,
      onAction(name, input) {
        if (name === 'check_business_state') logger.spin('Evaluating business state...')
        if (name === 'run_skill') logger.spin(`Running ${input.skill}...`)
      }
    })

    if (!result.success) {
      logger.stopSpin('Cycle failed', false)
      logger.error(result.result)
    }

    const cycleDuration = Date.now() - cycleStart
    logger.blank()
    logger.dim(`Cycle completed in ${(cycleDuration / 1000).toFixed(1)}s`)

    await db.logRun({
      agent: 'autopilot',
      shop: config.getShop(),
      success: result.success,
      duration: cycleDuration,
      result: `Autopilot cycle: ${result.iterations} iterations`
    })
  }

  // Run first cycle
  await executeCycle()

  if (runOnce) return

  // Continuous mode
  logger.blank()
  logger.info(`Next cycle in ${intervalMin} minutes...`)

  const interval = setInterval(async () => {
    try {
      logger.blank()
      logger.divider()
      await executeCycle()
      logger.blank()
      logger.info(`Next cycle in ${intervalMin} minutes...`)
    } catch (err) {
      logger.error(`Cycle crashed: ${err.message}`)
      logger.dim('Autopilot will retry next cycle.')
    }
  }, intervalMin * 60 * 1000)

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(interval)
    logger.blank()
    logger.info('Autopilot stopped.')
    process.exit(0)
  })
}

export default { run }
