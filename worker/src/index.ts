import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export interface Env {
  ANTHROPIC_API_KEY: string;
  APP_PASSCODE: string;
  ALLOWED_ORIGINS: string;
  MODEL: string;
  EFFORT: string;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_B64 = 6 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
type MediaType = 'image/jpeg' | 'image/png' | 'image/webp';
type Effort = 'low' | 'medium' | 'high';

const NUTRIENT_KEYS = ['energy', 'protein', 'carbs', 'fat', 'fiber', 'calcium', 'iron', 'folate', 'vitC', 'vitA', 'dha', 'iodine', 'vitD', 'caffeine'] as const;
const UNITS: Record<(typeof NUTRIENT_KEYS)[number], string> = {
  energy: 'kcal', protein: 'g', carbs: 'g', fat: 'g', fiber: 'g', calcium: 'mg', iron: 'mg', folate: 'µg DFE',
  vitC: 'mg', vitA: 'µg RE', dha: 'mg omega-3', iodine: 'µg', vitD: 'µg', caffeine: 'mg',
};

const FoodItem = z.object({
  name: z.string().describe('Short name of the food or drink, in the requested language'),
  grams: z.number().describe('Estimated portion weight in grams (or mL for drinks), rounded to the nearest 5'),
  energy: z.number().describe('kcal for this portion'),
  protein: z.number().describe('g'),
  carbs: z.number().describe('g carbohydrate'),
  fat: z.number().describe('g'),
  fiber: z.number().describe('g dietary fibre'),
  calcium: z.number().describe('mg'),
  iron: z.number().describe('mg'),
  folate: z.number().describe('µg dietary folate equivalents'),
  vitC: z.number().describe('mg vitamin C'),
  vitA: z.number().describe('µg retinol equivalents'),
  dha: z.number().describe('mg total long-chain omega-3 (DHA + EPA + DPA), as in the Australian Food Composition Database'),
  iodine: z.number().describe('µg'),
  vitD: z.number().describe('µg vitamin D'),
  caffeine: z.number().describe('mg caffeine'),
  confidence: z.enum(['low', 'medium', 'high']).describe('How sure you are about the identification and portion'),
});

const Analysis = z.object({
  is_food: z.boolean().describe('false if the photo contains no food or drink'),
  summary: z.string().describe('One short phrase naming the meal, in the requested language'),
  items: z.array(FoodItem).describe('One entry per distinct food or drink; empty if is_food is false'),
  warnings: z
    .array(z.string())
    .describe('0-3 short pregnancy food-safety notes about THIS meal only, in the requested language, following Australian (NSW Health / FSANZ) advice. Empty when nothing applies.'),
});

const Label = z.object({
  name: z.string().describe('Product name as printed, in the requested language if the label is bilingual, else as printed'),
  dose: z.string().describe('The daily dose the amounts below are for, e.g. "1 tablet daily" or "2 capsules daily"'),
  energy: z.number().describe('kcal per daily dose, usually 0 for supplements'),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  fiber: z.number(),
  calcium: z.number().describe('mg elemental calcium per daily dose'),
  iron: z.number().describe('mg elemental iron per daily dose'),
  folate: z.number().describe('µg folic acid or folate per daily dose (the equivalent amount when an equiv. is printed; no DFE conversion)'),
  vitC: z.number().describe('mg per daily dose'),
  vitA: z.number().describe('µg retinol equivalents per daily dose: retinol or retinyl ester as retinol µg (retinol IU ÷ 3.33); beta-carotene µg ÷ 6; 0 if not listed'),
  dha: z.number().describe('mg DHA + EPA per daily dose'),
  iodine: z.number().describe('µg per daily dose'),
  vitD: z.number().describe('µg per daily dose (IU ÷ 40)'),
  caffeine: z.number(),
  readable: z.boolean().describe('false if the photo does not show a readable supplement or nutrition label'),
  notes: z.string().describe('One short sentence in the requested language about anything uncertain, or empty'),
});

const ItemResult = z.object({
  item: FoodItem,
  warning: z.string().describe('One short pregnancy food-safety note about this food following the rules, in the requested language, or an empty string'),
});

const Recommendations = z.object({
  recommendations: z
    .array(
      z.object({
        name: z.string().describe('A specific food, fruit, snack or simple dish, in the requested language'),
        reason: z.string().describe('One short reason in the requested language, at most 20 Chinese characters or 12 English words'),
      }),
    )
    .describe('Exactly three suggestions'),
});

const SAFETY = `Pregnancy food-safety notes (warnings): based on NSW Health and Food Standards Australia New Zealand advice, add a short note only when the meal visibly contains: raw or undercooked meat, poultry, eggs or seafood (sushi, sashimi, oysters, runny eggs) or foods made with raw egg (homemade mayonnaise, aioli, tiramisu, mousse); cold ready-to-eat meats and poultry, including deli meats, cold cooked chicken and Chinese cold cuts (白切鸡, 卤味); pâté; smoked ready-to-eat seafood (smoked salmon) or cold cooked prawns, unless heated until steaming hot; pre-packaged or buffet salads, pre-cut fruit or rockmelon; raw sprouts (alfalfa, bean sprouts); soft-serve; unpasteurised milk or juice; soft, unpasteurised or mould-ripened cheese (brie, camembert, feta, blue, ricotta) unless cooked; high-mercury fish (shark/flake, swordfish, marlin, broadbill, orange roughy/sea perch, catfish); brown seaweed such as kelp or kombu (海带) in more than a small amount; liver or liver products; alcohol; energy drinks; or a single drink likely over about 200 mg caffeine. Each note names the food and the safer choice in one calm sentence; do not add general advice, and do not warn about ordinary cooked meals.`;

const ANALYZE_SYSTEM = `You estimate nutrition from a single food photo for a pregnancy food diary used in New South Wales, Australia.

Identify each distinct food or drink. For each one, estimate the portion weight in grams (mL for drinks) from visual cues (dinner plate ≈ 26 cm, rice bowl ≈ 11 cm across, chopsticks ≈ 23 cm, spoon, cup ≈ 250 mL, hand), then estimate energy and nutrients for that portion using typical values from the Australian Food Composition Database, including cooking oil and sauces. Name a dish as one item unless its parts are clearly separate. If the photo shows a packaged food's Nutrition Information panel, use the per-serve values from the panel for the serve shown or stated (Australian panels give energy in kJ; divide by 4.184 for kcal). If you are given a text description instead of a photo, estimate typical home portions for the described foods (一碗米饭 ≈ 180 g cooked, 一碗面 ≈ 300 g, 一杯 ≈ 250 mL, 一片面包 ≈ 35 g, a palm-sized meat portion ≈ 100 g) and mark confidence "low" unless the text gives amounts. Be realistic rather than optimistic. Round grams to the nearest 5; give nutrients as plain numbers (0 when the food has none, e.g. caffeine in rice). Use confidence "low" when the identification or portion is a guess. If the user adds a note, trust it over the image. If there is no food or drink, set is_food to false and return empty items and warnings.

${SAFETY}`;

const LABEL_SYSTEM = `You read the label of a dietary supplement or packaged food for a pregnancy food diary used in Australia. From the Active Ingredients or Nutrition Information panel, report the amounts per DAILY dose as directed on the label (if it says 2 capsules daily, double the per-capsule amounts; if no directions, use one unit). When an ingredient is printed as a compound with an 'equiv.' or 'equivalent to' amount, vitamins and minerals alike (e.g. "iron (as ferrous fumarate) 60 mg" means iron 60 mg; "calcium carbonate 500 mg equiv. calcium 200 mg" means calcium 200 mg; "levomefolate glucosamine 451 µg equiv. levomefolic acid 250 µg" means folate 250 µg), report only the equivalent amount and never add the compound weight to it. Check what quantity the panel is for (each tablet, each 2 gummies, per serve) and scale from that quantity to the daily dose. Convert units: vitamin D IU ÷ 40 = µg; retinol IU ÷ 3.33 = µg RE; beta-carotene µg ÷ 6 = µg RE; folic acid and folate in µg as printed (no DFE conversion); omega-3 as DHA + EPA in mg; iodine in µg; energy on Australian panels is in kJ, divide by 4.184 for kcal. Use 0 for anything not listed. If the image is not a readable label, set readable to false.`;

const RECOMMEND_SYSTEM = `You are a friendly pregnancy nutrition helper for someone living in New South Wales, Australia. Given her average intake on recently logged days (when available) and today's intake so far against the daily targets, her pregnancy week, how she feels today and what she has eaten, name exactly three specific foods, fruits, snacks or simple dishes that would help most today, each with one short reason. Choose foods common in Australian supermarkets and safe in pregnancy (cooked foods, pasteurised dairy, low-mercury fish such as salmon, sardines or tinned tuna in moderation, legumes, wholegrains, fruit and vegetables). Never suggest foods NSW Health or FSANZ advise pregnant women to avoid or limit: raw or undercooked meat, eggs or seafood; smoked or cold seafood; cold deli meats or cold cooked chicken; pâté; liver or liver products; pre-cut or buffet salads; raw sprouts; soft-serve; soft, unpasteurised or mould-ripened cheese unless cooked; high-mercury fish; brown seaweed such as kelp, kombu or 海带 (very high iodine); alcohol. For iodine prefer milk, yoghurt, cheese, eggs or bread made with iodised salt; for iron prefer lean red meat, legumes or fortified cereal with a vitamin C food. Keep caffeine under the limit. If she feels nauseous or unwell, prefer plain, small, easy foods (dry crackers, toast, plain rice, bananas, yoghurt, cold fruit, ginger tea) and say so gently. If told she manages gestational diabetes, keep each suggestion within the stated carbohydrate amount, prefer low-GI choices and spread carbohydrate across the day. Never mention supplements, medical conditions or weight by name, and never tell her to change a supplement or medication. Vary the suggestions from the previous ones when told. If her note mentions being unable to keep food or fluids down, bleeding, severe pain, a bad headache, blurred vision or fewer baby movements, make the first reason a gentle line to contact her midwife or GP today. Warm and plain, no lists inside the text.`;

const ITEM_SYSTEM = `You estimate nutrition for ONE food or drink named by the user, for a pregnancy food diary used in Australia. Use typical values from the Australian Food Composition Database for how the dish is normally prepared, including cooking oil and sauces. Return the item with the same name (tidied) and the stated weight (grams, or mL for drinks); if no weight is stated, use the weight of the amount named in the text (e.g. "两个鸡蛋" ≈ 100 g), else one typical serving. Nutrients as plain numbers (0 where none). Use confidence "low" when the name is vague.

${SAFETY} For this single food, put that note in "warning", or an empty string when nothing applies.`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const cors = corsHeaders(origin, env);

    if (origin && !cors) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors ?? {} });
    if (url.pathname === '/health') return json({ ok: true }, 200, cors);
    if (request.method !== 'POST' || !['/analyze', '/recommend', '/label', '/item'].includes(url.pathname)) return new Response('Not found', { status: 404 });

    if (!env.ANTHROPIC_API_KEY || !env.APP_PASSCODE) return json({ error: 'misconfigured' }, 500, cors);
    if (!safeEqual(request.headers.get('x-app-passcode') ?? '', env.APP_PASSCODE)) return json({ error: 'unauthorized' }, 401, cors);

    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413, cors);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'bad_json' }, 400, cors);
    }
    const lang = body.lang === 'en' ? 'en' : 'zh';
    const language = lang === 'zh' ? 'Simplified Chinese' : 'English';
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
    const model = env.MODEL || 'claude-sonnet-5-5';

    try {
      if (url.pathname === '/analyze') {
        const image = typeof body.image === 'string' ? body.image : '';
        const mediaType = typeof body.mediaType === 'string' && MEDIA_TYPES.has(body.mediaType) ? (body.mediaType as MediaType) : null;
        const text = typeof body.text === 'string' ? body.text.trim().slice(0, 300) : '';
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
        const trimester = body.trimester === 1 || body.trimester === 2 || body.trimester === 3 ? body.trimester : null;
        if (!text && (!image || !mediaType)) return json({ error: 'bad_request' }, 400, cors);
        if (image.length > MAX_IMAGE_B64) return json({ error: 'too_large' }, 413, cors);

        const userText = [
          `Write names, the summary and any warnings in ${language}.`,
          trimester ? `The user is in trimester ${trimester}.` : '',
          text ? `The user describes the meal in text (no photo): ${text}` : '',
          note ? `User note: ${note}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        const res = await withRegionRetry(() => client.messages.create({
          model,
          max_tokens: 8000,
          system: ANALYZE_SYSTEM,
          output_config: { effort: effortOf(env.EFFORT), format: zodOutputFormat(Analysis) },
          messages: [
            {
              role: 'user',
              content: image && mediaType
                ? [
                    { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
                    { type: 'text', text: userText },
                  ]
                : userText,
            },
          ],
        }));
        return finish(res, Analysis, cors, (data) => {
          // v1 clients read `calories`; keep it as an alias of `energy` so an older app build keeps working.
          const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]).map((it) => ({ ...it, calories: it.energy })) : [];
          return { result: { ...data, items } };
        });
      }

      if (url.pathname === '/label') {
        const image = typeof body.image === 'string' ? body.image : '';
        const mediaType = typeof body.mediaType === 'string' && MEDIA_TYPES.has(body.mediaType) ? (body.mediaType as MediaType) : null;
        if (!image || !mediaType) return json({ error: 'bad_request' }, 400, cors);
        if (image.length > MAX_IMAGE_B64) return json({ error: 'too_large' }, 413, cors);
        const res = await withRegionRetry(() => client.messages.create({
          model,
          max_tokens: 6000,
          system: LABEL_SYSTEM,
          output_config: { effort: effortOf(env.EFFORT), format: zodOutputFormat(Label) },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
                { type: 'text', text: `Write the name, dose and notes in ${language}.` },
              ],
            },
          ],
        }));
        return finish(res, Label, cors, (data) => ({ label: data }));
      }

      if (url.pathname === '/item') {
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
        const grams = typeof body.grams === 'number' && Number.isFinite(body.grams) && body.grams > 0 ? Math.round(body.grams) : null;
        if (!name) return json({ error: 'bad_request' }, 400, cors);
        const res = await withRegionRetry(() => client.messages.create({
          model,
          max_tokens: 3000,
          system: ITEM_SYSTEM,
          output_config: { effort: 'low', format: zodOutputFormat(ItemResult) },
          messages: [{ role: 'user', content: `Food: ${name}\nWeight: ${grams ? `${grams} g` : 'the amount named, or one typical serving if none is named'}\nWrite the name and warning in ${language}.` }],
        }));
        return finish(res, ItemResult, cors, (data) => data);
      }

      // /recommend
      const totals = isRecord(body.totals) ? body.totals : {};
      const avg7 = isRecord(body.avg7) ? body.avg7 : null;
      const avgDays = typeof body.avgDays === 'number' ? Math.max(0, Math.round(body.avgDays)) : 0;
      const targets = isRecord(body.targets) ? body.targets : {};
      const meals = Array.isArray(body.meals) ? body.meals.filter((m): m is string => typeof m === 'string').slice(0, 10).map((m) => m.slice(0, 80)) : [];
      const previous = Array.isArray(body.previous) ? body.previous.filter((m): m is string => typeof m === 'string').slice(0, 6).map((m) => m.slice(0, 60)) : [];
      const week = typeof body.week === 'number' ? Math.round(body.week) : null;
      const hour = typeof body.hour === 'number' ? Math.round(body.hour) : 12;
      const mood = typeof body.mood === 'number' && body.mood >= 1 && body.mood <= 5 ? Math.round(body.mood) : null;
      const moodText = typeof body.moodText === 'string' ? body.moodText.trim().slice(0, 200) : '';
      const gdm = isRecord(body.gdm) && typeof body.gdm.mainCarbs === 'number' && body.gdm.mainCarbs > 0 && typeof body.gdm.snackCarbs === 'number' && body.gdm.snackCarbs > 0 ? body.gdm : null;
      const lines = NUTRIENT_KEYS.filter((k) => typeof targets[k] === 'number').map(
        (k) => `${k}: ${avg7 && avgDays > 0 ? `average of ${avgDays} logged day(s) before today ${fmtNum(avg7[k])}, ` : ''}today so far ${fmtNum(totals[k])}, daily target ${fmtNum(targets[k])} ${UNITS[k]}`,
      );
      const moodWords = ['', 'feels quite unwell', 'not feeling great', 'feels so-so', 'feels fairly good', 'feels great'];
      const userText = [
        `Answer in ${language}.`,
        week !== null ? `Pregnancy week ${week}.` : '',
        `Local time: about ${hour}:00.`,
        mood ? `Today she ${moodWords[mood]}${moodText ? ` ("${moodText}")` : ''}.` : moodText ? `Her note today: "${moodText}".` : '',
        `Eaten today: ${meals.length ? meals.join('; ') : 'nothing yet'}.`,
        gdm ? `She manages gestational diabetes: about ${fmtNum(gdm.mainCarbs)} g carbohydrate per main meal and ${fmtNum(gdm.snackCarbs)} g per snack.` : '',
        previous.length ? `Previous suggestions to vary from: ${previous.join('; ')}.` : '',
        `Intake versus daily targets (caffeine is a limit, not a goal):`,
        ...lines,
      ]
        .filter(Boolean)
        .join('\n');

      const res = await withRegionRetry(() => client.messages.create({
        model,
        max_tokens: 2500,
        system: RECOMMEND_SYSTEM,
        output_config: { effort: 'low', format: zodOutputFormat(Recommendations) },
        messages: [{ role: 'user', content: userText }],
      }));
      return finish(res, Recommendations, cors, (data) => ({ recommendations: data.recommendations }));
    } catch (e) {
      // Log status and message only: never the request body, image or headers.
      console.error('anthropic_error', e instanceof Anthropic.APIError ? e.status : '', e instanceof Error ? e.message : String(e));
      if (e instanceof Anthropic.RateLimitError) return json({ error: 'rate_limited' }, 429, cors);
      if (e instanceof Anthropic.AuthenticationError) return json({ error: 'misconfigured' }, 500, cors);
      if (e instanceof Anthropic.APIError) return json({ error: 'upstream', status: e.status, detail: String(e.message ?? '').slice(0, 300) }, 502, cors);
      return json({ error: 'upstream' }, 502, cors);
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * Anthropic refuses requests whose source address geolocates to an unsupported region with
 * 403 "Request not allowed". A Worker's outbound address varies per connection, so retry a few times.
 */
async function withRegionRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const blocked = e instanceof Anthropic.APIError && e.status === 403 && /not allowed/i.test(String(e.message ?? ''));
      if (!blocked) throw e;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  throw last;
}

/** Turn a structured-output response into the JSON the app expects, reporting refusals and truncation with their own status. */
function finish(res: Anthropic.Message, schema: z.ZodTypeAny, cors: Record<string, string> | null, wrap: (data: Record<string, unknown>) => Record<string, unknown>): Response {
  if (res.stop_reason === 'refusal') return json({ error: 'refused' }, 422, cors);
  if (res.stop_reason !== 'end_turn') {
    console.error('anthropic_incomplete', res.stop_reason);
    return json({ error: 'incomplete', stop_reason: res.stop_reason }, 502, cors);
  }
  const text = res.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let parsed: ReturnType<typeof schema.safeParse> | null = null;
  try {
    parsed = schema.safeParse(JSON.parse(text));
  } catch {
    parsed = null;
  }
  if (!parsed || !parsed.success) {
    console.error('anthropic_unparseable', text.length);
    return json({ error: 'unparseable' }, 502, cors);
  }
  const payload = wrap(parsed.data as Record<string, unknown>);
  payload.model = res.model;
  payload.usage = { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };
  return json(payload, 200, cors);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function fmtNum(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return String(Math.round(n * 10) / 10);
}

function effortOf(v: string | undefined): Effort {
  return v === 'low' || v === 'high' ? v : 'medium';
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> | null {
  if (!origin) return null;
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-app-passcode',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(data: unknown, status: number, cors: Record<string, string> | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(cors ?? {}) },
  });
}

/** Constant-time string comparison (both inputs are short). */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
