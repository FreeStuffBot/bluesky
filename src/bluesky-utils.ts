import type { Product } from 'freestuff'
import type { AppBskyRichtextFacet } from '@atproto/api'

export function getStarRating(rating: number): string {
  const fullStars = Math.round(rating / 20)
  const emptyStars = 5 - fullStars
  const filled = '⭐'.repeat(fullStars)
  const empty = '☆'.repeat(emptyStars)
  const displayRating = Math.round(rating * 50) / 10
  return `${filled}${empty} ${displayRating}/5`
}

export function formatHashtag(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/#/g, '')
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()

  return cleaned ? `#${cleaned}` : null
}

export function buildHashtags(product: Product): string[] {
  const tags = new Set<string>()
  const add = (value?: string) => {
    const tag = value && formatHashtag(value)
    if (tag) tags.add(tag)
  }

  product.tags?.forEach(add)
  if (product.type === 'keep') add('FreeGame')
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

export function getLocalizedDescription(
  descriptions: { lang: string; text: string }[] | undefined,
  preferredLang: string
): string | null {
  if (!descriptions || descriptions.length === 0) return null
  return (
    descriptions.find(d => d.lang === preferredLang) ??
    descriptions.find(d => d.lang === 'en-US')
  )?.text ?? null
}

export function utf8ByteIndex(text: string, charIndex: number): number {
  return new TextEncoder().encode(text.slice(0, charIndex)).length
}

function matchByteRange(text: string, match: RegExpExecArray): { byteStart: number; byteEnd: number } {
  const encoder = new TextEncoder()
  const byteStart = encoder.encode(text.slice(0, match.index)).length
  const byteEnd = byteStart + encoder.encode(match[0]).length
  return { byteStart, byteEnd }
}

export function buildTextFacets(text: string): AppBskyRichtextFacet.Main[] | undefined {
  const facets: AppBskyRichtextFacet.Main[] = []

  const urlRegex = /\bhttps?:\/\/[\w\-./?&=%#~+]+/gi
  let match: RegExpExecArray | null

  while ((match = urlRegex.exec(text))) {
    const { byteStart, byteEnd } = matchByteRange(text, match)
    facets.push({
      $type: 'app.bsky.richtext.facet',
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }],
    })
  }

  const hashtagRegex = /#([a-zA-Z0-9]+)/g

  while ((match = hashtagRegex.exec(text))) {
    const { byteStart, byteEnd } = matchByteRange(text, match)
    facets.push({
      $type: 'app.bsky.richtext.facet',
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: match[1].toLowerCase() }],
    })
  }

  if (!facets.length) return undefined
  facets.sort((a, b) => a.index.byteStart - b.index.byteStart)
  return facets
}

export function getStoreDisplayName(store?: string | { code?: string; name?: string } | null): string {
  if (!store) return ''

  if (typeof store === 'object') {
    if (store.name) return store.name
    if (store.code) {
      store = store.code
    } else {
      return ''
    }
  }

  const storeMap: Record<string, string> = {
    steam: 'Steam',
    epic: 'Epic Games Store',
    humble: 'Humble Bundle',
    gog: 'GOG.com',
    origin: 'Origin',
    ubi: 'Ubisoft Store',
    gplay: 'Google Play',
    fab: 'Fab',
  }

  return storeMap[store.toLowerCase()] || store
}
