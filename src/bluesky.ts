import { BskyAgent } from '@atproto/api'
import { env } from './server'
import type { AppBskyRichtextFacet } from '@atproto/api'
import type { Product } from 'freestuff'
import type { BlobRef } from '@atproto/lexicon'

type BlueskyPost = {
  text: string
  imageUrl?: string
  title?: string
  url?: string
  summary?: string
  store?: string | { code?: string; name?: string }
}

function getStarRating(rating: number): string {
  const fullStars = Math.round(rating / 20)
  const emptyStars = 5 - fullStars
  const filled = '⭐'.repeat(fullStars)
  const empty = '☆'.repeat(emptyStars)
  const displayRating = Math.round(rating * 50) / 10
  return `${filled}${empty} ${displayRating}/5`
}

function extractTags(tags: string[] | undefined): string | null {
  if (!tags || tags.length === 0) return null
  const selectedTags = tags.slice(0, 3)
  return selectedTags.join(' • ')
}

function formatHashtag(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/#/g, '')
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()

  return cleaned ? `#${cleaned}` : null
}

function buildHashtags(product: Product): string[] {
  const tags = new Set<string>()
  const add = (value?: string) => {
    const tag = value && formatHashtag(value)
    if (tag) tags.add(tag)
  }

  product.tags?.forEach(add)
  if (product.kind === 'game') add('FreeGame')
  if (product.type === 'timed') add('FreeWeekend')
  if (product.type === 'mobile') add('MobileGame')
  if (product.type === 'other') add('DLC')
  product.platforms?.slice(0, 2).forEach(platform => add(platform))

  if (tags.size === 0) {
    add('FreeGame')
    add('GameDeal')
  }

  return [...tags]
}

function getLocalizedDescription(
  descriptions: { lang: string; text: string }[] | undefined,
  preferredLang: string
): string | null {
  if (!descriptions || descriptions.length === 0) return null

  let found = descriptions.find(d => d.lang === preferredLang)
  if (!found) {
    found = descriptions.find(d => d.lang === 'en-US')
  }

  return found?.text ?? null
}

function utf8ByteIndex(text: string, charIndex: number): number {
  return new TextEncoder().encode(text.slice(0, charIndex)).length
}

function buildTextFacets(text: string): AppBskyRichtextFacet.Main[] | undefined {
  const facets: AppBskyRichtextFacet.Main[] = []

  const urlRegex = /\bhttps?:\/\/[\w\-./?&=%#~+]+/gi
  let match: RegExpExecArray | null

  while ((match = urlRegex.exec(text))) {
    const fullMatch = match[0]
    const byteStart = utf8ByteIndex(text, match.index)
    const byteEnd = byteStart + new TextEncoder().encode(fullMatch).length

    facets.push({
      $type: 'app.bsky.richtext.facet',
      index: {
        byteStart,
        byteEnd,
      },
      features: [
        {
          $type: 'app.bsky.richtext.facet#link',
          uri: fullMatch,
        },
      ],
    })
  }

  const hashtagRegex = /#([a-zA-Z0-9]+)/g

  while ((match = hashtagRegex.exec(text))) {
    const fullMatch = match[0]
    const tag = match[1].toLowerCase()
    const byteStart = utf8ByteIndex(text, match.index)
    const byteEnd = byteStart + new TextEncoder().encode(fullMatch).length

    facets.push({
      $type: 'app.bsky.richtext.facet',
      index: {
        byteStart,
        byteEnd,
      },
      features: [
        {
          $type: 'app.bsky.richtext.facet#tag',
          tag,
        },
      ],
    })
  }

  if (!facets.length) return undefined
  facets.sort((a, b) => a.index.byteStart - b.index.byteStart)
  return facets
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

function formatPrice(product: Product) {
  const price = product.prices.find(p => p.currency === 'usd')
    || product.prices.find(p => p.currency === 'eur')
    || product.prices.find(p => !p.converted)
    || product.prices[0]

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: price.currency,
  }).format(price.oldValue / 100)
}

function getStoreDisplayName(store?: string | { code?: string; name?: string } | null): string {
  if (!store) {
    return ''
  }

  if (typeof store === 'object') {
    if (store.name) {
      return store.name
    }
    if (store.code) {
      store = store.code
    } else {
      return ''
    }
  }

  const storeMap: Record<string, string> = {
    steam: 'Steam',
    epic: 'Epic Games',
    humble: 'Humble Bundle',
    gog: 'GOG.com',
    origin: 'Origin',
    ubi: 'Ubisoft Store',
    gplay: 'Google Play',
    fab: 'Fab',
  }

  return storeMap[store.toLowerCase()] || store
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

  // Get store name from product
  const storeName = getStoreDisplayName(product?.store)
  const storeSuffix = storeName ? ` on ${storeName}` : ''

  // Build status string with store name
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
  // const tagText = extractTags(product.tags)
  // if (tagText) {
  //   details.push(tagText)
  // }

  // if (product.platforms.length === 1) {
  //   details.push(product.platforms[0][0].toUpperCase() + product.platforms[0].slice(1))
  // }

  const resolvedUrl = (productUrl ?? product.urls[0]?.url) || `https://google.com/search?q=${encodeURIComponent(product.title)}`
  const platformText = product.platforms.length
    ? product.platforms.map(p => p[0].toUpperCase() + p.slice(1)).join(', ')
    : null
  const hashtags = buildHashtags(product)

  const lines: Array<string | null> = [
    `🆓 ${product.title}`,
    statusLine,
    details.length ? details.join(' • ') : null,
    resolvedUrl,
    '',
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

  let embed: Record<string, unknown> | undefined

  const storeNameForEmbed = getStoreDisplayName((post as any).store)

  if (post.url) {
    if (post.imageUrl) {
      const imageBlob = await uploadImageBlob(agent, post.imageUrl)
      embed = {
        $type: 'app.bsky.embed.external',
        external: {
          uri: post.url,
          title: `${post.title ?? 'Free game deal'}${storeNameForEmbed ? ` on ${storeNameForEmbed}` : ''}`,
          description: post.summary ?? text.slice(0, 240),
          thumb: imageBlob,
        },
      }
    } else {
      embed = {
        $type: 'app.bsky.embed.external',
        external: {
          uri: post.url,
          title: `${post.title ?? 'Free game deal'}${storeNameForEmbed ? ` on ${storeNameForEmbed}` : ''}`,
          description: post.summary ?? text.slice(0, 240),
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

  await agent.post({
    text,
    facets,
    embed,
    langs: ['en-US'],
  })
}
