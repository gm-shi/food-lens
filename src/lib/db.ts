import Dexie, { type EntityTable } from 'dexie';

export type Confidence = 'low' | 'medium' | 'high';

export interface FoodItem {
  name: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: Confidence;
}

export interface Meal {
  id: number;
  /** Local calendar day, YYYY-MM-DD */
  date: string;
  ts: number;
  /** Small square JPEG data URL */
  thumb: string;
  summary: string;
  note: string;
  items: FoodItem[];
}

export const db = new Dexie('food-lens') as Dexie & {
  meals: EntityTable<Meal, 'id'>;
};

db.version(1).stores({
  meals: '++id, date, ts',
});

export function localDateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
