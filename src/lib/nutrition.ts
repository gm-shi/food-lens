import type { FoodItem } from './db';

export interface Totals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function totals(items: FoodItem[]): Totals {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const i of items) {
    t.calories += i.calories;
    t.protein += i.protein;
    t.carbs += i.carbs;
    t.fat += i.fat;
  }
  return { calories: Math.round(t.calories), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) };
}

/** True when an item contributes something worth keeping. */
export function hasSubstance(item: FoodItem): boolean {
  return item.grams > 0 || item.calories > 0;
}

/** Rescale an item to a new weight using `basis` (the model's original estimate) as the per-gram reference. */
export function rescale(basis: FoodItem, grams: number): FoodItem {
  const g = Math.max(0, Math.round(grams));
  if (basis.grams <= 0) return { ...basis, grams: g };
  const r = g / basis.grams;
  return {
    ...basis,
    grams: g,
    calories: Math.round(basis.calories * r),
    protein: Math.round(basis.protein * r),
    carbs: Math.round(basis.carbs * r),
    fat: Math.round(basis.fat * r),
  };
}
