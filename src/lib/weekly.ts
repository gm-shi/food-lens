import type { Lang } from '../i18n';
import type { WeeklyResult } from './api';

const KEY = 'food-lens:weekly';
const KEEP = 12;

export interface WeeklyText extends WeeklyResult {
  lang: Lang;
  /** What the week looked like when the text was written, so a changed week can be told apart */
  loggedDays: number;
  mealsCount: number;
  complete: boolean;
  at: number;
}

type Store = Record<string, WeeklyText>;

/** Automatic writes already tried in this session, keyed by week and what it contained. */
const attempted = new Set<string>();

export function markWeeklyAttempted(key: string): void {
  attempted.add(key);
}

export function wasWeeklyAttempted(key: string): boolean {
  return attempted.has(key);
}

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as unknown) : null;
    return s && typeof s === 'object' && !Array.isArray(s) ? (s as Store) : {};
  } catch {
    return {};
  }
}

/** The written summary for the week starting on `start`, if one was saved. */
export function loadWeekly(start: string): WeeklyText | null {
  const w = read()[start];
  return w && typeof w.summary === 'string' && Array.isArray(w.focus) && typeof w.at === 'number' ? w : null;
}

export function saveWeekly(start: string, text: Omit<WeeklyText, 'at'>): void {
  try {
    const s = read();
    s[start] = { ...text, at: Date.now() };
    // Keep the most recently written weeks, so looking back at an old week does not evict it at once.
    const keys = Object.keys(s).sort((a, b) => (s[b].at ?? 0) - (s[a].at ?? 0));
    for (const k of keys.slice(KEEP)) delete s[k];
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function clearWeekly(): void {
  attempted.clear();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
