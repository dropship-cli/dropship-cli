#!/usr/bin/env node
// Dropship CLI — Entry point
// AI-powered autonomous dropshipping operator
import { Command } from 'commander'
import inquirer from 'inquirer'
import logger from '../lib/logger.js'
import config from '../lib/config.js'

// Global error handler — no silent crashes
process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled error: ${err.message || err}`)
  if (process.env.DEBUG) console.error(err)
  process.exit(1)
})
process.on('uncaughtException', (err) => {
  logger.error(`Fatal error: ${err.message}`)
  if (process.env.DEBUG) console.error(err)
  process.exit(1)
})

const program = new Command()

program
  .name('dropship')
  .description('AI-powered autonomous dropshipping operator')
  .version('1.0.0')
  .addHelpText('before', `
  ⚡ DROPSHIP CLI — Claude Code for Dropshipping
  ───────────────────────────────────────────────
  `)
  .addHelpText('after', `
  Getting started:
    $ dropship connect          Connect your Shopify store
    $ dropship status           See your store overview
    $ dropship autopilot        Let AI run everything

  Full docs: https://github.com/phantom-store/dropship-cli
  `)

// ─── connect ────────────────────────────────────────
program
  .command('connect')
  .description('Connect your Shopify store')
  .action(async () => {
    logger.banner()
    logger.header('Connect Shopify Store')

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'shop',
        message: 'Shopify store domain (e.g. mystore.myshopify.com):',
        validate: v => v.includes('.myshopify.com') || 'Must be a .myshopify.com domain'
      },
      {
        type: 'password',
        name: 'accessToken',
        message: 'Admin API access token:',
        validate: v => (v.startsWith('shpat_') && v.length > 10) || 'Token must start with shpat_'
      }
    ])

    config.setShopify(answers)
    logger.spin('Testing connection...')

    const { testConnection } = await import('../lib/shopify.js')
    const result = await testConnection()

    if (result.connected) {
      logger.stopSpin('Connected!')
      logger.success(`Store: ${result.name}`)
      logger.kv('Domain', result.domain)
      logger.kv('Plan', result.plan)
    } else {
      logger.stopSpin('Connection failed', false)
      logger.error(result.error)
    }

    // Check for Anthropic key
    if (!config.getAnthropicKey()) {
      logger.blank()
      const { apiKey } = await inquirer.prompt([{
        type: 'password',
        name: 'apiKey',
        message: 'Anthropic API key (for AI brain):',
        validate: v => (v.startsWith('sk-ant-') && v.length > 20) || 'Key must start with sk-ant-'
      }])
      config.setAnthropicKey(apiKey)
      logger.success('AI brain configured')
    }

    // Check for CJ Dropshipping
    if (!config.getCJApiKey() && !config.getCJEmail()) {
      logger.blank()
      const { connectCJ } = await inquirer.prompt([{
        type: 'confirm',
        name: 'connectCJ',
        message: 'Connect CJ Dropshipping (for real supplier integration)?',
        default: false
      }])

      if (connectCJ) {
        const cjAnswers = await inquirer.prompt([
          {
            type: 'input',
            name: 'email',
            message: 'CJ account email:',
            validate: v => v.includes('@') || 'Must be a valid email'
          },
          {
            type: 'password',
            name: 'password',
            message: 'CJ account password:',
            validate: v => v.length >= 6 || 'Password too short'
          }
        ])
        config.setCJ({ email: cjAnswers.email, password: cjAnswers.password })

        logger.spin('Testing CJ connection...')
        try {
          const cj = await import('../lib/cj.js')
          const result = await cj.testCJConnection()
          if (result.connected) {
            logger.stopSpin('CJ Dropshipping connected!')
          } else {
            logger.stopSpin(`CJ issue: ${result.message}`, false)
          }
        } catch (err) {
          logger.stopSpin(`CJ connection failed: ${err.message}`, false)
        }
      }
    }

    logger.blank()
    logger.success('Ready to go. Run `dropship status` to see your store.')
  })

// ─── status ─────────────────────────────────────────
program
  .command('status')
  .description('Quick business overview')
  .action(async () => {
    logger.banner()
    await ensureConnected()

    const { default: statusSkill } = await import('../skills/analyze.js')
    await statusSkill.quickStatus()
  })

// ─── scout ──────────────────────────────────────────
program
  .command('scout')
  .description('Find trending products to sell')
  .option('-n, --niche <niche>', 'Specific niche to scout')
  .option('-c, --count <num>', 'Number of products to find', '5')
  .action(async (opts) => {
    logger.banner()
    await ensureConnected()

    const { default: scout } = await import('../skills/scout.js')
    await scout.run(opts)
  })

// ─── source ─────────────────────────────────────
program
  .command('source')
  .description('Source a product from CJ and import to Shopify')
  .argument('<query>', 'Product to search for (e.g. "LED desk lamp")')
  .option('--dry-run', 'Preview without creating the product')
  .action(async (query, opts) => {
    logger.banner()
    await ensureConnected()

    const { default: source } = await import('../skills/source.js')
    await source.run({ query, ...opts })
  })

// ─── price ──────────────────────────────────────────
program
  .command('price')
  .description('Optimize all product prices')
  .option('--aggressive', 'Use aggressive pricing strategy')
  .option('--conservative', 'Use conservative pricing strategy')
  .action(async (opts) => {
    logger.banner()
    await ensureConnected()

    const { default: price } = await import('../skills/price.js')
    await price.run(opts)
  })

// ─── fulfill ────────────────────────────────────────
program
  .command('fulfill')
  .description('Process pending orders')
  .option('--dry-run', 'Preview without fulfilling')
  .action(async (opts) => {
    logger.banner()
    await ensureConnected()

    const { default: fulfill } = await import('../skills/fulfill.js')
    await fulfill.run(opts)
  })

// ─── guard ──────────────────────────────────────────
program
  .command('guard')
  .description('Revenue protection scan')
  .action(async () => {
    logger.banner()
    await ensureConnected()

    const { default: guard } = await import('../skills/guard.js')
    await guard.run()
  })

// ─── analyze ────────────────────────────────────────
program
  .command('analyze')
  .description('Business analytics report')
  .option('--period <period>', 'Analysis period (7d, 30d, 90d)', '30d')
  .action(async (opts) => {
    logger.banner()
    await ensureConnected()

    const { default: analyze } = await import('../skills/analyze.js')
    await analyze.run(opts)
  })

// ─── segment ────────────────────────────────────────
program
  .command('segment')
  .description('Customer segmentation')
  .action(async () => {
    logger.banner()
    await ensureConnected()

    const { default: segment } = await import('../skills/segment.js')
    await segment.run()
  })

// ─── growth ─────────────────────────────────────────
program
  .command('growth')
  .description('Ad campaign management')
  .option('--budget <amount>', 'Daily budget cap')
  .action(async (opts) => {
    logger.banner()
    await ensureConnected()

    const { default: growth } = await import('../skills/growth.js')
    await growth.run(opts)
  })

// ─── support ────────────────────────────────────────
program
  .command('support')
  .description('Handle customer tickets')
  .action(async () => {
    logger.banner()
    await ensureConnected()

    const { default: support } = await import('../skills/support.js')
    await support.run()
  })

// ─── audit ──────────────────────────────────────────
program
  .command('audit')
  .description('Full business audit')
  .action(async () => {
    logger.banner()
    await ensureConnected()

    const { default: audit } = await import('../skills/audit.js')
    await audit.run()
  })

// ─── intel ───────────────────────────────────────────
program
  .command('intel')
  .description('Competitive intelligence report')
  .action(async () => {
    logger.banner()
    await ensureConnected()

    const { default: intel } = await import('../skills/intel.js')
    await intel.run()
  })

// ─── supplier ────────────────────────────────────────
program
  .command('supplier')
  .description('Supplier analysis and management')
  .action(async () => {
    logger.banner()
    await ensureConnected()

    const { default: supplier } = await import('../skills/supplier.js')
    await supplier.run()
  })

// ─── forecast ────────────────────────────────────────
program
  .command('forecast')
  .description('Revenue and inventory forecasting')
  .action(async () => {
    logger.banner()
    await ensureConnected()

    const { default: forecast } = await import('../skills/forecast.js')
    await forecast.run()
  })

// ─── profit ──────────────────────────────────────────
program
  .command('profit')
  .description('Real P&L profit analysis')
  .action(async () => {
    logger.banner()
    await ensureConnected()

    const { default: profit } = await import('../skills/profit.js')
    await profit.run()
  })

// ─── email ───────────────────────────────────────────
program
  .command('email')
  .description('Email marketing and retention')
  .action(async () => {
    logger.banner()
    await ensureConnected()

    const { default: email } = await import('../skills/email.js')
    await email.run()
  })

// ─── doctor ──────────────────────────────────────────
program
  .command('doctor')
  .description('System health check and error diagnosis')
  .action(async () => {
    logger.banner()

    const { default: doctor } = await import('../skills/doctor.js')
    await doctor.run()
  })

// ─── autopilot ──────────────────────────────────────
program
  .command('autopilot')
  .description('Run everything autonomously')
  .option('--interval <min>', 'Minutes between cycles', '15')
  .option('--once', 'Run one cycle then exit')
  .action(async (opts) => {
    logger.banner()
    await ensureConnected()

    const { default: autopilot } = await import('../skills/autopilot.js')
    await autopilot.run(opts)
  })

// ─── config ─────────────────────────────────────────
program
  .command('config')
  .description('View/edit configuration')
  .option('--reset', 'Reset all configuration')
  .action(async (opts) => {
    logger.banner()
    logger.header('Configuration')

    if (opts.reset) {
      config.reset()
      logger.success('Configuration reset.')
      return
    }

    const summary = config.summary()
    logger.kv('Shop', summary.shop)
    logger.kv('Shopify', summary.shopifyConnected ? '✓ Connected' : '✗ Not connected')
    logger.kv('Supabase', summary.supabaseConnected ? '✓ Connected' : '✗ Not connected')
    logger.kv('AI Brain', summary.anthropicConnected ? '✓ Connected' : '✗ Not connected')
    logger.kv('CJ Dropship', summary.cjConnected ? '✓ Connected' : '✗ Not connected')

    if (summary.cjConnected) {
      const tokenExpiry = config.getCJTokenExpiry()
      if (tokenExpiry) {
        const hoursLeft = Math.round((new Date(tokenExpiry) - Date.now()) / 3600000)
        logger.kv('  CJ Token', hoursLeft > 0 ? `Valid (${hoursLeft}h remaining)` : 'Expired (will auto-refresh)')
      }
    }
  })

// ─── Helper ─────────────────────────────────────────
async function ensureConnected() {
  if (!config.isConnected()) {
    logger.error('Not connected. Run: dropship connect')
    process.exit(1)
  }
  if (!config.getAnthropicKey()) {
    logger.error('AI not configured. Run: dropship connect')
    process.exit(1)
  }
}

program.parse()
