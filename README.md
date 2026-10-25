# 食记 · Food Lens

A small, calm pregnancy food diary for a few people in New South Wales, Australia. Pick a photo of your meal, or describe it in a sentence, and get an estimate of energy and 13 nutrients. If something was recognised wrongly, tap the name to correct it (nutrients are re-estimated for the new name), add a missing item, adjust the amount (grams, or millilitres for drinks), and edit a saved meal later. A meal can be logged to an earlier day and time, so yesterday's forgotten dinner can still be added. The home screen shows today's intake against Australian pregnancy targets, a daily "how I feel" note, your supplements (set up by photographing the label), any food-safety notes for what you ate, and three ideas for the meal coming up (breakfast, lunch, a snack or dinner, by the time of day) picked from your week's gaps and how you feel. History has a weekly summary (intake against targets, weight, mood, and a short written round-up with focus points for the next week) and a month calendar to jump to any day; any day there has a + to add a meal to it. A weight tab tracks gain against the recommended range. An optional gestational-diabetes mode shows carbohydrate per meal against the limits your dietitian gives you. Everything is stored on the phone; nothing is logged anywhere else. Chinese and English.

**Not medical advice.** Targets are the population reference values for pregnancy; a doctor or midwife may set different ones, and every target is editable in Settings. Micronutrients estimated from photos are rough; the weekly trend is what matters.

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
npm run dev                  # App on http://localhost:5174/food-lens/
```

`npm run build` type-checks and builds the app. `cd worker && npm run typecheck` checks the Worker.

Upgrading: deploy the Worker first (`cd worker && npm run deploy`), then push to `main`. The Worker keeps a `calories` alias in its response so an older app build keeps working during the switch.

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

All routes need the `x-app-passcode` header and an allowed `Origin`.

## Costs

Roughly 2,800 input and 800 output tokens per photo (14 nutrients per item), about 1,100 / 130 for an item correction, about 1,500 / 230 for each set of meal ideas (up to four a day), and about 1,600 / 300 for a weekly summary. With Claude Sonnet 5.5 that is around $0.01 per photo and a few cents a day for the rest. The model and effort are set in `worker/wrangler.toml`.
