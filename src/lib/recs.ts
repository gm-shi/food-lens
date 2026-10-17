import type { Recommendation } from './api';

const KEY = 'food-lens:recs';

interface Cached {
  date: string;
  items: Recommendation[];
}

/** Dates whose automatic fetch already ran (or failed) in this session, so it is not retried on every mount. */
const attempted = new Set<string>();

export function markAttempted(date: string): void {
  attempted.add(date);
}

export function wasAttempted(date: string): boolean {
  return attempted.has(date);
}

/** Today's cached recommendations, if any. */
export function loadRecs(date: string): Recommendation[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    return c.date === date && Array.isArray(c.items) && c.items.length > 0 ? c.items : null;
  } catch {
    return null;
  }
}

export function saveRecs(date: string, items: Recommendation[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ date, items } satisfies Cached));
  } catch {
    /* storage unavailable */
  }
}

export function clearRecs(): void {
  attempted.clear();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
