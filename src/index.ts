import { on, Product } from 'freestuff'
import { createPostText, postProduct } from './bluesky'

type HonoEvent = {
  $hono: {
    executionCtx: ExecutionContext
  }
}

async function sendProductPost(product: Product) {
  const productUrl = product.urls[0]?.url || `https://google.com/search?q=${encodeURIComponent(product.title)}`
  const descriptionText = product.description?.find(d => d.lang === 'en-US')?.text
    || product.description?.[0]?.text
    || 'Free game deal'

  await postProduct({
    text: createPostText(product, productUrl),
    title: product.title,
    url: productUrl,
    summary: descriptionText,
    imageUrl: product.images?.[0]?.url,
  })
}

async function sendToAll(products: Product[]) {
  for (const product of products) {
    await sendProductPost(product)
  }
}

on('fsb:event:ping', (event) => {
  console.log('Received ping event:', event)
})

on('fsb:event:announcement_created', (event) => {
  const ctx = (event as typeof event & HonoEvent).$hono.executionCtx
  ctx.waitUntil(sendToAll(event.data.resolvedProducts))
})

export { default } from './server'
