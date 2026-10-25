# 食记 · Food Lens

A small, calm pregnancy food diary for a few people in New South Wales, Australia. Pick a photo of your meal, or describe it in a sentence, and get an estimate of energy and 13 nutrients. If something was recognised wrongly, tap the name to correct it (nutrients are re-estimated for the new name), add a missing item, adjust the amount (grams, or millilitres for drinks), and edit a saved meal later. A meal can be logged to an earlier day and time, so yesterday's forgotten dinner can still be added. The home screen shows today's intake against Australian pregnancy targets, a daily "how I feel" note, your supplements (set up by photographing the label), any food-safety notes for what you ate, and three ideas for the meal coming up (breakfast, lunch, a snack or dinner, by the time of day) picked from your week's gaps and how you feel. History has a weekly summary (intake against targets, weight, mood, and a short written round-up with focus points for the next week) and a month calendar to jump to any day; any day there has a + to add a meal to it. A weight tab tracks gain against the recommended range. An optional gestational-diabetes mode shows carbohydrate per meal against the limits your dietitian gives you. Everything is stored on the phone; nothing is logged anywhere else. Chinese and English.

**Not medical advice.** Targets are the population reference values for pregnancy; a doctor or midwife may set different ones, and every target is editable in Settings. Micronutrients estimated from photos are rough; the weekly trend is what matters.

- **App**: Vite + React PWA, hosted on GitHub Pages. Data lives in the phone's IndexedDB with JSON export/import.
- **Worker**: a tiny Cloudflare Worker that holds the LLM API key and forwards one request at a time to the configured provider (DeepSeek by default; Claude or OpenAI with one config change or per request, see "Provider" below). Access is gated by a shared passcode.

## One-time setup

1. **API key** — create one for the provider you will use (console.anthropic.com, platform.openai.com or platform.deepseek.com) and set a monthly spend limit where the console offers one.
2. **Secrets file** — put the key and a passcode of your choice in `worker/.dev.vars` (gitignored). Use plain ASCII letters and digits for the passcode; it travels in an HTTP header. Only the key of the provider named by `PROVIDER` is needed; the other lines can be left out.
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...
   DEEPSEEK_API_KEY=sk-...
   APP_PASSCODE=your-passcode
   ```
3. **Cloudflare** — in `worker/`: `npx wrangler login`, then `npm run deploy` and `npm run secrets` (uploads every line of `.dev.vars` as an encrypted secret). Note the printed `*.workers.dev` URL.
4. **Worker URL** — paste that URL into `.env.production` as `VITE_WORKER_URL=...` and make sure `ALLOWED_ORIGINS` in `worker/wrangler.toml` contains your GitHub Pages origin.
5. **GitHub Pages** — create the public repo, open Settings → Pages and set Source to "GitHub Actions", then push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes on every push (or run it from the Actions tab).

Share the site URL and the passcode with your users. On the phone, open the site in Safari or Chrome and use "Add to Home Screen"; on iPhone this also keeps the data safe from Safari's periodic cleanup.

## Development

```bash
npm install && (cd worker && npm install)
(cd worker && npm run dev)   # Worker on http://localhost:8787, reads worker/.dev.vars
npm run dev                  # App on http://localhost:5174/food-lens/
```

`npm run build` type-checks and builds the app. `cd worker && npm run typecheck` checks the Worker.

Upgrading: deploy the Worker first (`cd worker && npm run deploy`), then push to `main`. The Worker keeps a `calories` alias in its response so an older app build keeps working during the switch.

## Provider

The Worker's default LLM provider is `PROVIDER` in `worker/wrangler.toml` (`[vars]`), and a request may name one of the three itself (`provider` in the JSON body; this is what an in-app model switch sends). Every route answers in the same shape whichever is active. A named provider whose key has not been uploaded answers `misconfigured` rather than quietly using another one.

| `PROVIDER` | Model var (default) | Secret | How the schema-shaped answer is produced |
|---|---|---|---|
| `anthropic` | `MODEL` (`claude-sonnet-5-5`) | `ANTHROPIC_API_KEY` | Structured outputs (`output_config.format`), with the region retry that `[placement]` is there for |
| `openai` | `OPENAI_MODEL` (`gpt-6.1-sol`) | `OPENAI_API_KEY` | Responses API with a strict JSON schema (`text.format`); `store: false`, so nothing is kept on OpenAI's side |
| `deepseek` | `DEEPSEEK_MODEL` (`deepseek-flash`) | `DEEPSEEK_API_KEY` | Anthropic-compatible endpoint; the schema is offered as the only tool and the forced tool call is validated (one retry) |

`EFFORT` (`low`, `medium`, `high`) applies to photo, text and label analysis on all three (DeepSeek has no medium tier and treats `medium` as `high`); the other routes always use `low`. To switch: put the key in `worker/.dev.vars`, run `npm run secrets`, change `PROVIDER` (and the model var if you like), then `npm run deploy`. Switching back is the same one-line change. Locally, `npx wrangler dev --var PROVIDER:openai` tries a provider without editing the file. DeepSeek processes the photos and text it receives on servers in mainland China, so choose it with that in mind.

## Reference values

Targets come from the Australian sources below and live in `src/lib/nrv.ts`; the Worker's food-safety notes follow NSW Health and FSANZ pregnancy advice.

- NHMRC Nutrient Reference Values for Australia and New Zealand, pregnancy 19-50 y (eatforhealth.gov.au/nutrient-reference-values/nutrients/…): protein 60 g (46 g in trimester 1), fibre 28 g, calcium 1000 mg, iron 27 mg, folate 600 µg DFE, vitamin C 60 mg, vitamin A 800 µg RE, iodine 220 µg, vitamin D 5 µg, long-chain omega-3 115 mg; energy from Schofield BMR on pre-pregnancy weight × physical activity level, plus 1.4 MJ/day in trimester 2 and 1.9 MJ/day in trimester 3.
- Australian Pregnancy Care Guidelines (weight and BMI chapter, after IOM 2009) and NSW Health: gestational weight gain by pre-pregnancy BMI, 0.5-2 kg in the first trimester.
- NSW Health and Eat for Health "Healthy eating during your pregnancy": caffeine 200 mg/day or less, food-group advice.
- Food Standards Australia New Zealand (foodstandards.gov.au/consumer/safety/listeria and the mercury-in-fish advice) and the NSW Health listeriosis fact sheet: the foods behind the safety notes.

All values were checked against those pages on 2026-10-14.

## Worker routes

- `POST /analyze` — a photo (`image`, `mediaType`) or a text description (`text`), plus `lang`, `note`, `trimester` → items with 14 nutrients, a summary and pregnancy safety notes.
- `POST /label` — a photo of a supplement or food label → per-daily-dose amounts, name and dose.
- `POST /item` — one food name and a weight → that item's nutrients (used when correcting or adding an item).
- `POST /recommend` — the meal slot (`breakfast`, `lunch`, `snack`, `dinner`; derived from `hour` when absent), 7-day averages, today's totals, targets, meals, mood and gestational-diabetes limits → three ideas for that meal with reasons. Fetched once per slot per phone and cached.
- `POST /weekly` — one Monday-to-Sunday week: averages over the logged days against targets, the previous week's averages, weight at the start and end, mood, safety notes → a headline, a two-to-three-sentence summary and two or three focus points. Written once per finished week per phone (on request for the current week) and cached.

All routes need the `x-app-passcode` header and an allowed `Origin`. An optional `provider` field in the body (`anthropic`, `openai` or `deepseek`) overrides the Worker's default `PROVIDER` for that request.

## Costs

Token counts (input / output) measured on the Worker's routes on 2026-10-25; output includes the model's reasoning where the provider counts it. The photo was a 640 px test image: the app's 1,024 px photos add roughly 750 input tokens on OpenAI, and DeepSeek caps an image at 1,024 tokens. Prices are from developers.openai.com/api/docs/pricing and api-docs.deepseek.com/quick_start/pricing on the same day.

| `PROVIDER` / model | Price per 1M tokens (in / out) | Photo (`/analyze`) | Text (`/analyze`) | Item, meal ideas, weekly summary, label |
|---|---|---|---|---|
| `anthropic` / Claude Sonnet 5.5 | see platform.claude.com | about 2,800 / 800, around $0.01 | similar | about 1,100 / 130, 1,500 / 230 and 1,600 / 300; a few cents a day |
| `openai` / `gpt-6.1-sol` | $2 / $10 | 1,676 / 477 measured, about 2,400 / 500 at 1,024 px: around $0.01 | 1,222 / 736, around $0.01 | 900–1,250 / 100–230 each, around $0.003–0.005 |
| `openai` / `gpt-6-luna` (set `OPENAI_MODEL`) | $0.10 / $0.50 | not measured; at the same token counts around $0.0005 | | |
| `deepseek` / `deepseek-flash` | $0.15 / $0.60 off-peak, double at peak | 1,882 / 1,296 (thinking included), around $0.001 off-peak | 1,400 (mostly cache hits) / 840, around $0.0006 | 1,300–1,500 / 300–600 each, around $0.0005 |

DeepSeek bills the repeated system prompt as a cache hit ($0.003 per 1M), and its peak hours are 01:00–04:00 and 06:00–10:00 UTC on weekdays (lunch and dinner time in Sydney); weekends, Chinese public holidays and all other hours are off-peak. `EFFORT` and the models are set in `worker/wrangler.toml`.
