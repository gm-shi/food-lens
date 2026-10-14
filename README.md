# 食记 · Food Lens

A small, calm diet diary for a few people. Snap a photo of your food, get an estimate of calories, protein, carbs and fat, adjust the grams, save. Everything is stored on the phone; nothing is logged anywhere else.

- **App**: Vite + React PWA, hosted on GitHub Pages. Data lives in the phone's IndexedDB with JSON export/import.
- **Worker**: a tiny Cloudflare Worker that holds the Anthropic API key and forwards one photo per request to Claude. Access is gated by a shared passcode.

## One-time setup

1. **Anthropic key** — create one at console.anthropic.com and set a monthly spend limit.
2. **Secrets file** — put the key and a passcode of your choice in `worker/.dev.vars` (gitignored). Use plain ASCII letters and digits for the passcode; it travels in an HTTP header.
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   APP_PASSCODE=your-passcode
   ```
3. **Cloudflare** — in `worker/`: `npx wrangler login`, then `npm run deploy` and `npm run secrets` (uploads both lines as encrypted secrets). Note the printed `*.workers.dev` URL.
4. **Worker URL** — paste that URL into `.env.production` as `VITE_WORKER_URL=...` and make sure `ALLOWED_ORIGINS` in `worker/wrangler.toml` contains your GitHub Pages origin.
5. **GitHub Pages** — create the public repo, open Settings → Pages and set Source to "GitHub Actions", then push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes on every push (or run it from the Actions tab).

Share the site URL and the passcode with your users. On the phone, open the site in Safari or Chrome and use "Add to Home Screen"; on iPhone this also keeps the data safe from Safari's periodic cleanup.

## Development

```bash
npm install && (cd worker && npm install)
(cd worker && npm run dev)   # Worker on http://localhost:8787, reads worker/.dev.vars
npm run dev                  # App on http://localhost:5173
```

`npm run build` type-checks and builds the app. `cd worker && npm run typecheck` checks the Worker.

## Costs

Roughly 2,000 input and 400 output tokens per photo. With Claude Sonnet 5.5 that is well under $0.01 per photo. The model and effort are set in `worker/wrangler.toml`.
