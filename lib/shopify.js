// Shopify — API client with retry logic
// All Shopify calls go through here
import axios from 'axios'
import config from './config.js'
import logger from './logger.js'

const MAX_RETRIES = 3
const RETRY_DELAY = 1000

async function withRetry(fn, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      const status = err.response?.status
      // Retry on rate limit or server errors
      if ((status === 429 || status >= 500) && i < retries - 1) {
        const delay = status === 429
          ? Math.ceil(parseFloat(err.response?.headers?.['retry-after'] || '2')) * 1000
          : RETRY_DELAY * (i + 1)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
}

function getHeaders() {
  const token = config.getShopifyToken()
  if (!token) throw new Error('Shopify not connected. Run: dropship connect')
  return {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json'
  }
}

function getBaseUrl() {
  const shop = config.getShop()
  if (!shop) throw new Error('Shop not configured. Run: dropship connect')
  const version = config.getShopifyApiVersion()
  return `https://${shop}/admin/api/${version}`
}

// Generic Shopify API call
async function shopifyFetch(endpoint, { method = 'GET', data = null } = {}) {
  return withRetry(async () => {
    const url = `${getBaseUrl()}${endpoint}`
    const res = await axios({
      method,
      url,
      headers: getHeaders(),
      ...(data ? { data } : {})
    })
    return res.data
  })
}

// Products
async function getProducts(params = {}) {
  const query = new URLSearchParams({ limit: '50', ...params }).toString()
  const res = await shopifyFetch(`/products.json?${query}`)
  return res.products || []
}

async function getProduct(id) {
  const res = await shopifyFetch(`/products/${id}.json`)
  return res.product
}

async function updateProduct(id, data) {
  return shopifyFetch(`/products/${id}.json`, {
    method: 'PUT',
    data: { product: data }
  })
}

async function createProduct(data) {
  const res = await shopifyFetch('/products.json', {
    method: 'POST',
    data: { product: data }
  })
  return res.product
}

// Orders
async function getOrders(params = {}) {
  const query = new URLSearchParams({ limit: '50', status: 'any', ...params }).toString()
  const res = await shopifyFetch(`/orders.json?${query}`)
  return res.orders || []
}

async function getOrder(id) {
  const res = await shopifyFetch(`/orders/${id}.json`)
  return res.order
}

async function fulfillOrder(orderId, { trackingNumber, trackingCompany, trackingUrl } = {}) {
  // Get fulfillment orders first
  const foRes = await shopifyFetch(`/orders/${orderId}/fulfillment_orders.json`)
  const fulfillmentOrders = foRes.fulfillment_orders || []

  const openFO = fulfillmentOrders.find(fo =>
    fo.status === 'open' || fo.status === 'in_progress'
  )
  if (!openFO) throw new Error('No open fulfillment orders')

  const fulfillmentData = {
    fulfillment: {
      line_items_by_fulfillment_order: [{
        fulfillment_order_id: openFO.id
      }],
      tracking_info: trackingNumber ? {
        number: trackingNumber,
        company: trackingCompany || '',
        url: trackingUrl || ''
      } : undefined
    }
  }

  return shopifyFetch('/fulfillments.json', {
    method: 'POST',
    data: fulfillmentData
  })
}

// Customers
async function getCustomers(params = {}) {
  const query = new URLSearchParams({ limit: '50', ...params }).toString()
  const res = await shopifyFetch(`/customers.json?${query}`)
  return res.customers || []
}

// Shop info
async function getShopInfo() {
  const res = await shopifyFetch('/shop.json')
  return res.shop
}

// Inventory
async function getInventoryLevels(inventoryItemIds) {
  const ids = Array.isArray(inventoryItemIds) ? inventoryItemIds.join(',') : inventoryItemIds
  const res = await shopifyFetch(`/inventory_levels.json?inventory_item_ids=${ids}`)
  return res.inventory_levels || []
}

// Count
async function countProducts() {
  const res = await shopifyFetch('/products/count.json')
  return res.count
}

async function countOrders(params = {}) {
  const query = new URLSearchParams({ status: 'any', ...params }).toString()
  const res = await shopifyFetch(`/orders/count.json?${query}`)
  return res.count
}

// Test connection
async function testConnection() {
  try {
    const shop = await getShopInfo()
    return { connected: true, name: shop.name, domain: shop.domain, plan: shop.plan_display_name }
  } catch (err) {
    return { connected: false, error: err.message }
  }
}

export {
  shopifyFetch,
  getProducts, getProduct, updateProduct, createProduct,
  getOrders, getOrder, fulfillOrder,
  getCustomers, getShopInfo,
  getInventoryLevels, countProducts, countOrders,
  testConnection, withRetry
}

export default {
  shopifyFetch,
  getProducts, getProduct, updateProduct, createProduct,
  getOrders, getOrder, fulfillOrder,
  getCustomers, getShopInfo,
  getInventoryLevels, countProducts, countOrders,
  testConnection, withRetry
}
