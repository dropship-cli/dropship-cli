// Logger — Styled terminal output with chalk + ora
// All output goes through here for consistency
import chalk from 'chalk'
import ora from 'ora'

const BRAND = chalk.hex('#00ff88').bold
const DIM = chalk.dim
const WARN = chalk.yellow
const ERR = chalk.red.bold
const SUCCESS = chalk.green
const INFO = chalk.cyan
const BOLD = chalk.bold

let currentSpinner = null

const logger = {
  // Brand header
  banner() {
    console.log('')
    console.log(BRAND('  ⚡ DROPSHIP CLI'))
    console.log(DIM('  AI-powered autonomous dropshipping operator'))
    console.log('')
  },

  // Section headers
  header(text) {
    console.log('')
    console.log(BRAND(`▸ ${text}`))
    console.log(DIM('─'.repeat(50)))
  },

  // Standard messages
  info(msg) { console.log(INFO('  ℹ ') + msg) },
  success(msg) { console.log(SUCCESS('  ✓ ') + msg) },
  warn(msg) { console.log(WARN('  ⚠ ') + msg) },
  error(msg) { console.log(ERR('  ✗ ') + msg) },
  dim(msg) { console.log(DIM('    ' + msg)) },
  bold(msg) { console.log(BOLD('  ' + msg)) },

  // Key-value pairs
  kv(key, value) {
    console.log(DIM('  ' + key + ': ') + BOLD(String(value)))
  },

  // List items
  item(text, indent = 2) {
    console.log(' '.repeat(indent) + DIM('•') + ' ' + text)
  },

  // Table-like output
  table(rows) {
    if (!rows.length) return
    const keys = Object.keys(rows[0])
    const widths = keys.map(k => Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)))

    // Header
    console.log(DIM('  ' + keys.map((k, i) => k.padEnd(widths[i])).join('  ')))
    console.log(DIM('  ' + widths.map(w => '─'.repeat(w)).join('  ')))

    // Rows
    for (const row of rows) {
      console.log('  ' + keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join('  '))
    }
  },

  // Spinner for async operations
  spin(text) {
    if (currentSpinner) currentSpinner.stop()
    currentSpinner = ora({ text, color: 'green', spinner: 'dots' }).start()
    return currentSpinner
  },

  stopSpin(text, success = true) {
    if (currentSpinner) {
      if (success) {
        currentSpinner.succeed(text || currentSpinner.text)
      } else {
        currentSpinner.fail(text || currentSpinner.text)
      }
      currentSpinner = null
    }
  },

  // JSON output (for --json flag)
  json(data) {
    console.log(JSON.stringify(data, null, 2))
  },

  // Money formatting
  money(amount) {
    return '$' + Number(amount).toFixed(2)
  },

  // Percentage formatting
  pct(value) {
    return Number(value).toFixed(1) + '%'
  },

  // Agent action log
  agent(agentName, action) {
    console.log(BRAND(`  [${agentName}]`) + ' ' + action)
  },

  // Divider
  divider() {
    console.log(DIM('  ' + '─'.repeat(48)))
  },

  // Blank line
  blank() {
    console.log('')
  }
}

export default logger
