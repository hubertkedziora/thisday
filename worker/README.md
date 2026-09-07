# thisday-api

Cloudflare Worker backing the "Tego dnia" site. For a given day/month it:

1. Fetches the Polish Wikipedia calendar-day article (e.g. "7 września") and parses its
   events / births / deaths sections.
2. Sends the list to Claude, asking it to pick the single most interesting item — old,
   human, curious, non-political where possible — and write a short story about it.
3. Looks up an illustration for whatever article Claude picked, via Wikimedia Commons.
4. Caches the whole result in KV under the `MM-DD` key, so a given date is only ever
   generated once (all later visits are served from cache — no repeat API cost).

## One-time setup

You'll need [Node.js](https://nodejs.org/) installed locally, and a terminal.

```bash
cd worker
npm install
npx wrangler login          # opens a browser to connect your Cloudflare account
```

Create the KV namespace used for caching:

```bash
npx wrangler kv namespace create STORY_CACHE
```

This prints an `id`. Paste it into `wrangler.toml`, replacing
`REPLACE_WITH_KV_NAMESPACE_ID`.

Set your Anthropic API key as a secret (this prompts for the value — it is never
written to any file or shown on screen):

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

## Deploy

```bash
npx wrangler deploy
```

This prints the Worker's URL, something like:

```
https://thisday-api.<your-subdomain>.workers.dev
```

Copy that URL into `../index.html`, replacing the placeholder in the line:

```js
var WORKER_BASE_URL = "https://thisday-api.YOUR-SUBDOMAIN.workers.dev";
```

Commit and push `index.html` so GitHub Pages picks it up.

## Local development

```bash
npx wrangler dev
```

Runs the Worker on `http://localhost:8787`. Note that `wrangler.toml` restricts CORS to
`ALLOWED_ORIGIN` (the production GitHub Pages URL) — to test locally against a local
`index.html`, temporarily add your local origin there too, or open the site's DevTools
console and check for a CORS error to confirm what's being blocked.

## Cost

With caching, the model is called at most once per calendar date (366 times, ever) —
after that every request for that date is served from KV for free. Forcing a fresh
generation for testing: append `&refresh=1` to the `/api/story` request.
