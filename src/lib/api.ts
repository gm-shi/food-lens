import type { Lang } from '../i18n';
import type { Confidence, FoodItem } from './db';
import { NUTRIENT_KEYS, roundNutrient, type Nutrients } from './nutrients';
import type { Trimester } from './targets';

export interface Analysis {
  is_food: boolean;
  summary: string;
  items: FoodItem[];
  warnings: string[];
}

export type ApiErrorCode = 'config' | 'passcode' | 'network' | 'server' | 'refused' | 'rate_limited';

export class ApiError extends Error {
  code: ApiErrorCode;
  constructor(code: ApiErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

const WORKER_URL = ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? '').replace(/\/+$/, '');
/** HTTP header values must be printable ASCII; anything else can never match the Worker's passcode. */
const ASCII = /^[\x20-\x7e]+$/;

async function post(path: string, passcode: string, body: unknown): Promise<unknown> {
  if (!WORKER_URL) throw new ApiError('config');
  const code = passcode.trim();
  if (!ASCII.test(code)) throw new ApiError('passcode');
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-passcode': code },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network');
  }
  if (res.status === 401) throw new ApiError('passcode');
  if (res.status === 429) throw new ApiError('rate_limited');
  if (res.status === 422) throw new ApiError('refused');
  if (!res.ok) throw new ApiError('server', `HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new ApiError('server', 'bad json');
  }
}

export type MealSource = { kind: 'photo'; base64: string; mediaType: string } | { kind: 'text'; text: string };

export interface AnalyzeInput {
  source: MealSource;
  lang: Lang;
  note: string;
  passcode: string;
  trimester: Trimester | null;
}

export async function analyzeMeal(input: AnalyzeInput): Promise<Analysis> {
  const body: Record<string, unknown> = { lang: input.lang, note: input.note, trimester: input.trimester };
  if (input.source.kind === 'photo') {
    body.image = input.source.base64;
    body.mediaType = input.source.mediaType;
  } else {
    body.text = input.source.text;
  }
  const data = (await post('/analyze', input.passcode, body)) as { result?: unknown };
  return sanitize(data.result);
}

export interface LabelResult {
  readable: boolean;
  name: string;
  dose: string;
  notes: string;
  nutrients: Partial<Nutrients>;
}

/** Read a supplement or food label photo into per-daily-dose nutrient amounts. */
export async function scanLabel(input: { base64: string; mediaType: string; lang: Lang; passcode: string }): Promise<LabelResult> {
  const data = (await post('/label', input.passcode, { image: input.base64, mediaType: input.mediaType, lang: input.lang })) as { label?: unknown };
  const r = (data.label && typeof data.label === 'object' ? data.label : {}) as Record<string, unknown>;
  const nutrients: Partial<Nutrients> = {};
  for (const k of NUTRIENT_KEYS) {
    const v = roundNutrient(k, num(r[k]));
    if (v > 0) nutrients[k] = v;
  }
  return {
    readable: r.readable !== false && Object.keys(nutrients).length > 0,
    name: String(r.name ?? '').slice(0, 60),
    dose: String(r.dose ?? '').slice(0, 60),
    notes: String(r.notes ?? '').slice(0, 200),
    nutrients,
  };
}

export interface RecommendInput {
  lang: Lang;
  passcode: string;
  week: number | null;
  trimester: Trimester | null;
  /** Average over logged days before today, or null when there is no history */
  avg7: Nutrients | null;
  avgDays: number;
  totals: Nutrients;
  targets: Partial<Record<keyof Nutrients, number>>;
  meals: string[];
  previous: string[];
  hour: number;
  mood: number | null;
  moodText: string;
  gdm: { mainCarbs: number; snackCarbs: number } | null;
}

export interface Recommendation {
  name: string;
  reason: string;
}

export async function recommend(input: RecommendInput): Promise<Recommendation[]> {
  const { passcode, ...rest } = input;
  const data = (await post('/recommend', passcode, rest)) as { recommendations?: unknown };
  const list = Array.isArray(data.recommendations) ? data.recommendations : [];
  return list
    .map((r) => {
      const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      return { name: String(o.name ?? '').slice(0, 60), reason: String(o.reason ?? '').slice(0, 160) };
    })
    .filter((r) => r.name)
    .slice(0, 3);
}

/**
 * Estimate nutrients for one named food (used when the user corrects or adds an item).
 * With `grams` the estimate is for that weight; without, for the amount named or a typical serving.
 */
export async function estimateItem(input: { name: string; grams?: number; lang: Lang; passcode: string }): Promise<{ item: FoodItem; warning: string }> {
  const body: Record<string, unknown> = { name: input.name, lang: input.lang };
  if (input.grams !== undefined) body.grams = input.grams;
  const data = (await post('/item', input.passcode, body)) as { item?: unknown; warning?: unknown };
  const item = cleanItem(data.item);
  if (!item.grams) item.grams = Math.round(input.grams ?? 100);
  return { item, warning: typeof data.warning === 'string' ? data.warning.trim().slice(0, 200) : '' };
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Coerce an untrusted object (model output, old record or imported backup) into a well-formed FoodItem. */
export function cleanItem(x: unknown): FoodItem {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const conf = o.confidence;
  const item = {
    name: String(o.name ?? '').slice(0, 60) || '?',
    grams: Math.round(num(o.grams)),
    confidence: (conf === 'low' || conf === 'medium' || conf === 'high' ? conf : 'medium') as Confidence,
  } as FoodItem;
  for (const k of NUTRIENT_KEYS) item[k] = roundNutrient(k, num(o[k]));
  if (!item.energy && typeof o.calories === 'number') item.energy = roundNutrient('energy', num(o.calories));
  return item;
}

function sanitize(raw: unknown): Analysis {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(r.items) ? r.items.slice(0, 20) : [];
  const items = list.map(cleanItem);
  const warnings = Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string').map((w) => w.slice(0, 200)).slice(0, 4) : [];
  return { is_food: Boolean(r.is_food) && items.length > 0, summary: String(r.summary ?? '').slice(0, 120), items, warnings };
}
