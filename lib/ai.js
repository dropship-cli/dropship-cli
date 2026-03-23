// AI — Claude client with tool use (the brain)
// All AI calls go through here. Rate-limited, retried, bulletproof.
import Anthropic from '@anthropic-ai/sdk'
import config from './config.js'
import logger from './logger.js'

const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 4096
const RATE_LIMIT_DELAY = 1000 // Min ms between API calls
const MAX_API_RETRIES = 3

let client = null
let lastCallTime = 0
let rateLimitLock = false

function getClient() {
  if (!client) {
    const apiKey = config.getAnthropicKey()
    if (!apiKey) throw new Error('Anthropic API key not configured. Run: dropship config')
    client = new Anthropic({ apiKey })
  }
  return client
}

// Rate limiter — prevents hammering the API (mutex-based to handle concurrency)
async function rateLimitWait() {
  // Spin-wait if another call holds the lock
  while (rateLimitLock) {
    await new Promise(r => setTimeout(r, 50))
  }
  rateLimitLock = true
  try {
    const now = Date.now()
    const elapsed = now - lastCallTime
    if (elapsed < RATE_LIMIT_DELAY) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY - elapsed))
    }
    lastCallTime = Date.now()
  } finally {
    rateLimitLock = false
  }
}

// Retry wrapper for API calls with exponential backoff
async function withRetry(fn, retries = MAX_API_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      await rateLimitWait()
      return await fn()
    } catch (err) {
      const status = err.status || err.error?.status
      const isRetryable = status === 429 || status === 529 || status >= 500

      if (isRetryable && i < retries - 1) {
        const delay = (status === 429 || status === 529)
          ? Math.min(30000, (i + 1) * 5000) // Rate limit / overloaded: 5s, 10s, 15s
          : (i + 1) * 2000 // Server error: 2s, 4s, 6s
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
}

// Run a simple completion (no tools)
async function ask(prompt, { system, temperature = 0.3 } = {}) {
  const c = getClient()
  const messages = [{ role: 'user', content: prompt }]

  const res = await withRetry(() => c.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature,
    ...(system ? { system } : {}),
    messages
  }))

  return res.content[0]?.text || ''
}

// Run an agent loop with tool use
async function runAgent({ system, task, tools, maxIterations = 10, temperature = 0.3, onAction }) {
  const c = getClient()
  const messages = [{ role: 'user', content: task }]
  const startTime = Date.now()
  let iterations = 0

  // Convert tools to Anthropic format
  const anthropicTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema
  }))

  while (iterations < maxIterations) {
    iterations++

    let res
    try {
      res = await withRetry(() => c.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature,
        system,
        tools: anthropicTools,
        messages
      }))
    } catch (err) {
      return {
        success: false,
        result: `API error: ${err.message}`,
        iterations,
        duration: Date.now() - startTime,
        error: err.message
      }
    }

    // Collect text blocks
    const textBlocks = res.content.filter(b => b.type === 'text')
    const toolBlocks = res.content.filter(b => b.type === 'tool_use')

    // If no tool calls, we're done
    if (toolBlocks.length === 0) {
      const finalText = textBlocks.map(b => b.text).join('\n')
      return {
        success: true,
        result: finalText,
        iterations,
        duration: Date.now() - startTime
      }
    }

    // Add assistant message
    messages.push({ role: 'assistant', content: res.content })

    // Execute each tool call
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
        if (onAction) onAction(block.name, block.input)
        const result = await tool.execute(block.input)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result)
        })
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ error: err.message })
        })
      }
    }

    messages.push({ role: 'user', content: toolResults })
  }

  return {
    success: false,
    result: 'Max iterations reached',
    iterations,
    duration: Date.now() - startTime
  }
}

// Quick JSON extraction from AI response
async function askJSON(prompt, { system, temperature = 0.1 } = {}) {
  const text = await ask(prompt, { system, temperature })
  try {
    // Try to extract JSON from response
    const match = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/) || text.match(/\[[\s\S]*\]/)
    if (match) {
      return JSON.parse(match[1] || match[0])
    }
    return JSON.parse(text)
  } catch {
    return null
  }
}

export { ask, runAgent, askJSON, MODEL }
export default { ask, runAgent, askJSON, MODEL }
