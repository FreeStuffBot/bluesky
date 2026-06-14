# FreeStuff Bluesky Bot

A Cloudflare Worker bot that listens for FreeStuff announcement events and posts matching product alerts to a Bluesky account.

## Requirements

- Bun installed on your system
- Cloudflare account configured for `wrangler`
- A Bluesky account and app credentials
- FreeStuff webhook events configured to send POST requests to this worker's `/event` endpoint

## Setup

1. Clone the repository

2. Install dependencies with Bun:

```bash
bun install
```

> If you do not use Bun, `npm install` also works, but Bun is the preferred workflow in this project.

## Configuration

Set the following environment variables for the worker:

- `BSKY_IDENTIFIER` - Bluesky login identifier or email
- `BSKY_PASSWORD` - Bluesky login password or app-specific password
- `BSKY_SERVICE_URL` - optional Bluesky service URL (defaults to `https://bsky.social`)
- `FREESTUFF_PUBLIC_KEY` - FreeStuff event public key
- `FREESTUFF_API_KEY` - FreeStuff REST API key, used for manual `/product` fetches and API calls

You can use `.env.example` as a starter template for local development.

```bash
cp .env.example .env
```

Then edit `.env` with your real values.

## Local development

Run the worker locally with Wrangler:

```bash
bun run dev
```

If you prefer to run Wrangler directly through Bun:

```bash
bunx wrangler dev
```

## Deployment

Deploy the worker to Cloudflare:

```bash
bun run deploy
```

or:

```bash
bunx wrangler deploy --minify
```

## Worker behavior

- The worker exposes `POST /event`
- Incoming FreeStuff events are verified using `FREESTUFF_PUBLIC_KEY`
- When `fsb:event:announcement_created` is received, the bot posts product details to Bluesky
- The worker also exposes `POST /product` for manual posting of a single product ID
- Manual `/product` requests are authenticated with `Authorization: Bearer <FREESTUFF_API_KEY>`
- Posts may include hashtags and clickable links using BlueSky rich text facets

## Notes

- `BSKY_SERVICE_URL` defaults to `https://bsky.social` if not configured
- The worker is implemented with `hono` and `freestuff/hono`
- The Cloudflare config is defined in `wrangler.jsonc`
