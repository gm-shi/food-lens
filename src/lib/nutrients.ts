/**
 * Nutrient vocabulary shared by the app, the Worker schema and the targets table.
 * Values are per item / per day in the unit listed here.
 */
export type NutrientKey =
  | 'energy'
  | 'protein'
  | 'carbs'
  | 'fat'
  | 'fiber'
  | 'calcium'
  | 'iron'
  | 'folate'
  | 'vitC'
  | 'vitA'
  | 'dha'
  | 'iodine'
  | 'vitD'
  | 'caffeine';

export const NUTRIENT_KEYS: NutrientKey[] = ['energy', 'protein', 'carbs', 'fat', 'fiber', 'calcium', 'iron', 'folate', 'vitC', 'vitA', 'dha', 'iodine', 'vitD', 'caffeine'];

export type Unit = 'kcal' | 'g' | 'mg' | 'µg';

export interface NutrientDef {
  unit: Unit;
  /** decimals to show */
  dp: number;
}

export const NUTRIENTS: Record<NutrientKey, NutrientDef> = {
  energy: { unit: 'kcal', dp: 0 },
  protein: { unit: 'g', dp: 0 },
  carbs: { unit: 'g', dp: 0 },
  fat: { unit: 'g', dp: 0 },
  fiber: { unit: 'g', dp: 0 },
  calcium: { unit: 'mg', dp: 0 },
  iron: { unit: 'mg', dp: 1 },
  folate: { unit: 'µg', dp: 0 },
  vitC: { unit: 'mg', dp: 0 },
  vitA: { unit: 'µg', dp: 0 },
  dha: { unit: 'mg', dp: 0 },
  iodine: { unit: 'µg', dp: 0 },
  vitD: { unit: 'µg', dp: 1 },
  caffeine: { unit: 'mg', dp: 0 },
};

export type Nutrients = Record<NutrientKey, number>;

export function zeroNutrients(): Nutrients {
  const n = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) n[k] = 0;
  return n;
}

export function addNutrients(into: Nutrients, from: Partial<Nutrients>, factor = 1): Nutrients {
  for (const k of NUTRIENT_KEYS) into[k] += (from[k] ?? 0) * factor;
  return into;
}

export function roundNutrient(key: NutrientKey, v: number): number {
  const f = 10 ** NUTRIENTS[key].dp;
  return Math.round(v * f) / f;
}

/** Compact display: one decimal only when it carries information (27, 0.3, 1.5). */
export function fmt(key: NutrientKey, v: number): string {
  const r = roundNutrient(key, v);
  return Number.isInteger(r) ? String(r) : r.toFixed(NUTRIENTS[key].dp);
}
