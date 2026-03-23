// Doctor Skill — System health and error diagnosis agent
// AI agent that checks configuration, connections, and diagnoses problems
import { runAgent } from '../lib/ai.js'
import config from '../lib/config.js'
import logger from '../lib/logger.js'
import * as shopify from '../lib/shopify.js'
import * as db from '../lib/db.js'

const SYSTEM = `You are the Doctor Agent — a system diagnostician.

Your job: Check EVERYTHING in this system and report what's healthy and what's broken.

## Diagnostic Checklist
1. **Configuration** — Are all required keys and credentials set?
2. **Shopify Connection** — Can we reach the store? Is the token valid?
3. **Database Connection** — Is Supabase reachable? Can we read/write?
4. **AI Brain** — Is the Anthropic API key set? (Don't test it — you ARE the test)
5. **Store Health** — Does the store have products? Orders? Customers?
6. **Data Integrity** — Any orphaned data, missing fields, corrupted records?
7. **Performance** — How fast are API responses?

## Severity Levels
- PASS — Everything works as expected
- WARN — Works but could be better
- FAIL — Broken. Needs fixing.
- SKIP — Cannot test (missing credentials, etc.)

## Rules
- Test connections BEFORE analyzing data
- If a connection fails, skip all dependent checks (don't cascade errors)
- Measure response times — flag anything over 5 seconds
- Be specific about fixes: "Set ANTHROPIC_API_KEY in .env" not "fix config"
- Present a clean health report at the end

Think like a sysadmin. Paranoid, thorough, concise.`

const tools = [
  {
    name: 'check_config',
    description: 'Verify all configuration and credentials.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      const checks = []

      // Shopify
      const shop = config.getShop()
      const token = config.getShopifyToken()
      checks.push({
        name: 'Shopify Shop',
        status: shop ? 'PASS' : 'FAIL',
        value: shop || '(not set)',
        fix: !shop ? 'Run: dropship connect' : null
      })
      checks.push({
        name: 'Shopify Token',
        status: token ? 'PASS' : 'FAIL',
        value: token ? `${token.substring(0, 10)}...` : '(not set)',
        fix: !token ? 'Run: dropship connect' : null
      })

      // Anthropic
      const aiKey = config.getAnthropicKey()
      checks.push({
        name: 'Anthropic API Key',
        status: aiKey ? 'PASS' : 'FAIL',
        value: aiKey ? `${aiKey.substring(0, 12)}...` : '(not set)',
        fix: !aiKey ? 'Set ANTHROPIC_API_KEY in .env or run: dropship connect' : null
      })

      // Supabase
      const sbUrl = config.getSupabaseUrl()
      const sbKey = config.getSupabaseKey()
      checks.push({
        name: 'Supabase URL',
        status: sbUrl ? 'PASS' : 'WARN',
        value: sbUrl ? sbUrl.substring(0, 30) + '...' : '(not set — running in local mode)',
        fix: !sbUrl ? 'Set SUPABASE_URL in .env for persistence (optional)' : null
      })
      checks.push({
        name: 'Supabase Key',
        status: sbKey ? 'PASS' : 'WARN',
        value: sbKey ? `${sbKey.substring(0, 10)}...` : '(not set)',
        fix: !sbKey ? 'Set SUPABASE_SERVICE_KEY in .env (optional)' : null
      })

      // CJ
      const cjKey = config.getCJApiKey()
      checks.push({
        name: 'CJ API Key',
        status: cjKey ? 'PASS' : 'WARN',
        value: cjKey ? 'Set' : '(not set — supplier features limited)',
        fix: !cjKey ? 'Set CJ_API_KEY in .env for supplier integration' : null
      })

      const passCount = checks.filter(c => c.status === 'PASS').length
      const failCount = checks.filter(c => c.status === 'FAIL').length

      return {
        checks,
        summary: {
          total: checks.length,
          pass: passCount,
          warn: checks.filter(c => c.status === 'WARN').length,
          fail: failCount
        },
        canOperate: !!(shop && token && aiKey)
      }
    }
  },
  {
    name: 'check_shopify_connection',
    description: 'Test the Shopify API connection and measure response time.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      if (!config.isConnected()) {
        return { status: 'SKIP', reason: 'Shopify not configured' }
      }

      try {
        const start = Date.now()
        const shopInfo = await shopify.getShopInfo()
        const latency = Date.now() - start

        return {
          status: latency > 5000 ? 'WARN' : 'PASS',
          connected: true,
          latencyMs: latency,
          shop: {
            name: shopInfo.name,
            domain: shopInfo.domain,
            plan: shopInfo.plan_display_name,
            currency: shopInfo.currency,
            timezone: shopInfo.timezone
          },
          warning: latency > 5000 ? `Slow response: ${latency}ms (>5s)` : null
        }
      } catch (err) {
        return {
          status: 'FAIL',
          connected: false,
          error: err.message,
          fix: err.message.includes('401') ? 'Access token is invalid — run: dropship connect'
            : err.message.includes('404') ? 'Shop domain not found — check your .myshopify.com domain'
            : `Shopify API error: ${err.message}`
        }
      }
    }
  },
  {
    name: 'check_database',
    description: 'Test Supabase connection and data integrity.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      if (!db.isAvailable()) {
        return { status: 'SKIP', reason: 'Supabase not configured (running in local mode)' }
      }

      const client = db.getClient()
      const checks = []

      try {
        // Test read
        const start = Date.now()
        const { data, error } = await client.from('agent_runs')
          .select('id')
          .limit(1)
        const latency = Date.now() - start

        checks.push({
          name: 'Read access',
          status: error ? 'FAIL' : 'PASS',
          latencyMs: latency,
          error: error?.message
        })

        // Test write
        const writeStart = Date.now()
        const { error: writeErr } = await client.from('agent_logs').insert({
          shop: config.getShop() || 'doctor-test',
          type: 'DOCTOR_CHECK',
          message: 'Health check write test',
          created_at: new Date().toISOString()
        })
        const writeLatency = Date.now() - writeStart

        checks.push({
          name: 'Write access',
          status: writeErr ? 'FAIL' : 'PASS',
          latencyMs: writeLatency,
          error: writeErr?.message
        })

        // Check recent error count
        const { data: errors } = await client.from('errors')
          .select('id', { count: 'exact', head: true })
          .eq('shop', config.getShop() || '')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

        checks.push({
          name: 'Errors (24h)',
          status: (errors?.length || 0) > 10 ? 'WARN' : 'PASS',
          count: errors?.length || 0
        })

      } catch (err) {
        checks.push({
          name: 'Connection',
          status: 'FAIL',
          error: err.message
        })
      }

      return { checks, status: checks.every(c => c.status === 'PASS') ? 'PASS' : checks.some(c => c.status === 'FAIL') ? 'FAIL' : 'WARN' }
    }
  },
  {
    name: 'check_store_health',
    description: 'Verify the store has products, orders, and is operational.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      if (!config.isConnected()) {
        return { status: 'SKIP', reason: 'Shopify not configured' }
      }

      try {
        const [productCount, orders] = await Promise.all([
          shopify.countProducts(),
          shopify.getOrders({ limit: '10', status: 'any' })
        ])

        const pending = orders.filter(o => !o.fulfillment_status || o.fulfillment_status === 'unfulfilled')
        const stale = pending.filter(o => (Date.now() - new Date(o.created_at)) > 48 * 3600000)

        const checks = []

        checks.push({
          name: 'Products',
          status: productCount > 0 ? 'PASS' : 'WARN',
          value: productCount,
          warning: productCount === 0 ? 'No products — run: dropship scout' : null
        })

        checks.push({
          name: 'Recent Orders',
          status: 'PASS',
          value: orders.length
        })

        checks.push({
          name: 'Pending Fulfillment',
          status: pending.length > 10 ? 'WARN' : 'PASS',
          value: pending.length,
          warning: pending.length > 10 ? `${pending.length} pending — run: dropship fulfill` : null
        })

        checks.push({
          name: 'Stale Orders (>48h)',
          status: stale.length > 0 ? 'FAIL' : 'PASS',
          value: stale.length,
          fix: stale.length > 0 ? `${stale.length} stale orders — immediate attention needed` : null
        })

        return { checks, status: checks.every(c => c.status === 'PASS') ? 'PASS' : checks.some(c => c.status === 'FAIL') ? 'FAIL' : 'WARN' }
      } catch (err) {
        return { status: 'FAIL', error: err.message }
      }
    }
  },
  {
    name: 'present_health_report',
    description: 'Present the complete system health report.',
    inputSchema: {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              status: { type: 'string', enum: ['PASS', 'WARN', 'FAIL', 'SKIP'] },
              checks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    status: { type: 'string' },
                    detail: { type: 'string' },
                    fix: { type: 'string' }
                  }
                }
              }
            },
            required: ['name', 'status']
          }
        },
        overallStatus: { type: 'string', enum: ['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'CRITICAL'] },
        fixes: { type: 'array', items: { type: 'string' }, description: 'Ordered list of fixes needed' },
        summary: { type: 'string' }
      },
      required: ['sections', 'overallStatus', 'summary']
    },
    async execute(input) {
      logger.header('System Health Report')

      const statusIcon = { HEALTHY: '🟢', DEGRADED: '🟡', UNHEALTHY: '🟠', CRITICAL: '🔴' }
      const checkIcon = { PASS: '✓', WARN: '⚠', FAIL: '✗', SKIP: '○' }

      logger.bold(`Status: ${statusIcon[input.overallStatus] || ''} ${input.overallStatus}`)
      logger.blank()

      for (const section of input.sections) {
        const icon = checkIcon[section.status] || '?'
        logger.bold(`${icon} ${section.name} — ${section.status}`)

        if (section.checks) {
          for (const check of section.checks) {
            const ci = checkIcon[check.status] || '?'
            const color = check.status === 'PASS' ? 'success' : check.status === 'FAIL' ? 'error' : 'warn'
            logger[color](`  ${ci} ${check.name}${check.detail ? ': ' + check.detail : ''}`)
            if (check.fix) logger.dim(`    → ${check.fix}`)
          }
        }
        logger.blank()
      }

      if (input.fixes?.length) {
        logger.bold('Action Items')
        input.fixes.forEach((f, i) => logger.info(`${i + 1}. ${f}`))
        logger.blank()
      }

      logger.divider()
      logger.info(input.summary)

      await db.logAction({
        shop: config.getShop(),
        type: 'DOCTOR',
        message: `Health check: ${input.overallStatus}`,
        metadata: { status: input.overallStatus, sections: input.sections.length }
      })

      return { displayed: true, status: input.overallStatus }
    }
  }
]

async function run() {
  logger.header('System Doctor')
  logger.spin('Running diagnostics...')

  const result = await runAgent({
    system: SYSTEM,
    task: 'Run a complete system health check. Check configuration, Shopify connection, database, and store health. Present a clear health report with pass/fail for each area and specific fixes for anything broken.',
    tools,
    maxIterations: 10,
    onAction(name) {
      if (name === 'check_config') logger.spin('Checking configuration...')
      if (name === 'check_shopify_connection') logger.spin('Testing Shopify connection...')
      if (name === 'check_database') logger.spin('Testing database...')
      if (name === 'check_store_health') logger.spin('Checking store health...')
    }
  })

  logger.stopSpin(result.success ? 'Diagnostics complete' : 'Diagnostics failed', result.success)
  if (!result.success) {
    logger.error(result.result)
  }

  logger.blank()
  logger.dim(`Completed in ${(result.duration / 1000).toFixed(1)}s (${result.iterations} iterations)`)
}

export default { run }
