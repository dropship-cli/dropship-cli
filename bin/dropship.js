#!/usr/bin/env node
// Dropship CLI — Entry point
// AI-powered autonomous dropshipping operator
import { Command } from 'commander'
import inquirer from 'inquirer'
import logger from '../lib/logger.js'
import config from '../lib/config.js'
import { isCommandAllowed, getTier, checkLimit, incrementUsage, PRO_COMMANDS } from '../lib/license.js'

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
// Graceful shutdown
process.on('SIGINT', () => { logger.blank(); logger.dim('Interrupted.'); process.exit(0) })
process.on('SIGTERM', () => { logger.blank(); logger.dim('Terminated.'); process.exit(0) })

const program = new Command()

program
  .name('dropship')
  .description('AI-powered autonomous dropshipping operator')
  .version('1.0.1')
  .addHelpText('before', `
  ⚡ DROPSHIP CLI — Claude Code for Dropshipping
  ───────────────────────────────────────────────
  `)
  .addHelpText('after', `
  Getting started:
    $ dropship connect          Connect your Shopify store
    $ dropship status           See your store overview
    $ dropship autopilot        Let AI run everything

  Full docs: https://github.com/muhamamdaoun75-wq/dropship-cli
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
        validate: v => /^[a-z0-9-]+\.myshopify\.com$/i.test(v.trim()) || 'Must be like yourstore.myshopify.com'
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

// ─── chat ───────────────────────────────────────────
program
  .command('chat')
  .description('Talk to AI about your business (interactive)')
  .action(async () => {
    logger.banner()
    await ensureConnected()
    enforceFreeLimit('chatTurnsPerDay', 'chat turns today')

    const { default: chat } = await import('../skills/chat.js')
    await chat.run()
    incrementUsage('chatTurnsPerDay')
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
    enforceFreeLimit('scoutResults', 'scout searches')

    const { default: scout } = await import('../skills/scout.js')
    await scout.run(opts)
    incrementUsage('scoutResults')
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
    enforceFreeLimit('sourcesPerMonth', 'product sources this month')

    const { default: source } = await import('../skills/source.js')
    await source.run({ query, ...opts })
    if (!opts.dryRun) incrementUsage('sourcesPerMonth')
  })

// ─── price ──────────────────────────────────────────
program
  .command('price')
  .description('Optimize all product prices')
  .option('--aggressive', 'Use aggressive pricing strategy')
  .option('--conservative', 'Use conservative pricing strategy')
  .action(async (opts) => {
    logger.banner()
    requirePro('price')
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
    requirePro('fulfill')
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
    requirePro('guard')
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
    requirePro('analyze')
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
    requirePro('segment')
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
    requirePro('growth')
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
    requirePro('support')
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
    requirePro('audit')
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
    requirePro('intel')
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
    requirePro('supplier')
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
    requirePro('forecast')
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
    requirePro('profit')
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
    requirePro('email')
    await ensureConnected()

    const { default: email } = await import('../skills/email.js')
    await email.run()
  })

// ─── returns ─────────────────────────────────────────
program
  .command('returns')
  .description('Handle returns and refunds')
  .action(async () => {
    logger.banner()
    requirePro('returns')
    await ensureConnected()

    const { default: returns } = await import('../skills/returns.js')
    await returns.run()
  })

// ─── inventory ───────────────────────────────────────
program
  .command('inventory')
  .description('Inventory sync and stockout detection')
  .action(async () => {
    logger.banner()
    requirePro('inventory')
    await ensureConnected()

    const { default: inventory } = await import('../skills/inventory.js')
    await inventory.run()
  })

// ─── copy ────────────────────────────────────────────
program
  .command('copy')
  .description('AI copywriting for product listings')
  .action(async () => {
    logger.banner()
    requirePro('copy')
    await ensureConnected()

    const { default: copy } = await import('../skills/copy.js')
    await copy.run()
  })

// ─── reviews ─────────────────────────────────────────
program
  .command('reviews')
  .description('Review analysis and reputation management')
  .action(async () => {
    logger.banner()
    requirePro('reviews')
    await ensureConnected()

    const { default: reviews } = await import('../skills/reviews.js')
    await reviews.run()
  })

// ─── legal ───────────────────────────────────────────
program
  .command('legal')
  .description('Generate legal pages and compliance check')
  .action(async () => {
    logger.banner()
    await ensureConnected()

    const { default: legal } = await import('../skills/legal.js')
    await legal.run()
  })

// ─── notify ──────────────────────────────────────────
program
  .command('notify')
  .description('Setup Slack/Discord notifications')
  .option('--setup', 'Configure webhook URLs')
  .option('--test', 'Send a test notification')
  .action(async (opts) => {
    logger.banner()

    const { default: notify } = await import('../skills/notify.js')
    await notify.run(opts)
  })

// ─── upsell ──────────────────────────────────────────
program
  .command('upsell')
  .description('Upsell and cross-sell opportunities')
  .action(async () => {
    logger.banner()
    requirePro('upsell')
    await ensureConnected()

    const { default: upsell } = await import('../skills/upsell.js')
    await upsell.run()
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
    requirePro('autopilot')
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

    // License info
    logger.blank()
    const tier = getTier()
    logger.kv('License', tier.tier === 'pro' ? `Pro (${tier.email})` : 'Free')
    if (tier.expiresAt) logger.kv('  Expires', tier.expiresAt.toLocaleDateString())
    if (tier.tier === 'free') {
      logger.dim('  Upgrade: dropship activate DSC-YOUR-KEY')
    }
  })

// ─── activate ─────────────────────────────────────────
program
  .command('activate')
  .description('Activate a Pro license key')
  .argument('[key]', 'License key (DSC-...)')
  .option('--remove', 'Remove current license')
  .option('--status', 'Show license status')
  .action(async (key, opts) => {
    logger.banner()
    logger.header('License')

    if (opts.remove) {
      config.removeLicenseKey()
      logger.success('License removed. You are on the Free tier.')
      return
    }

    if (opts.status || !key) {
      const tier = getTier()
      logger.kv('Tier', tier.tier === 'pro' ? 'Pro' : 'Free')
      if (tier.email) logger.kv('Email', tier.email)
      if (tier.expiresAt) logger.kv('Expires', tier.expiresAt.toLocaleDateString())
      if (tier.reason) logger.kv('Note', tier.reason)

      if (tier.tier === 'free') {
        logger.blank()
        logger.info('Free tier limits:')
        logger.dim('  3 product sources/month')
        logger.dim('  5 scout results')
        logger.dim('  10 fulfillments/month')
        logger.dim('  No autopilot')
        logger.blank()
        logger.info('Upgrade: dropship activate DSC-YOUR-KEY')
      }
      return
    }

    // Activate key
    const { validateKey } = await import('../lib/license.js')
    const result = validateKey(key)

    if (result.valid) {
      config.setLicenseKey(key)
      logger.success(`Pro license activated!`)
      logger.kv('Email', result.email)
      logger.kv('Expires', result.expiresAt.toLocaleDateString())
    } else {
      logger.error(`Invalid key: ${result.reason}`)
    }
  })

// ─── Helpers ─────────────────────────────────────────
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

function requirePro(command) {
  if (!isCommandAllowed(command)) {
    const tier = getTier()
    logger.error(`"${command}" requires Pro. You're on the ${tier.name} tier.`)
    logger.blank()
    logger.info('Upgrade: dropship activate DSC-YOUR-KEY')
    logger.dim('Get a key at https://dropship-cli.dev/pro')
    process.exit(1)
  }
}

function enforceFreeLimit(limitType, label) {
  const result = checkLimit(limitType)
  if (!result.allowed) {
    logger.error(`Free tier limit reached: ${label}`)
    if (result.limit) logger.dim(`  Used ${result.used}/${result.limit}`)
    logger.blank()
    logger.info('Upgrade to Pro for unlimited usage: dropship activate DSC-YOUR-KEY')
    process.exit(1)
  }
}

program.parse()
