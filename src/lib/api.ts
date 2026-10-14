import type { Lang } from '../i18n';
import type { Confidence, FoodItem } from './db';

export interface Analysis {
  is_food: boolean;
  summary: string;
  items: FoodItem[];
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

export interface AnalyzeInput {
  base64: string;
  mediaType: string;
  lang: Lang;
  note: string;
  passcode: string;
}

export async function analyzePhoto(input: AnalyzeInput): Promise<Analysis> {
  if (!WORKER_URL) throw new ApiError('config');
  const passcode = input.passcode.trim();
  if (!ASCII.test(passcode)) throw new ApiError('passcode');
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-passcode': passcode },
      body: JSON.stringify({ image: input.base64, mediaType: input.mediaType, lang: input.lang, note: input.note }),
    });
  } catch {
    throw new ApiError('network');
  }
  if (res.status === 401) throw new ApiError('passcode');
  if (res.status === 429) throw new ApiError('rate_limited');
  if (res.status === 422) throw new ApiError('refused');
  if (!res.ok) throw new ApiError('server', `HTTP ${res.status}`);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError('server', 'bad json');
  }
  return sanitize((data as { result?: unknown }).result);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** Coerce an untrusted object (model output or imported backup) into a well-formed FoodItem. */
export function cleanItem(x: unknown): FoodItem {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const conf = o.confidence;
  return {
    name: String(o.name ?? '').slice(0, 60) || '?',
    grams: num(o.grams),
    calories: num(o.calories),
    protein: num(o.protein),
    carbs: num(o.carbs),
    fat: num(o.fat),
    confidence: (conf === 'low' || conf === 'medium' || conf === 'high' ? conf : 'medium') as Confidence,
  };
}

function sanitize(raw: unknown): Analysis {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(r.items) ? r.items.slice(0, 20) : [];
  const items = list.map(cleanItem);
  return { is_food: Boolean(r.is_food) && items.length > 0, summary: String(r.summary ?? '').slice(0, 120), items };
}
