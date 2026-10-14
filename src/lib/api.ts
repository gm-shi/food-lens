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

export interface AnalyzeInput {
  base64: string;
  mediaType: string;
  lang: Lang;
  note: string;
  passcode: string;
  trimester: Trimester | null;
}

export async function analyzePhoto(input: AnalyzeInput): Promise<Analysis> {
  const data = (await post('/analyze', input.passcode, {
    image: input.base64,
    mediaType: input.mediaType,
    lang: input.lang,
    note: input.note,
    trimester: input.trimester,
  })) as { result?: unknown };
  return sanitize(data.result);
}

export interface SuggestInput {
  lang: Lang;
  passcode: string;
  week: number | null;
  trimester: Trimester | null;
  totals: Nutrients;
  targets: Partial<Record<keyof Nutrients, number>>;
  meals: string[];
  hour: number;
}

export async function suggestNext(input: SuggestInput): Promise<string> {
  const { passcode, ...rest } = input;
  const data = (await post('/suggest', passcode, rest)) as { suggestion?: unknown };
  return String(data.suggestion ?? '').slice(0, 400);
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
