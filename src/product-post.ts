import type { Product } from 'freestuff'
import { createPostText, postProduct } from './bluesky'

export async function sendProductPost(product: Product) {
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
