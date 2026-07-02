import { BskyAgent } from '@atproto/api'
import { env } from './server'
import type { AppBskyEmbedExternal, AppBskyEmbedImages, AppBskyRichtextFacet } from '@atproto/api'
import type { Product } from 'freestuff'
import type { BlobRef } from '@atproto/lexicon'
import { buildHashtags, buildTextFacets, getStoreDisplayName } from './bluesky-utils'
import { notifyDiscordWebhook } from './discord'

// HTMLRewriter is a Cloudflare Workers built-in (not in @types/node)
declare class HTMLRewriter {
  on(selector: string, handlers: { element?(el: { getAttribute(name: string): string | null }): void }): this
  transform(response: Response): Response
}

type BlueskyPost = {
  text: string
  imageUrl?: string
  title?: string
  url?: string
  summary?: string
  store?: string | { code?: string; name?: string }
}

async function createAgent() {
  if (!env) {
    throw new Error('Environment variables are not loaded')
  }

  const service = env.BSKY_SERVICE_URL ?? 'https://bsky.social'
  const agent = new BskyAgent({ service })

  await agent.login({
    identifier: env.BSKY_IDENTIFIER,
    password: env.BSKY_PASSWORD,
  })

  return agent
}

function buildEmbedDescription(text: string, summary?: string) {
  return summary?.trim() || text.slice(0, 240)
}

export function createPostText(product: Product, productUrl?: string) {
  const untilString = product.until
    ? (() => {
        const untilDate = new Date(product.until)
        const datePart = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(untilDate)

        // 24-hour time without seconds
        const timePart = new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(untilDate)

        // Workers run in UTC — append UTC label
        const tzLabel = 'UTC'

        return ` until ${datePart} ${timePart} ${tzLabel}`
      })()
    : ''

  const storeName = getStoreDisplayName(product?.store)
  const storeSuffix = storeName ? ` on ${storeName}` : ''

  let status = 'FREE'
  if (product.type === 'timed') {
    status = 'Free Weekend'
  } else if (product.type === 'other') {
    status += ' DLC / Addon'
  } else if (product.type === 'mobile') {
    status += ' Mobile Game'
  } else if (product.type === 'assets') {
    status += ' Game Dev Assets'
  }

  const statusLine = `${status}${storeSuffix}${untilString}`

  const resolvedUrl = (productUrl ?? product.urls[0]?.url) || `https://google.com/search?q=${encodeURIComponent(product.title)}`

  const hashtags = buildHashtags(product)

  const lines: Array<string | null> = [
    `🆓 ${product.title}`,
    statusLine,
    `🔗 ${resolvedUrl}`,
    `${product.notice ? `ℹ️ ${product.notice}\n` : ''}`.trim() || null,
    '\n',
    hashtags.length ? hashtags.join(' ') : null,
  ]

  return lines.filter(Boolean).join('\n')
}

const MAX_EXTERNAL_EMBED_THUMB_SIZE = 1_000_000

async function fetchImageBlob(imageUrl: string): Promise<Blob> {
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch image from ${imageUrl}: ${response.status} ${response.statusText}`)
  }

  return await response.blob()
}

type OgCard = {
  title: string
  description: string
  imageUrl?: string
}

async function fetchOgCard(url: string): Promise<OgCard> {
  const og: { title?: string; description?: string; image?: string } = {}

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot)' },
    })
  } catch {
    console.warn(`Failed to reach ${url} for OG card, skipping`)
    return { title: '', description: '' }
  }

  if (!response.ok) {
    return { title: '', description: '' }
  }

  await new HTMLRewriter()
    .on('meta', {
      element(el: { getAttribute(name: string): string | null }) {
        const property = el.getAttribute('property')
        const name = el.getAttribute('name')
        const content = el.getAttribute('content')
        if (!content) return
        if (property === 'og:title') og.title = content
        else if (property === 'og:description') og.description = content
        else if (property === 'og:image') og.image = content
        else if (name === 'description' && !og.description) og.description = content
      },
    })
    .transform(response)
    .arrayBuffer()

  let imageUrl = og.image
  if (imageUrl && !imageUrl.includes('://')) {
    const base = new URL(url)
    imageUrl = `${base.protocol}//${base.host}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`
  }

  return {
    title: og.title ?? '',
    description: og.description ?? '',
    imageUrl,
  }
}

async function fetchResizedImageBlob(imageUrl: string, maxSize: number): Promise<Blob | null> {
  const attempts = [
    { w: 1200, q: 85 },
    { w: 900, q: 80 },
    { w: 700, q: 75 },
    { w: 500, q: 65 },
    { w: 350, q: 55 },
  ]

  for (const { w, q } of attempts) {
    const resizeUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}&w=${w}&output=webp&q=${q}`
    let response: Response
    try {
      response = await fetch(resizeUrl)
    } catch {
      // weserv.nl is unreachable — bail out immediately rather than retrying
      console.warn('images.weserv.nl is unreachable, skipping resize')
      return null
    }
    if (!response.ok) continue
    const blob = await response.blob()
    if (blob.size <= maxSize) return blob
  }

  return null
}

async function uploadBlob(agent: BskyAgent, blob: Blob): Promise<BlobRef> {
  const uploadResponse = await agent.uploadBlob(blob, {
    headers: {
      'content-type': blob.type || 'application/octet-stream',
    },
  })

  return uploadResponse.data.blob
}

/**
 * Tries each image source in priority order, returning the first blob that fits
 * under the Bluesky thumb size limit. Returns null if nothing works.
 *
 * Priority: product image → resize product image → OG image → resize OG image
 */
async function resolveThumbBlob(imageUrl: string, pageUrl: string): Promise<Blob | null> {
  try {
    const productImage = await fetchImageBlob(imageUrl)
    console.log(`Product image: ${productImage.size} bytes`)
    if (productImage.size <= MAX_EXTERNAL_EMBED_THUMB_SIZE) return productImage

    console.log(`Product image too large, attempting resize via weserv.nl`)
    const resizedProduct = await fetchResizedImageBlob(imageUrl, MAX_EXTERNAL_EMBED_THUMB_SIZE)
    if (resizedProduct) return resizedProduct
  } catch {
    console.warn(`Failed to fetch product image: ${imageUrl}`)
  }

  const og = await fetchOgCard(pageUrl)
  console.log(`Falling back to OG image: ${og.imageUrl ?? 'none'}`)
  if (!og.imageUrl) return null

  try {
    const ogImage = await fetchImageBlob(og.imageUrl)
    console.log(`OG image: ${ogImage.size} bytes`)
    if (ogImage.size <= MAX_EXTERNAL_EMBED_THUMB_SIZE) return ogImage

    console.log(`OG image too large, attempting resize via weserv.nl`)
    return await fetchResizedImageBlob(og.imageUrl, MAX_EXTERNAL_EMBED_THUMB_SIZE)
  } catch {
    console.warn(`Failed to fetch OG image: ${og.imageUrl}`)
    return null
  }
}

type BlueskyEmbed =
  | (AppBskyEmbedExternal.Main & { $type: 'app.bsky.embed.external' })
  | (AppBskyEmbedImages.Main & { $type: 'app.bsky.embed.images' })

export async function postProduct(post: BlueskyPost) {
  const text = String(post.text ?? '').trim()
  if (!text) {
    throw new Error('Bluesky post text is missing or empty')
  }

  const agent = await createAgent()
  const did = agent.session?.did
  if (!did) {
    throw new Error('Unable to resolve authenticated DID')
  }

  let embed: BlueskyEmbed | undefined
  const storeNameForEmbed = getStoreDisplayName(post.store)

  if (post.url) {
    const description = buildEmbedDescription(text, post.summary)
    const embedTitle = `${post.title ?? 'Free game deal'}${storeNameForEmbed ? ` on ${storeNameForEmbed}` : ''}`

    if (post.imageUrl) {
      const thumbBlob = await resolveThumbBlob(post.imageUrl, post.url)
      if (thumbBlob) {
        const thumb = await uploadBlob(agent, thumbBlob)
        embed = {
          $type: 'app.bsky.embed.external',
          external: { uri: post.url, title: embedTitle, description, thumb },
        }
      } else {
        console.warn(`No thumbnail resolved for "${post.title ?? 'unknown'}", posting without embed`)
      }
    } else {
      // No product image — external embed without thumb
      embed = {
        $type: 'app.bsky.embed.external',
        external: { uri: post.url, title: embedTitle, description },
      }
    }
  } else if (post.imageUrl) {
    const blob = await fetchImageBlob(post.imageUrl)
    const imageBlob = await uploadBlob(agent, blob)
    embed = {
      $type: 'app.bsky.embed.images',
      images: [
        {
          $type: 'app.bsky.embed.images#image',
          image: imageBlob,
          alt: post.title ?? 'Free game image',
        },
      ],
    }
  }

  const facets = buildTextFacets(text)

  try {
    await agent.post({
      text,
      facets,
      embed,
      langs: ['en-US'],
    })
    console.log(`Successfully posted: "${post.title ?? 'unknown'}"`)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const details = [`Product: ${post.title ?? 'unknown'}`, `Error: ${errorMessage}`].join('\n')
    console.error(`Post failed for "${post.title ?? 'unknown'}": ${errorMessage}`)
    await notifyDiscordWebhook('Bluesky post failed', details)
    throw error
  }
}
