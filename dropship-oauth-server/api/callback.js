export default async function handler(req, res) {
  const { code, shop } = req.query

  if (!code || !shop) {
    return res.status(400).send('Missing code or shop parameter')
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return res.status(500).send('Server misconfigured: missing Shopify app credentials')
  }

  try {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
    })

    const data = await response.json()

    if (!response.ok || !data.access_token) {
      return res.status(502).send(`Token exchange failed: ${data.error_description || data.error || 'unknown error'}`)
    }

    const redirectUrl = `http://127.0.0.1:3456/callback?token=${encodeURIComponent(data.access_token)}&shop=${encodeURIComponent(shop)}`
    return res.redirect(302, redirectUrl)
  } catch (err) {
    return res.status(502).send(`Token exchange error: ${err.message}`)
  }
}
