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

  const { data, error: dbError } = await db.from('agent_runs').insert({
    agent_name: agent,
    shop,
    success,
    duration_ms: duration,
    result: typeof result === 'string' ? result : JSON.stringify(result),
    error: error || null,
    created_at: new Date().toISOString()
  }).select().single()

  if (dbError) { console.error('[db] logRun error:', dbError.message); return null }
  return data
}

// Log an action
async function logAction({ shop, type, message, metadata }) {
  const db = getClient()
  if (!db) return null

  const { error: dbError } = await db.from('agent_logs').insert({
    shop,
    type,
    message,
    metadata: metadata || null,
    created_at: new Date().toISOString()
  })
  if (dbError) console.error('[db] logAction error:', dbError.message)
}

// Log an error
async function logError({ shop, context, message, stack }) {
  const db = getClient()
  if (!db) return null

  const { error: dbError } = await db.from('errors').insert({
    shop,
    context,
    message,
    stack: stack || null,
    created_at: new Date().toISOString()
  })
  if (dbError) console.error('[db] logError error:', dbError.message)
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

  const { data, error: dbError } = await query
  if (dbError) { console.error('[db] getRuns error:', dbError.message); return [] }
  return data || []
}

// Get/set config values
async function getConfig(shop, key) {
  const db = getClient()
  if (!db) return null

  const { data, error: dbError } = await db.from('config')
    .select('value')
    .eq('shop', shop)
    .eq('key', key)
    .single()

  if (dbError && dbError.code !== 'PGRST116') console.error('[db] getConfig error:', dbError.message)
  return data?.value || null
}

async function setConfig(shop, key, value) {
  const db = getClient()
  if (!db) return null

  const { error: dbError } = await db.from('config').upsert({
    shop,
    key,
    value,
    updated_at: new Date().toISOString()
  }, { onConflict: 'shop,key' })
  if (dbError) console.error('[db] setConfig error:', dbError.message)
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
