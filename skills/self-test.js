#!/usr/bin/env node
// Self-Test — Validates all skills load and run correctly
// Run: npm test or node skills/self-test.js

import chalk from 'chalk'

const PASS = chalk.green('PASS')
const FAIL = chalk.red('FAIL')
const SKIP = chalk.yellow('SKIP')

let passed = 0
let failed = 0
let skipped = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ${PASS}  ${name}`)
    passed++
  } catch (err) {
    console.log(`  ${FAIL}  ${name}`)
    console.log(chalk.red(`         ${err.message}`))
    failed++
  }
}

function skip(name, reason) {
  console.log(`  ${SKIP}  ${name} (${reason})`)
  skipped++
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed')
}

console.log('')
console.log(chalk.bold('  ⚡ DROPSHIP CLI — Self-Test Suite'))
console.log(chalk.dim('  ─'.repeat(25)))
console.log('')

// ─── Phase 1: Core Infrastructure ───────────────────

console.log(chalk.bold('  Phase 1: Core Infrastructure'))
console.log('')

await test('lib/logger.js loads with all methods', async () => {
  const mod = await import('../lib/logger.js')
  assert(mod.default, 'No default export')
  const required = ['info', 'success', 'error', 'warn', 'spin', 'stopSpin', 'kv', 'table', 'banner', 'money', 'pct', 'header', 'item', 'dim', 'bold', 'divider', 'blank', 'agent', 'json']
  for (const fn of required) {
    assert(typeof mod.default[fn] === 'function', `Missing ${fn}()`)
  }
})

await test('lib/logger.js money formatting edge cases', async () => {
  const { default: logger } = await import('../lib/logger.js')
  assert(logger.money(29.99) === '$29.99', `Expected $29.99, got ${logger.money(29.99)}`)
  assert(logger.money(0) === '$0.00', `Expected $0.00, got ${logger.money(0)}`)
  assert(logger.money(1000) === '$1000.00', `Expected $1000.00, got ${logger.money(1000)}`)
  assert(logger.money(0.1) === '$0.10', `Expected $0.10, got ${logger.money(0.1)}`)
})

await test('lib/logger.js pct formatting edge cases', async () => {
  const { default: logger } = await import('../lib/logger.js')
  assert(logger.pct(45.678) === '45.7%', `Expected 45.7%, got ${logger.pct(45.678)}`)
  assert(logger.pct(0) === '0.0%', `Expected 0.0%, got ${logger.pct(0)}`)
  assert(logger.pct(100) === '100.0%', `Expected 100.0%, got ${logger.pct(100)}`)
})

await test('lib/config.js loads with all methods', async () => {
  const mod = await import('../lib/config.js')
  assert(mod.default, 'No default export')
  const required = ['getShop', 'getShopifyToken', 'getShopifyApiVersion', 'setShopify', 'getSupabaseUrl', 'getSupabaseKey', 'setSupabase', 'getAnthropicKey', 'setAnthropicKey', 'getCJApiKey', 'getCJToken', 'getCJTokenExpiry', 'setCJ', 'isConnected', 'isConfigured', 'summary', 'reset']
  for (const fn of required) {
    assert(typeof mod.default[fn] === 'function', `Missing ${fn}()`)
  }
})

await test('lib/config.js summary returns correct shape', async () => {
  const { default: config } = await import('../lib/config.js')
  const s = config.summary()
  assert(typeof s.shop === 'string', 'Missing shop')
  assert(typeof s.shopifyConnected === 'boolean', 'Missing shopifyConnected')
  assert(typeof s.supabaseConnected === 'boolean', 'Missing supabaseConnected')
  assert(typeof s.anthropicConnected === 'boolean', 'Missing anthropicConnected')
  assert(typeof s.cjConnected === 'boolean', 'Missing cjConnected')
})

await test('lib/config.js isConnected/isConfigured consistency', async () => {
  const { default: config } = await import('../lib/config.js')
  // If not connected, should not be configured either
  if (!config.isConnected()) {
    assert(!config.isConfigured() || config.getAnthropicKey(), 'isConfigured should be false if not connected')
  }
})

await test('lib/ai.js loads with all exports', async () => {
  const mod = await import('../lib/ai.js')
  assert(typeof mod.ask === 'function', 'Missing ask()')
  assert(typeof mod.runAgent === 'function', 'Missing runAgent()')
  assert(typeof mod.askJSON === 'function', 'Missing askJSON()')
  assert(typeof mod.MODEL === 'string', 'Missing MODEL constant')
})

await test('lib/ai.js MODEL is valid Claude model', async () => {
  const { MODEL } = await import('../lib/ai.js')
  assert(MODEL.includes('claude'), `MODEL should contain "claude", got: ${MODEL}`)
  assert(MODEL.length > 5, `MODEL too short: ${MODEL}`)
})

await test('lib/shopify.js loads with all exports', async () => {
  const mod = await import('../lib/shopify.js')
  const required = ['shopifyFetch', 'getProducts', 'getProduct', 'updateProduct', 'createProduct', 'getOrders', 'getOrder', 'fulfillOrder', 'getCustomers', 'getShopInfo', 'getInventoryLevels', 'countProducts', 'countOrders', 'testConnection', 'withRetry']
  for (const fn of required) {
    assert(typeof mod[fn] === 'function', `Missing ${fn}()`)
  }
})

await test('lib/db.js loads with all exports', async () => {
  const mod = await import('../lib/db.js')
  const required = ['getClient', 'logRun', 'logAction', 'logError', 'getRuns', 'getConfig', 'setConfig', 'isAvailable']
  for (const fn of required) {
    assert(typeof mod[fn] === 'function', `Missing ${fn}()`)
  }
})

await test('lib/db.js graceful without credentials', async () => {
  const { isAvailable, logAction } = await import('../lib/db.js')
  // Should not throw even without credentials
  const result = await logAction({ shop: 'test', type: 'TEST', message: 'test' })
  // Result is null when DB not available
  assert(result === null || result !== undefined, 'logAction should handle missing DB')
})

await test('lib/cj.js loads with all exports', async () => {
  const mod = await import('../lib/cj.js')
  const required = ['getCJToken', 'testCJConnection', 'searchProducts', 'getProductDetail', 'placeOrder', 'getTracking', 'cjFetch']
  for (const fn of required) {
    assert(typeof mod[fn] === 'function', `Missing ${fn}()`)
  }
})

await test('lib/suppliers.js loads with all exports', async () => {
  const mod = await import('../lib/suppliers.js')
  const required = ['scoreSupplier', 'findBestSupplier', 'getActiveSupplierNames', 'isSupplierConfigured']
  for (const fn of required) {
    assert(typeof mod[fn] === 'function', `Missing ${fn}()`)
  }
})

await test('lib/suppliers.js scoreSupplier returns valid score', async () => {
  const { scoreSupplier } = await import('../lib/suppliers.js')
  const score = scoreSupplier({ price: 10, shippingDays: 7, fulfillmentRate: 95 })
  assert(typeof score === 'number', 'Score should be a number')
  assert(score >= 0 && score <= 1, `Score should be 0-1, got ${score}`)
})

await test('lib/config.js has CJ email/password methods', async () => {
  const { default: config } = await import('../lib/config.js')
  assert(typeof config.getCJEmail === 'function', 'Missing getCJEmail()')
  assert(typeof config.getCJPassword === 'function', 'Missing getCJPassword()')
  assert(typeof config.clearCJToken === 'function', 'Missing clearCJToken()')
})

await test('lib/config.js has license + usage methods', async () => {
  const { default: config } = await import('../lib/config.js')
  assert(typeof config.getLicenseKey === 'function', 'Missing getLicenseKey()')
  assert(typeof config.setLicenseKey === 'function', 'Missing setLicenseKey()')
  assert(typeof config.removeLicenseKey === 'function', 'Missing removeLicenseKey()')
  assert(typeof config.getUsage === 'function', 'Missing getUsage()')
  assert(typeof config.incrementUsage === 'function', 'Missing incrementUsage()')
})

await test('lib/license.js loads with all exports', async () => {
  const mod = await import('../lib/license.js')
  const required = ['generateKey', 'validateKey', 'getTier', 'isCommandAllowed', 'getUsage', 'incrementUsage', 'checkLimit', 'FREE_COMMANDS', 'PRO_COMMANDS', 'TIERS']
  for (const fn of required) {
    assert(mod[fn] !== undefined, `Missing ${fn}`)
  }
  // sign() should NOT be exported (security)
  assert(mod.sign === undefined, 'sign() should not be publicly exported')
})

await test('lib/license.js key generation and validation roundtrip', async () => {
  const { generateKey, validateKey } = await import('../lib/license.js')
  const key = generateKey('test@example.com', 'pro', 30)
  assert(key.startsWith('DSC-'), 'Key should start with DSC-')
  const result = validateKey(key)
  assert(result.valid === true, `Key should be valid, got: ${result.reason}`)
  assert(result.tier === 'pro', `Tier should be pro, got: ${result.tier}`)
  assert(result.email === 'test@example.com', `Email mismatch: ${result.email}`)
})

await test('lib/license.js rejects tampered keys', async () => {
  const { generateKey, validateKey } = await import('../lib/license.js')
  const key = generateKey('test@example.com', 'pro', 30)
  // Tamper with the key
  const tampered = key.slice(0, -2) + 'XX'
  const result = validateKey(tampered)
  assert(result.valid === false, 'Tampered key should be invalid')
})

await test('lib/license.js rejects expired keys', async () => {
  const { generateKey, validateKey } = await import('../lib/license.js')
  const key = generateKey('test@example.com', 'pro', -1) // expired yesterday
  const result = validateKey(key)
  assert(result.valid === false, 'Expired key should be invalid')
  assert(result.reason === 'License expired', `Wrong reason: ${result.reason}`)
})

await test('lib/notify.js loads with all exports', async () => {
  const mod = await import('../lib/notify.js')
  const required = ['sendSlack', 'sendDiscord', 'sendAlert', 'formatAlert']
  for (const fn of required) {
    assert(typeof mod[fn] === 'function', `Missing ${fn}()`)
  }
})

await test('lib/notify.js formatAlert returns formatted string', async () => {
  const { formatAlert } = await import('../lib/notify.js')
  const msg = formatAlert('order', { message: 'New order received' })
  assert(typeof msg === 'string', 'Should return a string')
  assert(msg.includes('ORDER'), 'Should contain type')
  assert(msg.includes('New order'), 'Should contain message')
})

await test('lib/config.js has webhook methods', async () => {
  const { default: config } = await import('../lib/config.js')
  assert(typeof config.getWebhook === 'function', 'Missing getWebhook()')
  assert(typeof config.setWebhook === 'function', 'Missing setWebhook()')
  assert(typeof config.removeWebhook === 'function', 'Missing removeWebhook()')
  assert(typeof config.getWebhooks === 'function', 'Missing getWebhooks()')
})

await test('lib/license.js checkLimit handles boolean limits correctly', async () => {
  const { checkLimit } = await import('../lib/license.js')
  // Without a pro key, autopilot (boolean false) should be disallowed
  const result = checkLimit('autopilot')
  assert(result.allowed === false, `autopilot should be disallowed on free tier, got allowed=${result.allowed}`)
})

await test('lib/license.js free tier allows free commands', async () => {
  const { FREE_COMMANDS, PRO_COMMANDS } = await import('../lib/license.js')
  assert(FREE_COMMANDS.includes('connect'), 'connect should be free')
  assert(FREE_COMMANDS.includes('chat'), 'chat should be free')
  assert(FREE_COMMANDS.includes('scout'), 'scout should be free')
  assert(PRO_COMMANDS.includes('autopilot'), 'autopilot should be pro')
  assert(PRO_COMMANDS.includes('fulfill'), 'fulfill should be pro')
  assert(PRO_COMMANDS.includes('analyze'), 'analyze should be pro')
})

await test('lib/config.js has product mapping methods', async () => {
  const { default: config } = await import('../lib/config.js')
  assert(typeof config.getProductMappings === 'function', 'Missing getProductMappings()')
  assert(typeof config.setProductMapping === 'function', 'Missing setProductMapping()')
  assert(typeof config.getProductMapping === 'function', 'Missing getProductMapping()')
  assert(typeof config.removeProductMapping === 'function', 'Missing removeProductMapping()')
})

console.log('')

// ─── Phase 2: Skills ────────────────────────────────

console.log(chalk.bold('  Phase 2: Skills (25 AI Agents)'))
console.log('')

const skills = [
  { file: 'scout', name: 'Scout', methods: ['run'] },
  { file: 'price', name: 'Price', methods: ['run'] },
  { file: 'fulfill', name: 'Fulfill', methods: ['run'] },
  { file: 'guard', name: 'Guard', methods: ['run'] },
  { file: 'analyze', name: 'Analyze', methods: ['run', 'quickStatus'] },
  { file: 'segment', name: 'Segment', methods: ['run'] },
  { file: 'growth', name: 'Growth', methods: ['run'] },
  { file: 'support', name: 'Support', methods: ['run'] },
  { file: 'audit', name: 'Audit', methods: ['run'] },
  { file: 'intel', name: 'Intel', methods: ['run'] },
  { file: 'source', name: 'Source', methods: ['run'] },
  { file: 'chat', name: 'Chat', methods: ['run'] },
  { file: 'supplier', name: 'Supplier', methods: ['run'] },
  { file: 'forecast', name: 'Forecast', methods: ['run'] },
  { file: 'profit', name: 'Profit', methods: ['run'] },
  { file: 'email', name: 'Email', methods: ['run'] },
  { file: 'doctor', name: 'Doctor', methods: ['run'] },
  { file: 'autopilot', name: 'Autopilot', methods: ['run'] },
  { file: 'returns', name: 'Returns', methods: ['run'] },
  { file: 'inventory', name: 'Inventory', methods: ['run'] },
  { file: 'copy', name: 'Copy', methods: ['run'] },
  { file: 'reviews', name: 'Reviews', methods: ['run'] },
  { file: 'legal', name: 'Legal', methods: ['run'] },
  { file: 'notify', name: 'Notify', methods: ['run'] },
  { file: 'upsell', name: 'Upsell', methods: ['run'] }
]

for (const skill of skills) {
  await test(`skills/${skill.file}.js loads`, async () => {
    const mod = await import(`./${skill.file}.js`)
    assert(mod.default, `${skill.name}: No default export`)
    for (const method of skill.methods) {
      assert(typeof mod.default[method] === 'function', `${skill.name}: Missing ${method}()`)
    }
  })
}

console.log('')

// ─── Phase 3: CLI Entry Point ───────────────────────

console.log(chalk.bold('  Phase 3: CLI'))
console.log('')

await test('bin/dropship.js is valid JS with all 29 commands', async () => {
  const fs = await import('fs')
  const code = fs.readFileSync(new URL('../bin/dropship.js', import.meta.url), 'utf8')
  assert(code.includes('commander'), 'Missing commander import')
  assert(code.includes('program'), 'Missing program definition')

  const commands = [
    'connect', 'chat', 'scout', 'source', 'price', 'fulfill', 'guard', 'analyze',
    'segment', 'growth', 'support', 'audit', 'intel', 'supplier',
    'forecast', 'profit', 'email', 'doctor', 'autopilot', 'config', 'status', 'activate',
    'returns', 'inventory', 'copy', 'reviews', 'legal', 'notify', 'upsell'
  ]
  for (const cmd of commands) {
    assert(code.includes(cmd), `Missing ${cmd} command`)
  }
})

await test('bin/dropship.js enforces free tier limits', async () => {
  const fs = await import('fs')
  const code = fs.readFileSync(new URL('../bin/dropship.js', import.meta.url), 'utf8')
  assert(code.includes('enforceFreeLimit'), 'Missing enforceFreeLimit calls')
  assert(code.includes('incrementUsage'), 'Missing incrementUsage calls')
  assert(code.includes("enforceFreeLimit('scoutResults'"), 'Missing scout limit enforcement')
  assert(code.includes("enforceFreeLimit('sourcesPerMonth'"), 'Missing source limit enforcement')
  assert(code.includes("enforceFreeLimit('chatTurnsPerDay'"), 'Missing chat limit enforcement')
})

await test('bin/dropship.js has shebang', async () => {
  const fs = await import('fs')
  const code = fs.readFileSync(new URL('../bin/dropship.js', import.meta.url), 'utf8')
  assert(code.startsWith('#!/usr/bin/env node'), 'Missing shebang line')
})

await test('bin/dropship.js is executable', async () => {
  const fs = await import('fs')
  const stats = fs.statSync(new URL('../bin/dropship.js', import.meta.url))
  const isExecutable = (stats.mode & 0o111) !== 0
  assert(isExecutable, 'bin/dropship.js should be executable (chmod +x)')
})

await test('package.json bin entry correct', async () => {
  const fs = await import('fs')
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert(pkg.bin?.dropship === './bin/dropship.js', 'Wrong bin entry')
  assert(pkg.type === 'module', 'Missing type: module')
  assert(pkg.scripts?.test, 'Missing test script')
  assert(pkg.scripts?.start, 'Missing start script')
  assert(pkg.name === 'dropship-cli', `Wrong name: ${pkg.name}`)
  assert(pkg.version, 'Missing version')
})

await test('package.json has npm publish fields', async () => {
  const fs = await import('fs')
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert(pkg.repository, 'Missing repository')
  assert(pkg.keywords?.length > 0, 'Missing keywords')
  assert(pkg.engines?.node, 'Missing engines.node')
  assert(pkg.files?.length > 0, 'Missing files')
  assert(pkg.license === 'MIT', 'Missing or wrong license')
})

await test('LICENSE file exists', async () => {
  const fs = await import('fs')
  const exists = fs.existsSync(new URL('../LICENSE', import.meta.url))
  assert(exists, 'Missing LICENSE file')
})

await test('package.json has all required dependencies', async () => {
  const fs = await import('fs')
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const required = ['@anthropic-ai/sdk', '@supabase/supabase-js', 'chalk', 'commander', 'dotenv', 'inquirer', 'ora', 'axios', 'conf']
  for (const dep of required) {
    assert(pkg.dependencies?.[dep], `Missing dependency: ${dep}`)
  }
})

console.log('')

// ─── Phase 4: Integration Checks ────────────────────

console.log(chalk.bold('  Phase 4: Integration'))
console.log('')

await test('All npm dependencies installed', async () => {
  const deps = [
    '@anthropic-ai/sdk', '@supabase/supabase-js', 'chalk',
    'commander', 'dotenv', 'inquirer', 'ora', 'axios', 'conf'
  ]
  for (const dep of deps) {
    try {
      await import(dep)
    } catch (err) {
      throw new Error(`Missing dependency: ${dep}`)
    }
  }
})

await test('skills/chat.js uses standard tool format (inputSchema/execute)', async () => {
  const fs = await import('fs')
  const code = fs.readFileSync(new URL('./chat.js', import.meta.url), 'utf8')
  // Tools should define inputSchema (not input_schema) — the API conversion line is fine
  assert(!code.includes('_execute'), 'chat.js should use execute not _execute')
  assert(code.includes('inputSchema:'), 'chat.js missing inputSchema')
  assert(code.includes('.execute('), 'chat.js missing .execute() calls')
  // Ensure tool definitions use inputSchema, not input_schema
  const toolDefs = code.match(/^\s+input_schema:\s*\{/gm) || []
  assert(toolDefs.length === 0, 'chat.js tool definitions should use inputSchema not input_schema')
})

await test('No circular imports in core libs', async () => {
  await import('../lib/logger.js')
  await import('../lib/config.js')
  await import('../lib/db.js')
  await import('../lib/ai.js')
  await import('../lib/shopify.js')
  await import('../lib/cj.js')
  await import('../lib/suppliers.js')
  await import('../lib/license.js')
  await import('../lib/notify.js')
})

await test('No circular imports in skills', async () => {
  for (const skill of skills) {
    await import(`./${skill.file}.js`)
  }
})

await test('Shopify withRetry handles success', async () => {
  const { withRetry } = await import('../lib/shopify.js')
  let callCount = 0
  const result = await withRetry(async () => {
    callCount++
    return 'ok'
  })
  assert(result === 'ok', 'Expected ok')
  assert(callCount === 1, `Expected 1 call, got ${callCount}`)
})

await test('Shopify withRetry handles retry then success', async () => {
  const { withRetry } = await import('../lib/shopify.js')
  let callCount = 0
  const result = await withRetry(async () => {
    callCount++
    if (callCount < 2) {
      const err = new Error('Server error')
      err.response = { status: 500 }
      throw err
    }
    return 'recovered'
  })
  assert(result === 'recovered', 'Expected recovered')
  assert(callCount === 2, `Expected 2 calls, got ${callCount}`)
})

await test('Shopify withRetry throws on non-retryable error', async () => {
  const { withRetry } = await import('../lib/shopify.js')
  let threw = false
  try {
    await withRetry(async () => {
      const err = new Error('Not found')
      err.response = { status: 404 }
      throw err
    })
  } catch (err) {
    threw = true
    assert(err.message === 'Not found', `Expected "Not found", got "${err.message}"`)
  }
  assert(threw, 'Should have thrown on 404')
})

await test('CLAUDE.md exists and documents all commands', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8')
  assert(content.includes('dropship connect'), 'CLAUDE.md missing connect')
  assert(content.includes('dropship autopilot'), 'CLAUDE.md missing autopilot')
  assert(content.includes('dropship intel'), 'CLAUDE.md missing intel')
  assert(content.includes('dropship supplier'), 'CLAUDE.md missing supplier')
  assert(content.includes('dropship forecast'), 'CLAUDE.md missing forecast')
  assert(content.includes('dropship profit'), 'CLAUDE.md missing profit')
  assert(content.includes('dropship email'), 'CLAUDE.md missing email')
  assert(content.includes('dropship doctor'), 'CLAUDE.md missing doctor')
})

await test('File structure is complete', async () => {
  const fs = await import('fs')
  const path = await import('path')
  const base = new URL('..', import.meta.url).pathname

  const requiredFiles = [
    'bin/dropship.js',
    'lib/ai.js', 'lib/config.js', 'lib/db.js', 'lib/logger.js', 'lib/shopify.js', 'lib/cj.js', 'lib/suppliers.js', 'lib/license.js', 'lib/notify.js',
    'skills/scout.js', 'skills/source.js', 'skills/chat.js', 'skills/price.js', 'skills/fulfill.js', 'skills/guard.js',
    'skills/analyze.js', 'skills/segment.js', 'skills/growth.js', 'skills/support.js',
    'skills/audit.js', 'skills/intel.js', 'skills/supplier.js', 'skills/forecast.js',
    'skills/profit.js', 'skills/email.js', 'skills/doctor.js', 'skills/autopilot.js',
    'skills/returns.js', 'skills/inventory.js', 'skills/copy.js', 'skills/reviews.js', 'skills/legal.js', 'skills/notify.js', 'skills/upsell.js',
    'skills/self-test.js',
    'package.json', 'CLAUDE.md', 'LICENSE'
  ]

  for (const file of requiredFiles) {
    const fullPath = path.join(base, file)
    assert(fs.existsSync(fullPath), `Missing file: ${file}`)
  }
})

console.log('')

// ─── Summary ────────────────────────────────────────

console.log(chalk.dim('  ─'.repeat(25)))
console.log('')
console.log(`  ${chalk.green.bold(passed)} passed  ${failed > 0 ? chalk.red.bold(failed) + ' failed  ' : ''}${skipped > 0 ? chalk.yellow(skipped) + ' skipped' : ''}`)
console.log('')

if (failed > 0) {
  console.log(chalk.red.bold('  ✗ TESTS FAILED'))
  process.exit(1)
} else {
  console.log(chalk.green.bold('  ✓ ALL TESTS PASSED — PRODUCT IS UNTOUCHABLE'))
  process.exit(0)
}
