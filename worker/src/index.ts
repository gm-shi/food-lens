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

const FoodItem = z.object({
  name: z.string().describe('Short name of the food or drink, in the requested language'),
  grams: z.number().describe('Estimated portion weight in grams, rounded to the nearest 5'),
  calories: z.number().describe('kcal for this portion'),
  protein: z.number().describe('grams of protein for this portion'),
  carbs: z.number().describe('grams of carbohydrate for this portion'),
  fat: z.number().describe('grams of fat for this portion'),
  confidence: z.enum(['low', 'medium', 'high']).describe('How sure you are about the identification and portion'),
});

const Analysis = z.object({
  is_food: z.boolean().describe('false if the photo contains no food or drink'),
  summary: z.string().describe('One short phrase naming the meal, in the requested language, e.g. "番茄炒蛋配米饭"'),
  items: z.array(FoodItem).describe('One entry per distinct food or drink; empty if is_food is false'),
});

const SYSTEM = `You estimate nutrition from a single food photo for a personal diet diary.

Identify each distinct food or drink in the photo. For each one, estimate the portion weight in grams from visual cues (dinner plate ≈ 26 cm, rice bowl ≈ 11 cm across, chopsticks ≈ 23 cm, spoon, cup, hand), then estimate calories, protein, carbohydrate and fat for that portion using typical values for how the dish is normally cooked, including cooking oil and sauces. Name a dish as one item unless its parts are clearly separate on the plate. Be realistic rather than optimistic. Round grams to the nearest 5 and nutrients to whole numbers. If the user adds a note, trust the note over the image. If there is no food or drink, set is_food to false and return an empty items list.`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const cors = corsHeaders(origin, env);

    if (origin && !cors) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors ?? {} });
    if (url.pathname === '/health') return json({ ok: true }, 200, cors);
    if (url.pathname !== '/analyze' || request.method !== 'POST') return new Response('Not found', { status: 404 });

    if (!env.ANTHROPIC_API_KEY || !env.APP_PASSCODE) return json({ error: 'misconfigured' }, 500, cors);
    if (!safeEqual(request.headers.get('x-app-passcode') ?? '', env.APP_PASSCODE)) return json({ error: 'unauthorized' }, 401, cors);

    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413, cors);

    let body: { image?: unknown; mediaType?: unknown; lang?: unknown; note?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'bad_json' }, 400, cors);
    }
    const image = typeof body.image === 'string' ? body.image : '';
    const mediaType = typeof body.mediaType === 'string' && MEDIA_TYPES.has(body.mediaType) ? (body.mediaType as MediaType) : null;
    const lang = body.lang === 'en' ? 'en' : 'zh';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    if (!image || !mediaType) return json({ error: 'bad_request' }, 400, cors);
    if (image.length > MAX_IMAGE_B64) return json({ error: 'too_large' }, 413, cors);

    const language = lang === 'zh' ? 'Simplified Chinese' : 'English';
    const userText = [`Write names and the summary in ${language}.`, note ? `User note: ${note}` : ''].filter(Boolean).join('\n');

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
    try {
      // Structured output is enforced server-side via output_config.format; we parse the text ourselves
      // so that refusals and truncation are reported with their own status instead of a thrown error.
      const res = await client.messages.create({
        model: env.MODEL || 'claude-sonnet-5-5',
        max_tokens: 8000,
        system: SYSTEM,
        output_config: { effort: effortOf(env.EFFORT), format: zodOutputFormat(Analysis) },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
              { type: 'text', text: userText },
            ],
          },
        ],
      });

      if (res.stop_reason === 'refusal') return json({ error: 'refused' }, 422, cors);
      if (res.stop_reason !== 'end_turn') {
        console.error('anthropic_incomplete', res.stop_reason);
        return json({ error: 'incomplete', stop_reason: res.stop_reason }, 502, cors);
      }
      const text = res.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      let parsed: ReturnType<typeof Analysis.safeParse> | null = null;
      try {
        parsed = Analysis.safeParse(JSON.parse(text));
      } catch {
        parsed = null;
      }
      if (!parsed || !parsed.success) {
        console.error('anthropic_unparseable', text.length);
        return json({ error: 'unparseable' }, 502, cors);
      }

      return json(
        {
          result: parsed.data,
          model: res.model,
          usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
        },
        200,
        cors,
      );
    } catch (e) {
      // Log status and message only: never the request body, image or headers.
      console.error('anthropic_error', e instanceof Anthropic.APIError ? e.status : '', e instanceof Error ? e.message : String(e));
      if (e instanceof Anthropic.RateLimitError) return json({ error: 'rate_limited' }, 429, cors);
      if (e instanceof Anthropic.AuthenticationError) return json({ error: 'misconfigured' }, 500, cors);
      if (e instanceof Anthropic.APIError) return json({ error: 'upstream', status: e.status }, 502, cors);
      return json({ error: 'upstream' }, 502, cors);
    }
  },
} satisfies ExportedHandler<Env>;

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
