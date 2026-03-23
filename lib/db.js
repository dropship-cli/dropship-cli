// DB — Supabase client for state persistence
// Optional — CLI works without it but loses persistence
import { createClient } from '@supabase/supabase-js'
import config from './config.js'

let supabase = null

function getClient() {
  if (supabase) return supabase

  const url = config.getSupabaseUrl()
  const key = config.getSupabaseKey()

  if (!url || !key) return null

  supabase = createClient(url, key)
  return supabase
}

// Log an agent run
async function logRun({ agent, shop, success, duration, result, error }) {
  const db = getClient()
  if (!db) return null

  const { data } = await db.from('agent_runs').insert({
    agent_name: agent,
    shop,
    success,
    duration_ms: duration,
    result: typeof result === 'string' ? result : JSON.stringify(result),
    error: error || null,
    created_at: new Date().toISOString()
  }).select().single()

  return data
}

// Log an action
async function logAction({ shop, type, message, metadata }) {
  const db = getClient()
  if (!db) return null

  await db.from('agent_logs').insert({
    shop,
    type,
    message,
    metadata: metadata || null,
    created_at: new Date().toISOString()
  })
}

// Log an error
async function logError({ shop, context, message, stack }) {
  const db = getClient()
  if (!db) return null

  await db.from('errors').insert({
    shop,
    context,
    message,
    stack: stack || null,
    created_at: new Date().toISOString()
  })
}

// Get recent runs
async function getRuns({ shop, agent, limit = 20 }) {
  const db = getClient()
  if (!db) return []

  let query = db.from('agent_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (shop) query = query.eq('shop', shop)
  if (agent) query = query.eq('agent_name', agent)

  const { data } = await query
  return data || []
}

// Get/set config values
async function getConfig(shop, key) {
  const db = getClient()
  if (!db) return null

  const { data } = await db.from('config')
    .select('value')
    .eq('shop', shop)
    .eq('key', key)
    .single()

  return data?.value || null
}

async function setConfig(shop, key, value) {
  const db = getClient()
  if (!db) return null

  await db.from('config').upsert({
    shop,
    key,
    value,
    updated_at: new Date().toISOString()
  }, { onConflict: 'shop,key' })
}

// Check if DB is available
function isAvailable() {
  return !!getClient()
}

export {
  getClient, logRun, logAction, logError,
  getRuns, getConfig, setConfig, isAvailable
}

export default {
  getClient, logRun, logAction, logError,
  getRuns, getConfig, setConfig, isAvailable
}
