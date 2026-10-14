import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Meal, type Supplement } from './db';
import { totals } from './nutrition';
import type { Nutrients } from './nutrients';
import { useSettings, type Profile } from './settings';
import { pregnancyWeek, targetsFor, trimesterOf, type Target, type Trimester } from './targets';

export interface Pregnancy {
  profile: Profile | null;
  /** completed weeks, or null when no valid due date */
  week: number | null;
  trimester: Trimester;
  targets: Target[];
  targetOf: (key: Target['key']) => Target | undefined;
}

export function usePregnancy(): Pregnancy {
  const s = useSettings();
  const week = s.profile ? pregnancyWeek(s.profile.dueDate) : null;
  const trimester: Trimester = week === null ? 2 : trimesterOf(week);
  const profileOk = s.profile && s.profile.heightCm > 0 && s.profile.prePregnancyKg > 0 && s.profile.age > 0 ? s.profile : null;
  const targets = targetsFor(profileOk, s.overrides, trimester);
  return { profile: s.profile, week, trimester, targets, targetOf: (key) => targets.find((t) => t.key === key) };
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
