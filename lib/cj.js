// CJ Dropshipping — API client for Dropship CLI
// Token management, product search, order placement, tracking
// Ported from phantom-store/lib/cj.js, adapted for CLI (axios + conf)
import axios from 'axios'
import config from './config.js'

const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1'
const CJ_REFRESH_STRATEGY = process.env.CJ_REFRESH_STRATEGY || 'A'

// ── Retry wrapper ────────────────────────────────────────────────────────
async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      const status = err.response?.status
      if ((status === 429 || status >= 500) && i < retries - 1) {
        const delay = status === 429 ? 5000 * (i + 1) : 1000 * (i + 1)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
}

// ── Full re-auth with email/password ─────────────────────────────────────
async function _fetchFreshToken() {
  const email = config.getCJEmail()
  const password = config.getCJPassword()
  if (!email || !password) {
    throw new Error('CJ_EMAIL or CJ_PASSWORD not configured — needed for token auth')
  }

  const { data } = await withRetry(() => axios.post(
    `${CJ_BASE}/authentication/getAccessToken`,
    { email, password },
    { timeout: 15000 }
  ))

  if (data.code !== 200 || !data.data?.accessToken) {
    throw new Error(`CJ auth failed: ${data.message || 'unknown error'}`)
  }

  const token = data.data.accessToken
  const expiry = data.data.tokenExpiryDate
    ? new Date(data.data.tokenExpiryDate)
    : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

  return { token, expiry }
}

// ── Refresh existing token ───────────────────────────────────────────────
async function _refreshToken(currentToken) {
  let res

  if (CJ_REFRESH_STRATEGY === 'A') {
    res = await withRetry(() => axios.get(
      `${CJ_BASE}/authentication/refreshAccessToken`,
      { headers: { 'CJ-Access-Token': currentToken }, timeout: 15000 }
    ))
  } else if (CJ_REFRESH_STRATEGY === 'B') {
    res = await withRetry(() => axios.post(
      `${CJ_BASE}/authentication/refreshAccessToken`,
      { refreshToken: currentToken },
      { headers: { 'CJ-Access-Token': currentToken }, timeout: 15000 }
    ))
  } else {
    throw new Error(`CJ_REFRESH_STRATEGY="${CJ_REFRESH_STRATEGY}" — skipping refresh`)
  }

  const data = res.data
  if (data.code !== 200 || !data.data?.accessToken) {
    throw new Error(`CJ refresh failed: ${data.message || 'unknown error'}`)
  }

  const token = data.data.accessToken
  const expiry = data.data.tokenExpiryDate
    ? new Date(data.data.tokenExpiryDate)
    : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

  return { token, expiry }
}

// ── Get valid CJ token (cache → refresh → re-auth) ──────────────────────
async function getCJToken() {
  // 1. Check cached token
  const cachedToken = config.getCJToken()
  const cachedExpiry = config.getCJTokenExpiry()
  const now = Date.now()
  const expiryMs = cachedExpiry ? new Date(cachedExpiry).getTime() : 0
  const hoursLeft = (expiryMs - now) / 3_600_000

  // 2. Cache hit: valid for >24h
  if (cachedToken && hoursLeft > 24) {
    return cachedToken
  }

  // 3. Token expiring soon — try refresh
  if (cachedToken && CJ_REFRESH_STRATEGY !== 'REAUTH_ONLY') {
    try {
      const { token, expiry } = await _refreshToken(cachedToken)
      config.setCJ({ token, tokenExpiry: expiry.toISOString() })
      return token
    } catch {
      // Refresh failed — fall through to re-auth
    }
  }

  // 4. Full re-auth
  const { token, expiry } = await _fetchFreshToken()
  config.setCJ({ token, tokenExpiry: expiry.toISOString() })
  return token
}

// ── Test CJ connection ──────────────────────────────────────────────────
async function testCJConnection() {
  try {
    const token = await getCJToken()
    if (token) return { connected: true, message: 'CJ Dropshipping connected' }
    return { connected: false, message: 'Could not obtain CJ token' }
  } catch (err) {
    return { connected: false, message: err.message }
  }
}

// ── CJ API call helper: always uses a valid token ────────────────────────
async function cjFetch(path, options = {}, _reauthed = false) {
  const token = await getCJToken()
  const url = `${CJ_BASE}${path}`

  const axiosOpts = {
    url,
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'CJ-Access-Token': token,
      ...(options.headers || {})
    },
    timeout: 15000
  }
  if (options.data) axiosOpts.data = options.data

  const res = await withRetry(() => axios(axiosOpts))
  const data = res.data

  // Token rejected — clear cache and retry once
  if (data.code === 1600101 || data.code === 1600102) {
    if (_reauthed) {
      throw new Error(`CJ token rejected after re-auth — check credentials`)
    }
    config.clearCJToken()
    return cjFetch(path, options, true)
  }

  return data
}

// ── Search CJ products by keyword ────────────────────────────────────────
async function searchProducts(keyword, { page = 1, pageSize = 20 } = {}) {
  const data = await cjFetch(
    `/product/list?pageNum=${page}&pageSize=${pageSize}&productNameEn=${encodeURIComponent(keyword)}`
  )
  const products = data.data?.list || []
  return products
    .filter(p => parseFloat(p.sellPrice || 0) > 0)
    .map(p => ({
      id: p.pid,
      title: p.productNameEn,
      price: parseFloat(p.sellPrice || 0),
      image: p.productImage,
      category: p.categoryName,
      shippingDays: 7,
      variants: (p.variants || []).map(v => ({
        vid: v.vid,
        name: v.variantNameEn,
        price: parseFloat(v.variantSellPrice || p.sellPrice || 0),
        sku: v.variantSku
      })),
      supplier: 'cj',
      raw: p
    }))
}

// ── Get full product details ─────────────────────────────────────────────
async function getProductDetail(productId) {
  const data = await cjFetch(`/product/query?pid=${productId}`)
  if (!data.data) return null

  const p = data.data
  return {
    id: p.pid,
    title: p.productNameEn,
    description: p.description || p.productNameEn,
    price: parseFloat(p.sellPrice || 0),
    image: p.productImage,
    images: (p.productImageSet || []).map(img => img.imageUrl || img),
    category: p.categoryName,
    weight: p.productWeight,
    variants: (p.variants || []).map(v => ({
      vid: v.vid,
      name: v.variantNameEn,
      price: parseFloat(v.variantSellPrice || p.sellPrice || 0),
      sku: v.variantSku,
      image: v.variantImage
    })),
    supplier: 'cj'
  }
}

// ── Place order with CJ ─────────────────────────────────────────────────
async function placeOrder(shopifyOrder, cjVariantId) {
  const shipping = shopifyOrder.shipping_address || shopifyOrder.billing_address || {}
  const lineItems = shopifyOrder.line_items || []

  const orderBody = {
    orderNumber: String(shopifyOrder.id),
    shippingZip: shipping.zip || '',
    shippingCountryCode: shipping.country_code || 'US',
    shippingCountry: shipping.country || 'United States',
    shippingProvince: shipping.province || '',
    shippingCity: shipping.city || '',
    shippingAddress: shipping.address1 || '',
    shippingCustomerName: (shipping.first_name || '') + ' ' + (shipping.last_name || ''),
    shippingPhone: shipping.phone || '0000000000',
    remark: 'Dropship CLI Auto Order',
    products: lineItems.map(item => ({
      vid: item.sku || cjVariantId,
      quantity: item.quantity || 1,
      shippingName: 'CJPacket Ordinary'
    }))
  }

  const data = await cjFetch('/shopping/order/createOrder', {
    method: 'POST',
    data: orderBody
  })

  return {
    success: !!(data.data?.orderId),
    cjOrderId: data.data?.orderId || null,
    trackingNumber: data.data?.trackingNumber || null,
    error: data.code !== 200 ? data.message : null
  }
}

// ── Get tracking for a CJ order ─────────────────────────────────────────
async function getTracking(cjOrderId) {
  const data = await cjFetch(`/shopping/order/getOrderDetail?orderId=${cjOrderId}`)
  return {
    trackingNumber: data.data?.trackingNumber || null,
    status: data.data?.orderStatus || null,
    shippingCompany: data.data?.logisticsName || null
  }
}

export { getCJToken, testCJConnection, searchProducts, getProductDetail, placeOrder, getTracking, cjFetch }
export default { getCJToken, testCJConnection, searchProducts, getProductDetail, placeOrder, getTracking, cjFetch }
