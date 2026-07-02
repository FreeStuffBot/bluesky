import { Buffer } from 'buffer'
import { Hono, type Context } from 'hono'
import { createHonoHandler } from 'freestuff/hono'
import { newSignedMessageVerifier, type Product } from 'freestuff'
import { sendProductPost } from './product-post'

interface Env {
  BSKY_IDENTIFIER: string
  BSKY_PASSWORD: string
  BSKY_SERVICE_URL?: string
  FREESTUFF_PUBLIC_KEY: string
  FREESTUFF_API_KEY: string
  DISCORD_WEBHOOK_URL?: string
}

let env: Env | null = null

const app = new Hono<{ Bindings: Env }>()
app.all('*', (c, next) => {
  env = c.env

  if (!env?.BSKY_IDENTIFIER) {
    console.warn('⚠️  WARNING: BSKY_IDENTIFIER environment variable is not set!')
  }

  if (!env?.BSKY_PASSWORD) {
    console.warn('⚠️  WARNING: BSKY_PASSWORD environment variable is not set!')
  }

  if (!env?.FREESTUFF_PUBLIC_KEY) {
    console.warn('⚠️  WARNING: FREESTUFF_PUBLIC_KEY environment variable is not set!')
    console.warn('   Get it from the FreeStuff Dashboard: https://dashboard.freestuffbot.xyz')
  }

  if (!env?.FREESTUFF_API_KEY) {
    console.warn('⚠️  WARNING: FREESTUFF_API_KEY environment variable is not set!')
    console.warn('   Get it from the FreeStuff Dashboard: https://docs.freestuffbot.xyz/api-v2/rest-api')
  }

  return next()
})

function verifyProductPostAuth(c: Context<{ Bindings: Env }>) {
  const authHeader = c.req.header('authorization')?.trim() ?? ''
  const expectedKey = c.env?.FREESTUFF_API_KEY

  if (!expectedKey) {
    return c.json({ error: 'FREESTUFF_API_KEY is not configured' }, 500)
  }

  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Authorization header must be Bearer token' }, 401)
  }

  const token = authHeader.slice('Bearer '.length)
  if (token !== expectedKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return null
}

// @ts-ignore
app.post('/event', ...createHonoHandler<Env>(c => c.env?.FREESTUFF_PUBLIC_KEY))

app.post('/product', async (c) => {
  const authError = verifyProductPostAuth(c)
  if (authError) {
    return authError
  }

  const body = await c.req.json().catch(() => null)
  console.log('/product request body:', JSON.stringify(body))
  const productId = String(body?.productId ?? c.req.query('productId') ?? '').trim()
  if (!productId) {
    return c.json({ error: 'productId is required' }, 400)
  }

  const apiKey = c.env.FREESTUFF_API_KEY
  if (!apiKey) {
    return c.json({ error: 'FREESTUFF_API_KEY is not configured' }, 500)
  }

  const response = await fetch(`https://api.freestuffbot.xyz/v2/products/${encodeURIComponent(productId)}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  })

  if (response.status === 404) {
    return c.json({ error: 'Product not found' }, 404)
  }

  if (!response.ok) {
    const details = await response.text()
    return new Response(JSON.stringify({ error: 'FreeStuff API fetch failed', details }), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    })
  }

  const product = (await response.json()) as Product

  try {
    await sendProductPost(product)
  } catch (error) {
    return c.json({ error: 'Failed to post product', details: String(error) }, 500)
  }

  return c.json({ success: true, productId })
})

export { env }
export default app
