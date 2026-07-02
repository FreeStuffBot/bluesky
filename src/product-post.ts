import type { Product } from 'freestuff'
import { createPostText, postProduct } from './bluesky'
import { env } from './server'
import { notifyDiscordWebhook } from './discord'

function getAllowedTypes(): string[] | null {
  const raw = env?.BSKY_ALLOWED_TYPES?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as string[]
    return null
  } catch {
    console.warn('Failed to parse BSKY_ALLOWED_TYPES JSON:', raw)
    return null
  }
}

export async function sendProductPost(product: Product) {
  const allowedTypes = getAllowedTypes()
  if (allowedTypes && !allowedTypes.includes(product.type as string)) {
    const msg = `⏭️ Skipped product **${product.title}** (type: \`${product.type}\`) — not in \`BSKY_ALLOWED_TYPES\` (${allowedTypes.map(t => `\`${t}\``).join(', ')})`
    console.log(msg)
    await notifyDiscordWebhook(msg)
    return
  }

  console.log(`Processing product: "${product.title}" (id: ${product.id})`)
  const productUrl = product.urls[0]?.url || `https://google.com/search?q=${encodeURIComponent(product.title)}`
  const descriptionText = product.description?.find((d) => d.lang === 'en-US')?.text
    || product.description?.[0]?.text
    || 'Free game deal'

  await postProduct({
    text: createPostText(product, productUrl),
    title: product.title,
    url: productUrl,
    summary: descriptionText,
    imageUrl: product.images?.[0]?.url,
    store: (product as any).store,
  })
}

export async function sendToAll(products: Product[]) {
  for (const product of products) {
    await sendProductPost(product)
  }
}
