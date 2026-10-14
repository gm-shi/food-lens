import type { FoodItem, Supplement } from './db';
import { addNutrients, NUTRIENT_KEYS, roundNutrient, zeroNutrients, type Nutrients } from './nutrients';

export function totals(items: FoodItem[], supplements: Supplement[] = []): Nutrients {
  const t = zeroNutrients();
  for (const i of items) addNutrients(t, i);
  for (const s of supplements) addNutrients(t, s.nutrients);
  for (const k of NUTRIENT_KEYS) t[k] = roundNutrient(k, t[k]);
  return t;
}

/** True when an item contributes something worth keeping. */
export function hasSubstance(item: FoodItem): boolean {
  return item.grams > 0 || item.energy > 0;
}

/** Rescale an item to a new weight using `basis` (the model's original estimate) as the per-gram reference. */
export function rescale(basis: FoodItem, grams: number): FoodItem {
  const g = Math.max(0, Math.round(grams));
  if (basis.grams <= 0) return { ...basis, grams: g };
  const r = g / basis.grams;
  const out = { ...basis, grams: g };
  for (const k of NUTRIENT_KEYS) out[k] = roundNutrient(k, basis[k] * r);
  return out;
}
