import { useLiveQuery } from 'dexie-react-hooks';
import { db, localDateKey, type Meal, type Mood, type Note, type Supplement } from './db';
import { totals } from './nutrition';
import { NUTRIENT_KEYS, zeroNutrients, type Nutrients } from './nutrients';
import { useSettings, type Profile, type Settings } from './settings';
import { pregnancyWeek, targetsFor, trimesterOf, type Target, type Trimester } from './targets';

export interface Pregnancy {
  profile: Profile | null;
  /** completed weeks, or null when no valid due date */
  week: number | null;
  trimester: Trimester;
  targets: Target[];
  targetOf: (key: Target['key']) => Target | undefined;
}

/** Week, trimester and targets as they stand at a moment (`at` defaults to now; pass a past day to look back). */
export function pregnancyFor(s: Settings, at: number = Date.now()): Pregnancy {
  const week = s.profile ? pregnancyWeek(s.profile.dueDate, at) : null;
  const trimester: Trimester = week === null ? 2 : trimesterOf(week);
  const profileOk = s.profile && s.profile.heightCm > 0 && s.profile.prePregnancyKg > 0 && s.profile.age > 0 ? s.profile : null;
  const targets = targetsFor(profileOk, s.overrides, trimester);
  return { profile: s.profile, week, trimester, targets, targetOf: (key) => targets.find((t) => t.key === key) };
}

export function usePregnancy(): Pregnancy {
  return pregnancyFor(useSettings());
}

export interface Day {
  meals: Meal[];
  supplements: Supplement[];
  takenIds: Set<number>;
  totals: Nutrients;
  warnings: string[];
}

export function useDay(date: string): Day {
  const meals = useLiveQuery(() => db.meals.where('date').equals(date).sortBy('ts'), [date]) ?? [];
  const supplements = useLiveQuery(() => db.supplements.filter((s) => s.enabled).toArray(), []) ?? [];
  const logs = useLiveQuery(() => db.supplementLogs.where('date').equals(date).toArray(), [date]) ?? [];
  const takenIds = new Set(logs.map((l) => l.supplementId));
  const taken = supplements.filter((s) => takenIds.has(s.id));
  const warnings = [...new Set(meals.flatMap((m) => m.warnings ?? []))];
  return { meals, supplements, takenIds, totals: totals(meals.flatMap((m) => m.items), taken), warnings };
}

/** The day's notes, oldest first. */
export function useDayNotes(date: string): Note[] {
  return useLiveQuery(() => db.notes.where('date').equals(date).sortBy('ts'), [date]) ?? [];
}

export async function addNote(date: string, mood: Mood, text = ''): Promise<number> {
  return db.notes.add({ date, ts: Date.now(), mood, text });
}

export async function updateNote(id: number, patch: { mood?: Mood; text?: string }): Promise<void> {
  await db.notes.update(id, patch);
}

export async function deleteNote(id: number): Promise<void> {
  await db.notes.delete(id);
}

/**
 * Average daily intake over the days in the last 7 that have at least one meal logged.
 * With `excludeToday`, the window is the 7 days before today (today is usually only partly logged).
 */
export function useWeekAverage(excludeToday = false): { avg: Nutrients; loggedDays: number } {
  const meals = useLiveQuery(() => db.meals.where('ts').above(Date.now() - 9 * 86_400_000).toArray(), []) ?? [];
  const supplements = useLiveQuery(() => db.supplements.toArray(), []) ?? [];
  const logs = useLiveQuery(() => db.supplementLogs.toArray(), []) ?? [];
  const weekKeys = Array.from({ length: 7 }, (_, i) => localDateKey(Date.now() - (i + (excludeToday ? 1 : 0)) * 86_400_000));
  const byDay = new Map<string, Meal[]>();
  for (const m of meals) byDay.set(m.date, [...(byDay.get(m.date) ?? []), m]);
  const logged = weekKeys.filter((d) => byDay.has(d));
  const suppById = new Map(supplements.map((s) => [s.id, s]));
  const avg = zeroNutrients();
  for (const d of logged) {
    const ids = new Set(logs.filter((l) => l.date === d).map((l) => l.supplementId));
    const taken = [...ids].map((id) => suppById.get(id)).filter((s): s is Supplement => !!s);
    const tot = totals((byDay.get(d) ?? []).flatMap((m) => m.items), taken);
    for (const k of NUTRIENT_KEYS) avg[k] += tot[k] / logged.length;
  }
  return { avg, loggedDays: logged.length };
}

export async function setSupplementTaken(date: string, supplementId: number, taken: boolean): Promise<void> {
  await db.transaction('rw', db.supplementLogs, async () => {
    const q = db.supplementLogs.where('[date+supplementId]').equals([date, supplementId]);
    if (taken) {
      if (!(await q.first())) await db.supplementLogs.add({ date, supplementId });
    } else {
      await q.delete();
    }
  });
}
