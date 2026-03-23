// Suppliers — Multi-supplier router with scoring
// CJ-only for now, extensible for AliExpress/Zendrop/ShipBob later
import config from './config.js'
import * as cj from './cj.js'

// ── Score a supplier option ──────────────────────────────────────────────
// Weights: cost 40%, speed 30%, reliability 30%
function scoreSupplier(option, weights = {}) {
  const w = {
    cost: weights.cost ?? 0.4,
    speed: weights.speed ?? 0.3,
    reliability: weights.reliability ?? 0.3
  }

  const costScore = Math.max(0, 1 - (option.price / 100))
  const speedScore = Math.max(0, 1 - ((option.shippingDays || 7) / 30))
  const reliabilityScore = (option.fulfillmentRate || 95) / 100

  return (costScore * w.cost) + (speedScore * w.speed) + (reliabilityScore * w.reliability)
}

// ── Check if a supplier is configured ────────────────────────────────────
function isSupplierConfigured(name) {
  switch (name) {
    case 'cj':
      return !!(config.getCJApiKey() || (config.getCJEmail() && config.getCJPassword()))
    default:
      return false
  }
}

// ── Get list of configured supplier names ────────────────────────────────
function getActiveSupplierNames() {
  const active = []
  if (isSupplierConfigured('cj')) active.push('cj')
  // Future: if (isSupplierConfigured('aliexpress')) active.push('aliexpress')
  return active
}

// ── Search all active suppliers, return scored results ───────────────────
async function findBestSupplier(keyword, preferences = {}) {
  const searches = []

  if (isSupplierConfigured('cj')) {
    searches.push(
      cj.searchProducts(keyword)
        .then(products => products.map(p => ({
          ...p,
          fulfillmentRate: 95,
          supplier: 'cj'
        })))
        .catch(() => [])
    )
  }

  // Future: add aliexpress, zendrop searches here

  if (searches.length === 0) {
    return null
  }

  const results = await Promise.allSettled(searches)
  const allOptions = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)

  if (allOptions.length === 0) return null

  const scored = allOptions.map(opt => ({
    ...opt,
    score: scoreSupplier(opt, preferences)
  }))

  scored.sort((a, b) => b.score - a.score)
  return scored
}

export { scoreSupplier, findBestSupplier, getActiveSupplierNames, isSupplierConfigured }
export default { scoreSupplier, findBestSupplier, getActiveSupplierNames, isSupplierConfigured }
