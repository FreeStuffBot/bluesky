import { BskyAgent } from '@atproto/api'
import { env } from './server'
import type { AppBskyEmbedExternal, AppBskyEmbedImages, AppBskyRichtextFacet } from '@atproto/api'
import type { Product } from 'freestuff'
import type { BlobRef } from '@atproto/lexicon'
import { buildHashtags, buildTextFacets, getStoreDisplayName } from './bluesky-utils'
import { notifyDiscordWebhook } from './discord'

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
  const summaryText = summary?.trim() || text.slice(0, 240)
  const lines: Array<string | null> = [summaryText]
  return lines.filter(Boolean).join('\n')
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

  const details: string[] = []

  const resolvedUrl = (productUrl ?? product.urls[0]?.url) || `https://google.com/search?q=${encodeURIComponent(product.title)}`

  const hashtags = buildHashtags(product)

  const lines: Array<string | null> = [
    `🆓 ${product.title}`,
    statusLine,
    details.length ? details.join(' • ') : null,
    `🔗 ${resolvedUrl}`,
    '\n',
    hashtags.length ? hashtags.join(' ') : null,
  ]

  return lines.filter(Boolean).join('\n')
}

async function uploadImageBlob(agent: BskyAgent, imageUrl: string): Promise<BlobRef> {
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch image from ${imageUrl}: ${response.status} ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
  const blob = await response.blob()

  const uploadResponse = await agent.uploadBlob(blob, {
    headers: {
      'content-type': contentType,
    },
  })

  return uploadResponse.data.blob
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

    if (post.imageUrl) {
      const imageBlob = await uploadImageBlob(agent, post.imageUrl)
      embed = {
        $type: 'app.bsky.embed.external',
        external: {
          uri: post.url,
          title: `${post.title ?? 'Free game deal'}${storeNameForEmbed ? ` on ${storeNameForEmbed}` : ''}`,
          description,
          thumb: imageBlob,
        },
      }
    } else {
      embed = {
        $type: 'app.bsky.embed.external',
        external: {
          uri: post.url,
          title: `${post.title ?? 'Free game deal'}${storeNameForEmbed ? ` on ${storeNameForEmbed}` : ''}`,
          description,
        },
      }
    }
  } else if (post.imageUrl) {
    const imageBlob = await uploadImageBlob(agent, post.imageUrl)
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const details = [`Product: ${post.title ?? 'unknown'}`, `Error: ${errorMessage}`].join('\n')

    await notifyDiscordWebhook('Bluesky post failed', details)
    throw error
  }
}
