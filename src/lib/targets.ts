import { NUTRIENTS, type NutrientKey } from './nutrients';
import { ENERGY_ADD_MJ, KCAL_PER_MJ, NRV, PAL, SCHOFIELD_WOMEN, T1_GAIN, WEIGHT_GAIN, type GainBand } from './nrv';
import type { Profile } from './settings';

export type Trimester = 1 | 2 | 3;

export interface Target {
  key: NutrientKey;
  value: number;
  kind: 'target' | 'limit';
  upper?: number;
  overridden: boolean;
}

const DAY = 86_400_000;

/** Completed weeks of pregnancy from the due date (40 weeks = 280 days). */
export function pregnancyWeek(dueDate: string, now: number = Date.now()): number | null {
  const d = daysUntilDue(dueDate, now);
  if (d === null) return null;
  return Math.max(0, Math.min(44, Math.floor((280 - d) / 7)));
}

/** Whole local calendar days from `now` to the due date (YYYY-MM-DD), DST-safe. */
export function daysUntilDue(dueDate: string, now: number = Date.now()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!m) return null;
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  if (!Number.isFinite(due)) return null;
  const n = new Date(now);
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((due - today) / DAY);
}

/** Fractional pregnancy week for charting (not clamped to whole weeks). */
export function pregnancyWeekExact(dueDate: string, at: number): number | null {
  const d = daysUntilDue(dueDate, at);
  return d === null ? null : (280 - d) / 7;
}

export function trimesterOf(week: number): Trimester {
  if (week <= 12) return 1;
  if (week <= 27) return 2;
  return 3;
}

export function bmi(kg: number, heightCm: number): number {
  const m = heightCm / 100;
  return m > 0 ? kg / (m * m) : 0;
}

export type BmiCategory = keyof typeof WEIGHT_GAIN;

export function bmiCategory(b: number): BmiCategory {
  if (b < 18.5) return 'underweight';
  if (b < 25) return 'healthy';
  if (b < 30) return 'overweight';
  return 'obese';
}

export function gainBand(profile: Profile): GainBand {
  return WEIGHT_GAIN[bmiCategory(bmi(profile.prePregnancyKg, profile.heightCm))];
}

/** Suggested cumulative gain (kg) at a given week: 0.5-2 kg across trimester 1, then the weekly rate. */
export function expectedGain(profile: Profile, week: number): { min: number; max: number } {
  const band = gainBand(profile);
  if (week <= 13) {
    const f = week / 13;
    return { min: T1_GAIN.min * f, max: T1_GAIN.max * f };
  }
  const w = week - 13;
  return {
    min: Math.min(band.totalMin, T1_GAIN.min + band.rateMin * w),
    max: Math.min(band.totalMax, T1_GAIN.max + band.rateMax * w),
  };
}

/** Energy (kcal/day): Schofield BMR on pre-pregnancy weight × PAL, plus trimester additions. */
export function energyTarget(profile: Profile, trimester: Trimester): number {
  const eq = profile.age < 30 ? SCHOFIELD_WOMEN.young : SCHOFIELD_WOMEN.middle;
  const bmrMj = eq.a * profile.prePregnancyKg + eq.b;
  const add = trimester === 2 ? ENERGY_ADD_MJ.t2 : trimester === 3 ? ENERGY_ADD_MJ.t3 : 0;
  const kcal = (bmrMj * PAL[profile.activity] + add) * KCAL_PER_MJ;
  return Math.round(kcal / 10) * 10;
}

/** Nutrients worth showing first in each trimester (energy is always shown on top). */
export const PRIORITY: Record<Trimester, NutrientKey[]> = {
  1: ['folate', 'iron', 'protein', 'iodine', 'fiber', 'vitC'],
  2: ['iron', 'calcium', 'protein', 'dha', 'fiber', 'folate'],
  3: ['iron', 'calcium', 'dha', 'protein', 'fiber', 'vitC'],
};

/** Full display order for the expanded list. */
export const DISPLAY_ORDER: NutrientKey[] = ['protein', 'fiber', 'calcium', 'iron', 'folate', 'iodine', 'dha', 'vitC', 'vitA', 'vitD', 'caffeine'];

export function targetsFor(profile: Profile | null, overrides: Partial<Record<NutrientKey, number>>, trimester: Trimester): Target[] {
  const out: Target[] = [];
  const energy = overrides.energy ?? (profile ? energyTarget(profile, trimester) : 2000);
  out.push({ key: 'energy', value: energy, kind: 'target', overridden: overrides.energy !== undefined });
  for (const key of DISPLAY_ORDER) {
    const n = NRV[key];
    if (!n) continue;
    const o = overrides[key];
    const base = trimester === 1 && n.t1 !== undefined ? n.t1 : n.value;
    out.push({ key, value: o ?? base, kind: n.kind, upper: n.upper, overridden: o !== undefined });
  }
  return out;
}

export function unitOf(key: NutrientKey): string {
  return NUTRIENTS[key].unit;
}
