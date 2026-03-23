// Config — Store credentials, API keys, persistent config
// Uses `conf` package so config survives restarts
import Conf from 'conf'
import dotenv from 'dotenv'

dotenv.config()

const store = new Conf({
  projectName: 'dropship-cli',
  schema: {
    shopify: {
      type: 'object',
      properties: {
        shop: { type: 'string' },
        accessToken: { type: 'string' },
        apiVersion: { type: 'string', default: '2024-10' }
      }
    },
    supabase: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        key: { type: 'string' }
      }
    },
    anthropic: {
      type: 'object',
      properties: {
        apiKey: { type: 'string' }
      }
    },
    cj: {
      type: 'object',
      properties: {
        apiKey: { type: 'string' },
        token: { type: 'string' },
        tokenExpiry: { type: 'string' },
        email: { type: 'string' },
        password: { type: 'string' }
      }
    }
  }
})

const config = {
  // Shopify
  getShop() {
    return store.get('shopify.shop') || process.env.SHOPIFY_SHOP || null
  },
  getShopifyToken() {
    return store.get('shopify.accessToken') || process.env.SHOPIFY_ACCESS_TOKEN || null
  },
  getShopifyApiVersion() {
    return store.get('shopify.apiVersion') || process.env.SHOPIFY_API_VERSION || '2024-10'
  },
  setShopify({ shop, accessToken }) {
    store.set('shopify.shop', shop)
    store.set('shopify.accessToken', accessToken)
  },

  // Supabase
  getSupabaseUrl() {
    return store.get('supabase.url') || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null
  },
  getSupabaseKey() {
    return store.get('supabase.key') || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || null
  },
  setSupabase({ url, key }) {
    store.set('supabase.url', url)
    store.set('supabase.key', key)
  },

  // Anthropic
  getAnthropicKey() {
    return store.get('anthropic.apiKey') || process.env.ANTHROPIC_API_KEY || null
  },
  setAnthropicKey(key) {
    store.set('anthropic.apiKey', key)
  },

  // CJ Dropshipping
  getCJApiKey() {
    return store.get('cj.apiKey') || process.env.CJ_API_KEY || null
  },
  getCJToken() {
    return store.get('cj.token') || null
  },
  getCJTokenExpiry() {
    return store.get('cj.tokenExpiry') || null
  },
  getCJEmail() {
    return store.get('cj.email') || process.env.CJ_EMAIL || null
  },
  getCJPassword() {
    return store.get('cj.password') || process.env.CJ_PASSWORD || null
  },
  setCJ({ apiKey, token, tokenExpiry, email, password }) {
    if (apiKey) store.set('cj.apiKey', apiKey)
    if (token) store.set('cj.token', token)
    if (tokenExpiry) store.set('cj.tokenExpiry', tokenExpiry)
    if (email) store.set('cj.email', email)
    if (password) store.set('cj.password', password)
  },
  clearCJToken() {
    store.delete('cj.token')
    store.delete('cj.tokenExpiry')
  },

  // Check if connected
  isConnected() {
    return !!(this.getShop() && this.getShopifyToken())
  },

  // Check if all required keys are set
  isConfigured() {
    return !!(this.getShop() && this.getShopifyToken() && this.getAnthropicKey())
  },

  // Get full config summary (safe — no secrets)
  summary() {
    return {
      shop: this.getShop() || '(not set)',
      shopifyConnected: !!this.getShopifyToken(),
      supabaseConnected: !!(this.getSupabaseUrl() && this.getSupabaseKey()),
      anthropicConnected: !!this.getAnthropicKey(),
      cjConnected: !!this.getCJApiKey()
    }
  },

  // Reset everything
  reset() {
    store.clear()
  },

  // Raw access for advanced use
  raw: store
}

export default config
