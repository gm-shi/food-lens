import Dexie, { type EntityTable } from 'dexie';
import { NUTRIENT_KEYS, type Nutrients } from './nutrients';

export type Confidence = 'low' | 'medium' | 'high';
/** How an item's amount is measured: grams, or millilitres for drinks and liquid foods. */
export type AmountUnit = 'g' | 'ml';

export interface FoodItem extends Nutrients {
  name: string;
  /** Portion amount in `unit` (the field name predates millilitres) */
  grams: number;
  /** Absent means grams */
  unit?: AmountUnit;
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
  /** Pregnancy food-safety notes from the analysis, in the app language */
  warnings: string[];
  /** Main meal or snack (used by the gestational-diabetes carbohydrate limits) */
  kind?: 'main' | 'snack';
  /** How the meal was logged */
  source?: 'photo' | 'text';
}

export interface WeightEntry {
  id: number;
  date: string;
  ts: number;
  kg: number;
}

export interface Supplement {
  id: number;
  name: string;
  enabled: boolean;
  /** Nutrients per daily dose */
  nutrients: Partial<Nutrients>;
}

export interface SupplementLog {
  id: number;
  date: string;
  supplementId: number;
}

export type Mood = 1 | 2 | 3 | 4 | 5;

export interface Note {
  id: number;
  /** Local calendar day, YYYY-MM-DD */
  date: string;
  ts: number;
  mood: Mood;
  text: string;
}

export const db = new Dexie('food-lens') as Dexie & {
  meals: EntityTable<Meal, 'id'>;
  weights: EntityTable<WeightEntry, 'id'>;
  supplements: EntityTable<Supplement, 'id'>;
  supplementLogs: EntityTable<SupplementLog, 'id'>;
  notes: EntityTable<Note, 'id'>;
};

db.version(1).stores({
  meals: '++id, date, ts',
});

db.version(2)
  .stores({
    meals: '++id, date, ts',
    weights: '++id, &date, ts',
    supplements: '++id',
    supplementLogs: '++id, date, [date+supplementId]',
  })
  .upgrade((tx) =>
    tx
      .table('meals')
      .toCollection()
      .modify((m: Record<string, unknown>) => {
        // v1 items had calories/protein/carbs/fat only
        const items = Array.isArray(m.items) ? (m.items as Record<string, unknown>[]) : [];
        m.items = items.map((it) => {
          const out: Record<string, unknown> = { name: it.name, grams: it.grams, confidence: it.confidence ?? 'medium' };
          for (const k of NUTRIENT_KEYS) out[k] = typeof it[k] === 'number' ? it[k] : 0;
          if (typeof it.calories === 'number' && !it.energy) out.energy = it.calories;
          return out;
        });
        if (!Array.isArray(m.warnings)) m.warnings = [];
      }),
  );

db.version(3).stores({
  meals: '++id, date, ts',
  weights: '++id, &date, ts',
  supplements: '++id',
  supplementLogs: '++id, date, [date+supplementId]',
  dayNotes: '&date',
});

// v4: several notes per day. The v3 one-per-day notes are carried over.
db.version(4)
  .stores({
    meals: '++id, date, ts',
    weights: '++id, &date, ts',
    supplements: '++id',
    supplementLogs: '++id, date, [date+supplementId]',
    dayNotes: null,
    notes: '++id, date, ts',
  })
  .upgrade(async (tx) => {
    const old = (await tx.table('dayNotes').toArray()) as { date: string; mood: Mood; text: string; ts: number }[];
    if (old.length) await tx.table('notes').bulkAdd(old.map((n) => ({ date: n.date, ts: n.ts, mood: n.mood, text: n.text })));
  });

export function localDateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
