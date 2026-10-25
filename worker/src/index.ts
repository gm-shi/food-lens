import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

export interface Env {
  /** Which LLM answers: "anthropic" (default), "openai" or "deepseek"; set in wrangler.toml [vars]. */
  PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  APP_PASSCODE: string;
  ALLOWED_ORIGINS: string;
  /** Anthropic model; the other providers have their own model vars. */
  MODEL: string;
  OPENAI_MODEL?: string;
  DEEPSEEK_MODEL?: string;
  EFFORT: string;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_B64 = 6 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
type MediaType = 'image/jpeg' | 'image/png' | 'image/webp';
type Effort = 'low' | 'medium' | 'high';
type Slot = 'breakfast' | 'lunch' | 'snack' | 'dinner';
const SLOTS = new Set<string>(['breakfast', 'lunch', 'snack', 'dinner']);

const NUTRIENT_KEYS = ['energy', 'protein', 'carbs', 'fat', 'fiber', 'calcium', 'iron', 'folate', 'vitC', 'vitA', 'dha', 'iodine', 'vitD', 'caffeine'] as const;
const UNITS: Record<(typeof NUTRIENT_KEYS)[number], string> = {
  energy: 'kcal', protein: 'g', carbs: 'g', fat: 'g', fiber: 'g', calcium: 'mg', iron: 'mg', folate: 'µg DFE',
  vitC: 'mg', vitA: 'µg RE', dha: 'mg omega-3', iodine: 'µg', vitD: 'µg', caffeine: 'mg',
};

const FoodItem = z.object({
  name: z.string().describe('Short name of the food or drink, in the requested language'),
  grams: z.number().describe('Estimated portion amount in the unit given below (grams, or mL for liquids), rounded to the nearest 5'),
  unit: z.enum(['g', 'ml']).describe('"ml" for drinks and liquid foods (water, milk, juice, coffee, tea, soup, smoothies, drinking yoghurt); "g" for everything else'),
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
        name: z.string().describe('A specific dish, simple combination, fruit or snack for the meal asked about, in the requested language'),
        reason: z.string().describe('One short reason in the requested language, at most 20 Chinese characters or 12 English words'),
      }),
    )
    .describe('Exactly three suggestions'),
});

const Weekly = z.object({
  headline: z.string().describe('One warm short sentence that sums up the week, in the requested language, at most 20 Chinese characters or 12 English words'),
  summary: z
    .string()
    .describe('Two or three plain sentences in the requested language: what went well, which one or two nutrients fell short, and how it compares with the previous week when one is given'),
  focus: z.array(z.string()).describe('Two or three focus points for next week, each one sentence naming a concrete food or habit, in the requested language'),
});

const SAFETY = `Pregnancy food-safety notes (warnings): based on NSW Health and Food Standards Australia New Zealand advice, add a short note only when the meal visibly contains: raw or undercooked meat, poultry, eggs or seafood (sushi, sashimi, oysters, runny eggs) or foods made with raw egg (homemade mayonnaise, aioli, tiramisu, mousse); cold ready-to-eat meats and poultry, including deli meats, cold cooked chicken and Chinese cold cuts (白切鸡, 卤味); pâté; smoked ready-to-eat seafood (smoked salmon) or cold cooked prawns, unless heated until steaming hot; pre-packaged or buffet salads, pre-cut fruit or rockmelon; raw sprouts (alfalfa, bean sprouts); soft-serve; unpasteurised milk or juice; soft, unpasteurised or mould-ripened cheese (brie, camembert, feta, blue, ricotta) unless cooked; high-mercury fish (shark/flake, swordfish, marlin, broadbill, orange roughy/sea perch, catfish); brown seaweed such as kelp or kombu (海带) in more than a small amount; liver or liver products; alcohol; energy drinks; or a single drink likely over about 200 mg caffeine. Each note names the food and the safer choice in one calm sentence; do not add general advice, and do not warn about ordinary cooked meals.`;

/** Foods to suggest and foods never to suggest, shared by the recommendation and weekly-summary prompts. */
const SAFE_CHOICES = `Choose foods common in Australian supermarkets and safe in pregnancy (cooked foods, pasteurised dairy, low-mercury fish such as salmon, sardines or tinned tuna in moderation, legumes, wholegrains, fruit and vegetables). Never suggest foods NSW Health or FSANZ advise pregnant women to avoid or limit: raw or undercooked meat, eggs or seafood; foods made with raw egg (homemade mayonnaise, aioli, tiramisu, mousse); unpasteurised milk or juice; smoked or cold seafood; cold deli meats or cold cooked chicken; pâté; liver or liver products; pre-cut or buffet salads; raw sprouts; soft-serve; soft, unpasteurised or mould-ripened cheese unless cooked; high-mercury fish; brown seaweed such as kelp, kombu or 海带 (very high iodine); alcohol. For iodine prefer milk, yoghurt, cheese, eggs or bread made with iodised salt; for iron prefer lean red meat, legumes or fortified cereal with a vitamin C food. Keep caffeine under the limit.`;

const ANALYZE_SYSTEM = `You estimate nutrition from a single food photo for a pregnancy food diary used in New South Wales, Australia.

Identify each distinct food or drink. For each one, estimate the portion from visual cues (dinner plate ≈ 26 cm, rice bowl ≈ 11 cm across, chopsticks ≈ 23 cm, spoon, cup ≈ 250 mL, hand): in grams for solid food, in mL for drinks and liquid foods such as milk, juice, coffee, tea, soup or smoothies (set unit to "ml" for those, "g" otherwise). Then estimate energy and nutrients for that portion using typical values from the Australian Food Composition Database, including cooking oil and sauces. Name a dish as one item unless its parts are clearly separate. If the photo shows a packaged food's Nutrition Information panel, use the per-serve values from the panel for the serve shown or stated (Australian panels give energy in kJ; divide by 4.184 for kcal). If you are given a text description instead of a photo, estimate typical home portions for the described foods (一碗米饭 ≈ 180 g cooked, 一碗面 ≈ 300 g, 一杯 ≈ 250 mL, 一片面包 ≈ 35 g, a palm-sized meat portion ≈ 100 g) and mark confidence "low" unless the text gives amounts. Be realistic rather than optimistic. Round amounts to the nearest 5; give nutrients as plain numbers (0 when the food has none, e.g. caffeine in rice). Use confidence "low" when the identification or portion is a guess. If the user adds a note, trust it over the image. If there is no food or drink, set is_food to false and return empty items and warnings.

${SAFETY}`;

const LABEL_SYSTEM = `You read the label of a dietary supplement or packaged food for a pregnancy food diary used in Australia. From the Active Ingredients or Nutrition Information panel, report the amounts per DAILY dose as directed on the label (if it says 2 capsules daily, double the per-capsule amounts; if no directions, use one unit). When an ingredient is printed as a compound with an 'equiv.' or 'equivalent to' amount, vitamins and minerals alike (e.g. "iron (as ferrous fumarate) 60 mg" means iron 60 mg; "calcium carbonate 500 mg equiv. calcium 200 mg" means calcium 200 mg; "levomefolate glucosamine 451 µg equiv. levomefolic acid 250 µg" means folate 250 µg), report only the equivalent amount and never add the compound weight to it. Check what quantity the panel is for (each tablet, each 2 gummies, per serve) and scale from that quantity to the daily dose. Convert units: vitamin D IU ÷ 40 = µg; retinol IU ÷ 3.33 = µg RE; beta-carotene µg ÷ 6 = µg RE; folic acid and folate in µg as printed (no DFE conversion); omega-3 as DHA + EPA in mg; iodine in µg; energy on Australian panels is in kJ, divide by 4.184 for kcal. Use 0 for anything not listed. If the image is not a readable label, set readable to false.`;

const RECOMMEND_SYSTEM = `You are a friendly pregnancy nutrition helper for someone living in New South Wales, Australia. You are told which meal is coming up (breakfast, lunch, a snack or dinner), her average intake on recently logged days (when available) and today's intake so far against the daily targets, her pregnancy week, how she feels today and what she has eaten. Name exactly three specific options for that meal: dishes, simple combinations, fruit or snacks she could realistically eat at that time, each with one short reason tied to what she still needs today. If no meal is named, suggest foods that would help most for the rest of today instead. Breakfast ideas should be quick to make; a late-evening snack should be light. The meals listed with their times are what she has logged so far today; if that meal is already among them, suggest what would round it out, or a small snack to carry her to the next meal. Today's totals cover only the meals she has logged so far (she may log others later), so suggest a normal portion for this meal and never try to make up the whole day's shortfall in one meal or say she has not eaten. ${SAFE_CHOICES} If she feels nauseous or unwell, prefer plain, small, easy foods (dry crackers, toast, plain rice, bananas, yoghurt, cold fruit, ginger tea) and say so gently. If told she manages gestational diabetes, keep each suggestion within the carbohydrate amount for that kind of meal (the main-meal amount for breakfast, lunch and dinner; the snack amount for a snack), prefer low-GI choices and spread carbohydrate across the day. Never mention supplements, medical conditions or weight by name, and never tell her to change a supplement or medication. Vary the suggestions from the previous ones when told. If her note mentions being unable to keep food or fluids down, bleeding, severe pain, a bad headache, blurred vision or fewer baby movements, make the first reason a gentle line to contact her midwife or GP today. Warm and plain, no lists inside the text.`;

const WEEKLY_SYSTEM = `You write a short weekly summary for a pregnancy food diary used in New South Wales, Australia. You are given the average daily intake over the days she logged this week against her daily targets, the previous week's averages when there is one, her pregnancy week, her weight at the start and end of the week when logged, how she felt, and any food-safety notes that came up. Write a headline (one warm short sentence), a summary of two or three plain sentences that says what went well and which one or two nutrients fell short, comparing with the previous week when one is given, and two or three focus points for the coming week, each a concrete food or habit she could try. ${SAFE_CHOICES} The averages come from photo estimates on logged days only, so treat them as rough, never scold, and if fewer than four of the days so far were logged say gently that logging more days gives a clearer picture. Caffeine is a daily limit to stay under, not a goal: judge it by the highest day, not the average. Weight, when given, may be mentioned in one neutral phrase (steady, up 0.3 kg, down 0.4 kg) and nothing more; never call it too much or too little, never suggest losing weight, dieting or cutting calories, and if it changed a lot say only that it is worth mentioning to her midwife. If she felt unwell, acknowledge that first and keep the focus points gentle. If any of her notes mentions being unable to keep food or fluids down, bleeding, severe pain, a bad headache, blurred vision or fewer baby movements, begin the summary with a gentle line to contact her midwife or GP if she has not already, and do not treat that symptom as a food issue. If told she manages gestational diabetes, keep the focus points consistent with spreading carbohydrate across the day and low-GI choices. Never mention supplements, medical conditions by name, or tell her to change a supplement or medication. Warm and plain, no lists inside the text.`;

const ITEM_SYSTEM = `You estimate nutrition for ONE food or drink named by the user, for a pregnancy food diary used in Australia. Use typical values from the Australian Food Composition Database for how the dish is normally prepared, including cooking oil and sauces. Return the item with the same name (tidied) and the stated amount in the stated unit (grams, or mL for drinks and liquid foods; set unit accordingly); if no amount is stated, use the amount named in the text (e.g. "两个鸡蛋" ≈ 100 g, "一杯牛奶" ≈ 250 ml), else one typical serving. Nutrients as plain numbers (0 where none). Use confidence "low" when the name is vague.

${SAFETY} For this single food, put that note in "warning", or an empty string when nothing applies.`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const cors = corsHeaders(origin, env);

    if (origin && !cors) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors ?? {} });
    if (url.pathname === '/health') return json({ ok: true }, 200, cors);
    if (request.method !== 'POST' || !['/analyze', '/recommend', '/label', '/item', '/weekly'].includes(url.pathname)) return new Response('Not found', { status: 404 });

    const defaultProvider = providerOf(env);
    if (!defaultProvider) console.error('bad_provider', env.PROVIDER);
    if (!defaultProvider || !apiKeyFor(env, defaultProvider) || !env.APP_PASSCODE) return json({ error: 'misconfigured' }, 500, cors);
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
    // The app may name the provider for one request (its model switch); without it the Worker's PROVIDER applies.
    // A named provider whose key is not set is an error, never a silent fallback: the user chose it knowingly.
    const provider = body.provider === undefined ? defaultProvider : typeof body.provider === 'string' && PROVIDERS.has(body.provider) ? (body.provider as Provider) : null;
    if (!provider) return json({ error: 'bad_request' }, 400, cors);
    if (!apiKeyFor(env, provider)) {
      console.error('no_key', provider);
      return json({ error: 'misconfigured' }, 500, cors);
    }

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

        const res = await complete(env, provider, {
          system: ANALYZE_SYSTEM,
          text: userText,
          image: image && mediaType ? { data: image, mediaType } : null,
          schema: Analysis,
          effort: effortOf(env.EFFORT),
          maxTokens: 8000,
        });
        return finish(res, cors, (data) => {
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
        const res = await complete(env, provider, {
          system: LABEL_SYSTEM,
          text: `Write the name, dose and notes in ${language}.`,
          image: { data: image, mediaType },
          schema: Label,
          effort: effortOf(env.EFFORT),
          maxTokens: 6000,
        });
        return finish(res, cors, (data) => ({ label: data }));
      }

      if (url.pathname === '/item') {
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
        const grams = typeof body.grams === 'number' && Number.isFinite(body.grams) && body.grams > 0 ? Math.round(body.grams) : null;
        const unit = body.unit === 'ml' ? 'ml' : 'g';
        if (!name) return json({ error: 'bad_request' }, 400, cors);
        const res = await complete(env, provider, {
          system: ITEM_SYSTEM,
          text: `Food: ${name}\nAmount: ${grams ? `${grams} ${unit}` : 'the amount named, or one typical serving if none is named'}\nWrite the name and warning in ${language}.`,
          schema: ItemResult,
          effort: 'low',
          maxTokens: 3000,
        });
        return finish(res, cors, (data) => data);
      }

      if (url.pathname === '/weekly') {
        const range = isRecord(body.range) ? body.range : {};
        const start = typeof range.start === 'string' ? range.start.slice(0, 10) : '';
        const end = typeof range.end === 'string' ? range.end.slice(0, 10) : '';
        const weekComplete = body.complete === true;
        const daysElapsed = weekComplete ? 7 : clampInt(body.daysElapsed, 1, 7);
        const loggedDays = clampInt(body.loggedDays, 0, 7);
        const mealsCount = clampInt(body.mealsCount, 0, 200);
        const avg = isRecord(body.avg) ? body.avg : {};
        const caffeineMax = typeof body.caffeineMax === 'number' && Number.isFinite(body.caffeineMax) ? Math.max(0, body.caffeineMax) : null;
        const targets = isRecord(body.targets) ? body.targets : {};
        const prev = isRecord(body.prev) && isRecord(body.prev.avg) && clampInt(body.prev.loggedDays, 0, 7) > 0 ? { days: clampInt(body.prev.loggedDays, 0, 7), avg: body.prev.avg } : null;
        const weight = isRecord(body.weight) && typeof body.weight.start === 'number' && typeof body.weight.end === 'number' && Number.isFinite(body.weight.start) && Number.isFinite(body.weight.end) ? { start: body.weight.start, end: body.weight.end } : null;
        const moodAvg = typeof body.moodAvg === 'number' && body.moodAvg >= 1 && body.moodAvg <= 5 ? Math.round(body.moodAvg * 10) / 10 : null;
        const moodLow = clampInt(body.moodLow, 0, 100);
        const moodNotes = strings(body.moodNotes, 5, 80);
        const warnings = strings(body.warnings, 4, 200);
        const week = typeof body.week === 'number' ? Math.round(body.week) : null;
        const gdm = isRecord(body.gdm) && typeof body.gdm.mainCarbs === 'number' && body.gdm.mainCarbs > 0 && typeof body.gdm.snackCarbs === 'number' && body.gdm.snackCarbs > 0 ? body.gdm : null;
        if (loggedDays === 0) return json({ error: 'bad_request' }, 400, cors);
        const lines = NUTRIENT_KEYS.filter((k) => typeof targets[k] === 'number').map((k) =>
          k === 'caffeine'
            ? `caffeine: this week average ${fmtNum(avg[k])}${caffeineMax !== null ? `, highest day ${fmtNum(caffeineMax)}` : ''}, daily limit ${fmtNum(targets[k])} ${UNITS[k]}${prev ? `, last week average ${fmtNum(prev.avg[k])}` : ''}`
            : `${k}: this week ${fmtNum(avg[k])}, daily target ${fmtNum(targets[k])} ${UNITS[k]}${prev ? `, last week ${fmtNum(prev.avg[k])}` : ''}`,
        );
        const userText = [
          `Answer in ${language}.`,
          week !== null ? `Pregnancy week ${week}.` : '',
          weekComplete ? `Week ${start} to ${end}: ${loggedDays} of 7 days logged, ${mealsCount} meals.` : `Week ${start} to ${end}, still in progress: ${loggedDays} of the ${daysElapsed} days so far logged, ${mealsCount} meals.`,
          prev ? `Previous week: ${prev.days} days logged.` : 'No previous week to compare with.',
          weight ? `Weight logged: ${fmtNum(weight.start)} kg at the start of the week, ${fmtNum(weight.end)} kg at the end.` : '',
          moodAvg !== null ? `How she felt: average ${moodAvg} out of 5${moodLow ? `, felt unwell or not great ${moodLow} time(s)` : ''}.` : '',
          moodNotes.length ? `Her notes: ${moodNotes.map((n) => `"${n}"`).join('; ')}.` : '',
          warnings.length ? `Food-safety notes that came up this week: ${warnings.join(' ')}` : '',
          gdm ? `She manages gestational diabetes: about ${fmtNum(gdm.mainCarbs)} g carbohydrate per main meal and ${fmtNum(gdm.snackCarbs)} g per snack.` : '',
          `Average daily intake on logged days versus daily targets (caffeine is a limit, not a goal):`,
          ...lines,
        ]
          .filter(Boolean)
          .join('\n');
        const res = await complete(env, provider, { system: WEEKLY_SYSTEM, text: userText, schema: Weekly, effort: 'low', maxTokens: 2500 });
        return finish(res, cors, (data) => ({ weekly: data }));
      }

      // /recommend
      const totals = isRecord(body.totals) ? body.totals : {};
      const avg7 = isRecord(body.avg7) ? body.avg7 : null;
      const avgDays = typeof body.avgDays === 'number' ? Math.max(0, Math.round(body.avgDays)) : 0;
      const targets = isRecord(body.targets) ? body.targets : {};
      const meals = strings(body.meals, 10, 80);
      const previous = strings(body.previous, 6, 60);
      const week = typeof body.week === 'number' ? Math.round(body.week) : null;
      const hour = typeof body.hour === 'number' && Number.isFinite(body.hour) ? Math.min(23, Math.max(0, Math.round(body.hour))) : 12;
      // Older app builds send no slot and show one answer all day, so they keep whole-day ideas.
      const slot: Slot | null = typeof body.slot === 'string' && SLOTS.has(body.slot) ? (body.slot as Slot) : null;
      const slotWord = slot === 'snack' ? (hour >= 21 || hour < 4 ? 'a light evening snack' : 'an afternoon snack') : slot;
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
        `Local time: about ${hour}:00. ${slot ? `Suggest ${slotWord}.` : 'Suggest foods that would help most for the rest of today, not one particular meal.'}`,
        mood ? `Today she ${moodWords[mood]}${moodText ? ` ("${moodText}")` : ''}.` : moodText ? `Her note today: "${moodText}".` : '',
        `Logged so far today: ${meals.length ? meals.join('; ') : 'nothing yet (she may log meals later; do not assume she has not eaten)'}.`,
        gdm ? `She manages gestational diabetes: about ${fmtNum(gdm.mainCarbs)} g carbohydrate per main meal and ${fmtNum(gdm.snackCarbs)} g per snack.` : '',
        previous.length ? `Previous suggestions to vary from: ${previous.join('; ')}.` : '',
        `Intake versus daily targets (caffeine is a limit, not a goal):`,
        ...lines,
      ]
        .filter(Boolean)
        .join('\n');

      const res = await complete(env, provider, { system: RECOMMEND_SYSTEM, text: userText, schema: Recommendations, effort: 'low', maxTokens: 2500 });
      return finish(res, cors, (data) => ({ recommendations: data.recommendations, slot }));
    } catch (e) {
      return errorResponse(e, cors);
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

// ---------------------------------------------------------------------------------------------------
// Providers. Every route asks for one schema-shaped answer through complete(); PROVIDER decides which
// API gives it, and the handlers above never see the difference.

type Provider = 'anthropic' | 'openai' | 'deepseek';
const PROVIDERS = new Set<string>(['anthropic', 'openai', 'deepseek']);

interface CompleteArgs {
  system: string;
  text: string;
  image?: { data: string; mediaType: MediaType } | null;
  schema: z.ZodTypeAny;
  effort: Effort;
  maxTokens: number;
}

interface Completion {
  data: Record<string, unknown>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

/** An answer the app cannot use, reported to it with its own error code and status (see errorResponse). */
class CompletionError extends Error {
  constructor(
    readonly code: 'refused' | 'incomplete' | 'unparseable' | 'upstream',
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

function providerOf(env: Env): Provider | null {
  const p = env.PROVIDER || 'anthropic';
  return PROVIDERS.has(p) ? (p as Provider) : null;
}

function apiKeyFor(env: Env, provider: Provider): string {
  return (provider === 'openai' ? env.OPENAI_API_KEY : provider === 'deepseek' ? env.DEEPSEEK_API_KEY : env.ANTHROPIC_API_KEY) ?? '';
}

/** One answer shaped by `schema` from `provider`. Throws CompletionError, or the provider SDK's own error. */
function complete(env: Env, provider: Provider, args: CompleteArgs): Promise<Completion> {
  if (provider === 'openai') return completeOpenAI(env, args);
  if (provider === 'deepseek') return completeDeepSeek(env, args);
  return completeAnthropic(env, args);
}

/** Anthropic: structured outputs through output_config.format, behind the region retry. */
async function completeAnthropic(env: Env, a: CompleteArgs): Promise<Completion> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  const res = await withRegionRetry(() =>
    client.messages.create({
      model: env.MODEL || 'claude-sonnet-5-5',
      max_tokens: a.maxTokens,
      system: a.system,
      output_config: { effort: a.effort, format: zodOutputFormat(a.schema) },
      messages: [{ role: 'user', content: anthropicContent(a) }],
    }),
  );
  if (res.stop_reason === 'refusal') throw new CompletionError('refused');
  if (res.stop_reason !== 'end_turn') {
    console.error('anthropic_incomplete', res.stop_reason);
    throw new CompletionError('incomplete', { stop_reason: res.stop_reason });
  }
  const text = res.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    console.error('anthropic_unparseable', text.length);
    throw new CompletionError('unparseable');
  }
  return { data: validated(a.schema, raw, 'anthropic'), model: res.model, usage: usageOf(res.usage) };
}

/**
 * DeepSeek through its Anthropic-compatible endpoint (api-docs.deepseek.com/guides/anthropic_api): the same SDK
 * and request shape, but no output_config.format, so the schema is offered as the only tool and the answer is
 * read back from the forced tool call. No region retry: that block is Anthropic's.
 * Price note: DeepSeek charges double between 01:00–04:00 and 06:00–10:00 UTC on weekdays (lunch and dinner
 * time in Sydney); all other hours, weekends and Chinese public holidays are the cheap rate.
 */
async function completeDeepSeek(env: Env, a: CompleteArgs): Promise<Completion> {
  const client = new Anthropic({ apiKey: env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com/anthropic', maxRetries: 1 });
  const input_schema = toolSchema(a.schema);
  const spent = { input_tokens: 0, output_tokens: 0 };
  // Now and then the model answers in prose or leaves a field out; one more try usually fixes it.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.create({
      model: env.DEEPSEEK_MODEL || 'deepseek-flash',
      max_tokens: a.maxTokens,
      system: a.system,
      output_config: { effort: a.effort },
      tools: [{ name: 'result', description: 'Return the result', input_schema }],
      // deepseek-flash thinks by default and then refuses tool_choice "tool" ("Thinking mode does not support
      // this tool_choice"); "any" with a single tool forces the same call and keeps thinking, so effort applies.
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: anthropicContent(a) }],
    });
    const used = usageOf(res.usage);
    spent.input_tokens += used.input_tokens;
    spent.output_tokens += used.output_tokens;
    if (res.stop_reason === 'refusal') throw new CompletionError('refused');
    // Only a finished answer is worth a second try; max_tokens, or any stop reason DeepSeek adds, is a truncation.
    if (res.stop_reason !== 'tool_use' && res.stop_reason !== 'end_turn') {
      console.error('deepseek_incomplete', res.stop_reason);
      throw new CompletionError('incomplete', { stop_reason: res.stop_reason });
    }
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const parsed = call ? a.schema.safeParse(call.input) : null;
    if (parsed?.success) return { data: parsed.data as Record<string, unknown>, model: res.model, usage: spent };
    console.error('deepseek_unparseable', attempt, call ? 'invalid_input' : `no_tool_use:${res.stop_reason}`);
  }
  throw new CompletionError('unparseable');
}

/** OpenAI Responses API: structured outputs through text.format (strict JSON schema), images as data URLs. */
async function completeOpenAI(env: Env, a: CompleteArgs): Promise<Completion> {
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 1 });
  const content: OpenAI.Responses.ResponseInputContent[] = [{ type: 'input_text', text: a.text }];
  if (a.image) content.push({ type: 'input_image', image_url: `data:${a.image.mediaType};base64,${a.image.data}`, detail: 'auto' });
  let res: OpenAI.Responses.ParsedResponse<unknown>;
  try {
    res = await client.responses.parse({
      model: env.OPENAI_MODEL || 'gpt-6.1-sol',
      instructions: a.system,
      input: [{ role: 'user', content }],
      text: { format: zodTextFormat(a.schema, 'result') },
      reasoning: { effort: a.effort },
      max_output_tokens: a.maxTokens,
      // Nothing is kept on OpenAI's side: the phone is the only store for photos and meals.
      store: false,
    });
  } catch (e) {
    // The SDK checks the answer against the schema while parsing; a mismatch is a bad answer, not an API failure.
    if (e instanceof z.ZodError || e instanceof SyntaxError) {
      console.error('openai_unparseable', e.message.slice(0, 200));
      throw new CompletionError('unparseable');
    }
    throw e;
  }
  if (res.status === 'incomplete') {
    const reason = res.incomplete_details?.reason ?? 'incomplete';
    if (reason === 'content_filter') throw new CompletionError('refused');
    console.error('openai_incomplete', reason);
    throw new CompletionError('incomplete', { stop_reason: reason });
  }
  if (res.status !== 'completed') {
    // 'failed' (or a status added later): a policy code is a refusal, anything else an upstream failure. Codes only.
    const code = String(res.error?.code ?? res.status ?? 'unknown');
    console.error('openai_failed', res.status, code);
    if (/policy|moderation/i.test(code)) throw new CompletionError('refused');
    throw new CompletionError('upstream', { detail: code });
  }
  if (res.output.some((item) => item.type === 'message' && item.content.some((c) => c.type === 'refusal'))) throw new CompletionError('refused');
  if (res.output_parsed == null) {
    console.error('openai_unparseable', 'no_output');
    throw new CompletionError('unparseable');
  }
  return { data: validated(a.schema, res.output_parsed, 'openai'), model: res.model, usage: usageOf(res.usage) };
}

function anthropicContent(a: CompleteArgs): string | Anthropic.ContentBlockParam[] {
  if (!a.image) return a.text;
  return [
    { type: 'image', source: { type: 'base64', media_type: a.image.mediaType, data: a.image.data } },
    { type: 'text', text: a.text },
  ];
}

/** A tool input_schema for a zod schema: zod's own JSON schema (every field required, no extra keys) minus the draft marker. */
function toolSchema(schema: z.ZodTypeAny): Anthropic.Tool.InputSchema {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json as Anthropic.Tool.InputSchema;
}

/** The answer checked against the route's zod schema, or 'unparseable'. */
function validated(schema: z.ZodTypeAny, raw: unknown, tag: string): Record<string, unknown> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    console.error(`${tag}_unparseable`, 'schema');
    throw new CompletionError('unparseable');
  }
  return parsed.data as Record<string, unknown>;
}

function usageOf(u: { input_tokens: number; output_tokens: number } | null | undefined): Completion['usage'] {
  return { input_tokens: u?.input_tokens ?? 0, output_tokens: u?.output_tokens ?? 0 };
}

/** The JSON the app expects: the route's own wrapping of the answer, plus which model answered and what it used. */
function finish(res: Completion, cors: Record<string, string> | null, wrap: (data: Record<string, unknown>) => Record<string, unknown>): Response {
  const payload = wrap(res.data);
  payload.model = res.model;
  payload.usage = res.usage;
  return json(payload, 200, cors);
}

/** A provider failure as the app's error codes. Logs status and message only: never the request body, image or headers. */
function errorResponse(e: unknown, cors: Record<string, string> | null): Response {
  if (e instanceof CompletionError) return json({ error: e.code, ...e.extra }, e.code === 'refused' ? 422 : 502, cors);
  const auth = e instanceof Anthropic.AuthenticationError || e instanceof OpenAI.AuthenticationError;
  // An auth error is logged as its status only: OpenAI's and DeepSeek's messages quote part of the key.
  console.error('provider_error', e instanceof Anthropic.APIError || e instanceof OpenAI.APIError ? e.status : '', auth ? 'authentication' : e instanceof Error ? e.message : String(e));
  if (auth) return json({ error: 'misconfigured' }, 500, cors);
  // An exhausted OpenAI balance comes back as a 429; it is a configuration problem, not a burst to wait out.
  if (e instanceof OpenAI.RateLimitError && e.code === 'insufficient_quota') return json({ error: 'misconfigured' }, 500, cors);
  if (e instanceof Anthropic.RateLimitError || e instanceof OpenAI.RateLimitError) return json({ error: 'rate_limited' }, 429, cors);
  // A photo the provider's policy declines is a 400 (OpenAI: *_policy_violation codes; DeepSeek: "Content Exists Risk").
  if (e instanceof Anthropic.BadRequestError || e instanceof OpenAI.BadRequestError) {
    const what = `${e instanceof OpenAI.APIError ? (e.code ?? '') : ''} ${e.message}`;
    if (/policy|content exists risk/i.test(what)) return json({ error: 'refused' }, 422, cors);
  }
  if (e instanceof Anthropic.APIError || e instanceof OpenAI.APIError) return json({ error: 'upstream', status: e.status, detail: String(e.message ?? '').slice(0, 300) }, 502, cors);
  return json({ error: 'upstream' }, 502, cors);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** A list of short strings from untrusted input: at most `max` entries, each cut to `len` characters. */
function strings(v: unknown, max: number, len: number): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').map((s) => s.trim().slice(0, len)).filter(Boolean).slice(0, max) : [];
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : min;
  return Math.min(max, Math.max(min, n));
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
