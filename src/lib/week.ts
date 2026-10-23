import { useLiveQuery } from 'dexie-react-hooks';
import { db, localDateKey, type Meal, type Mood, type Supplement } from './db';
import { addDays, daysBetween } from './date';
import { totals } from './nutrition';
import { NUTRIENT_KEYS, zeroNutrients, type Nutrients } from './nutrients';

export interface WeekStats {
  start: string;
  end: string;
  /** True once the week's last day is in the past */
  complete: boolean;
  /** Days of the week that have begun, today included (7 once the week is over) */
  daysElapsed: number;
  loggedDays: number;
  mealsCount: number;
  /** Average daily intake over the logged days, supplements included */
  avg: Nutrients;
  /** The highest single logged day's caffeine (the 200 mg advice is per day, so an average can hide it) */
  caffeineMax: number;
  /** First and last weight logged in the week; one entry gives start = end */
  weight: { start: number; end: number; entries: number } | null;
  moods: Mood[];
  moodTexts: string[];
  warnings: string[];
}

/** Intake, weight and mood over one Monday-to-Sunday week. */
export function useWeekStats(start: string): WeekStats {
  const end = addDays(start, 6);
  const meals = useLiveQuery(() => db.meals.where('date').between(start, end, true, true).toArray(), [start, end]) ?? [];
  const supplements = useLiveQuery(() => db.supplements.toArray(), []) ?? [];
  const logs = useLiveQuery(() => db.supplementLogs.where('date').between(start, end, true, true).toArray(), [start, end]) ?? [];
  const weights = useLiveQuery(() => db.weights.where('date').between(start, end, true, true).sortBy('ts'), [start, end]) ?? [];
  const notes = useLiveQuery(() => db.notes.where('date').between(start, end, true, true).sortBy('ts'), [start, end]) ?? [];

  const byDay = new Map<string, Meal[]>();
  for (const m of meals) byDay.set(m.date, [...(byDay.get(m.date) ?? []), m]);
  const suppById = new Map(supplements.map((s) => [s.id, s]));
  const avg = zeroNutrients();
  let caffeineMax = 0;
  const logged = [...byDay.keys()];
  for (const d of logged) {
    const ids = new Set(logs.filter((l) => l.date === d).map((l) => l.supplementId));
    const taken = [...ids].map((id) => suppById.get(id)).filter((s): s is Supplement => !!s);
    const tot = totals((byDay.get(d) ?? []).flatMap((m) => m.items), taken);
    for (const k of NUTRIENT_KEYS) avg[k] += tot[k] / logged.length;
    caffeineMax = Math.max(caffeineMax, tot.caffeine);
  }
  const today = localDateKey();
  const complete = end < today;
  const first = weights[0];
  const last = weights[weights.length - 1];
  return {
    start,
    end,
    complete,
    daysElapsed: complete ? 7 : Math.max(0, Math.min(7, daysBetween(start, today) + 1)),
    loggedDays: logged.length,
    mealsCount: meals.length,
    avg,
    caffeineMax,
    weight: first && last ? { start: first.kg, end: last.kg, entries: weights.length } : null,
    moods: notes.map((n) => n.mood),
    moodTexts: notes.map((n) => n.text.trim()).filter(Boolean),
    warnings: [...new Set(meals.flatMap((m) => m.warnings ?? []))],
  };
}
