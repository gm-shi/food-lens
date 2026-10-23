import type { MealSlot, Recommendation } from './api';

const KEY = 'food-lens:recs';

/**
 * The meal coming up, as cached on the phone. The Worker only knows four meals; the late-evening
 * snack is kept apart from the afternoon one so each gets its own ideas and its own single fetch.
 */
export type SlotKey = MealSlot | 'late';

interface Cached {
  date: string;
  slot: SlotKey;
  items: Recommendation[];
}

/**
 * Which meal is coming up at a local time: breakfast until 10:30, lunch until 14:00,
 * an afternoon snack until 16:30, dinner until 21:00, then a light evening snack.
 */
export function slotKeyOf(d: Date = new Date()): SlotKey {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 4 && h < 10.5) return 'breakfast';
  if (h >= 10.5 && h < 14) return 'lunch';
  if (h >= 14 && h < 16.5) return 'snack';
  if (h >= 16.5 && h < 21) return 'dinner';
  return 'late';
}

/** The meal the Worker is asked about. */
export function slotOfKey(key: SlotKey): MealSlot {
  return key === 'late' ? 'snack' : key;
}

/** Day+slot pairs whose automatic fetch already ran (or failed) in this session, so it is not retried on every mount. */
const attempted = new Set<string>();

export function markAttempted(date: string, slot: SlotKey): void {
  attempted.add(`${date}|${slot}`);
}

export function wasAttempted(date: string, slot: SlotKey): boolean {
  return attempted.has(`${date}|${slot}`);
}

/** The cached recommendations for this day and meal, if any. */
export function loadRecs(date: string, slot: SlotKey): Recommendation[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<Cached>;
    return c.date === date && c.slot === slot && Array.isArray(c.items) && c.items.length > 0 ? c.items : null;
  } catch {
    return null;
  }
}

export function saveRecs(date: string, slot: SlotKey, items: Recommendation[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ date, slot, items } satisfies Cached));
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
