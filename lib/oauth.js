// Shopify OAuth — Browser-based authorization for `dropship connect`
// Opens browser → merchant authorizes → Vercel server exchanges code →
// redirects to localhost with token → done
import http from 'node:http'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'

const CLIENT_ID = '6b5696a122018fb3771a3c4dcd2bc312'
const OAUTH_SERVER = 'https://dropship-oauth-server.vercel.app/callback'
const DEFAULT_PORT = 3456
const TIMEOUT_MS = 120_000 // 2 minutes
const SCOPES = [
  'read_products', 'write_products',
  'read_orders', 'write_orders',
  'read_fulfillments', 'write_fulfillments',
  'read_customers',
  'read_inventory',
  'read_analytics'
].join(',')

function openBrowser(url) {
  const platform = process.platform
  try {
    if (platform === 'darwin') execSync(`open "${url}"`)
    else if (platform === 'win32') execSync(`start "" "${url}"`)
    else execSync(`xdg-open "${url}"`)
  } catch {
    // Browser open failed — user will see the URL printed in terminal
  }
}

function successHTML(shop) {
  return `<!DOCTYPE html><html><head><title>Connected!</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fff}
.box{text-align:center;padding:2rem}.check{font-size:3rem;margin-bottom:1rem}h1{margin:0 0 .5rem}p{color:#888}</style></head>
<body><div class="box"><div class="check">&#10003;</div><h1>Connected to ${shop}</h1><p>You can close this tab and return to the terminal.</p></div></body></html>`
}

function errorHTML(msg) {
  return `<!DOCTYPE html><html><head><title>Error</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fff}
.box{text-align:center;padding:2rem}h1{color:#f44;margin:0 0 .5rem}p{color:#888}</style></head>
<body><div class="box"><h1>Connection Failed</h1><p>${msg}</p><p>Return to the terminal and try again.</p></div></body></html>`
}

/**
 * Start Shopify OAuth flow
 * @param {string} shop - e.g. "my-store.myshopify.com"
 * @returns {Promise<{ shop: string, accessToken: string }>}
 */
async function startOAuthFlow(shop) {
  const state = crypto.randomBytes(24).toString('hex')
  const redirectUri = encodeURIComponent(OAUTH_SERVER)
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${redirectUri}&state=${state}`

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${DEFAULT_PORT}`)

      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const token = url.searchParams.get('token')
      const returnedShop = url.searchParams.get('shop')

      if (!token) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(errorHTML('No access token received.'))
        cleanup(server, timer)
        reject(new Error('No access token received from OAuth server'))
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(successHTML(returnedShop || shop))
      cleanup(server, timer)
      resolve({ shop: returnedShop || shop, accessToken: token })
    })

    const timer = setTimeout(() => {
      cleanup(server, timer)
      reject(new Error('OAuth timed out — no response within 2 minutes'))
    }, TIMEOUT_MS)

    server.on('error', (err) => {
      clearTimeout(timer)
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${DEFAULT_PORT} is in use. Close the other process and try again.`))
      } else {
        reject(err)
      }
    })

    server.listen(DEFAULT_PORT, '127.0.0.1', () => {
      openBrowser(authUrl)
    })
  })
}

function cleanup(server, timer) {
  clearTimeout(timer)
  try { server.close() } catch {}
}

export { startOAuthFlow, SCOPES, DEFAULT_PORT, CLIENT_ID }
export default { startOAuthFlow, SCOPES, DEFAULT_PORT, CLIENT_ID }
