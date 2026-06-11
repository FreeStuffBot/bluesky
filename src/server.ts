import { Hono } from 'hono'
import { createHonoHandler } from 'freestuff/hono'

interface Env {
  BSKY_IDENTIFIER: string
  BSKY_PASSWORD: string
  BSKY_SERVICE_URL?: string
  FREESTUFF_PUBLIC_KEY: string
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

  return next()
})

// @ts-ignore
app.post('/event', ...createHonoHandler<Env>(c => c.env?.FREESTUFF_PUBLIC_KEY))

export { env }
export default app
