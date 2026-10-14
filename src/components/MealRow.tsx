import { useState } from 'react';
import { db, type Meal } from '../lib/db';
import { totals } from '../lib/nutrition';
import { timeLabel } from '../lib/date';
import { useSettings } from '../lib/settings';
import { useT } from '../i18n';
import { TrashIcon } from './Icons';

export default function MealRow({ meal }: { meal: Meal }) {
  const t = useT();
  const { lang } = useSettings();
  const [open, setOpen] = useState(false);
  const tot = totals(meal.items);

  async function remove() {
    if (!confirm(t('meal.deleteConfirm'))) return;
    await db.meals.delete(meal.id);
  }

  return (
    <div className="rounded-2xl bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-3 text-left">
        <img src={meal.thumb} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{meal.summary || meal.items.map((i) => i.name).join('、')}</p>
          <p className="mt-0.5 text-xs text-muted">{timeLabel(meal.ts, lang)}</p>
        </div>
        <p className="shrink-0 tabular-nums">
          {tot.calories} <span className="text-xs text-muted">{t('kcal')}</span>
        </p>
      </button>
      {open && (
        <div className="border-t border-line px-3 pb-3 pt-2">
          <ul className="space-y-1.5 text-sm">
            {meal.items.map((i, idx) => (
              <li key={idx} className="flex justify-between gap-3">
                <span className="truncate">
                  {i.name} <span className="text-muted">{i.grams}{t('g')}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">{i.calories}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            {t('protein')} {tot.protein}g · {t('carbs')} {tot.carbs}g · {t('fat')} {tot.fat}g
          </p>
          {meal.note && <p className="mt-1 text-xs text-muted">“{meal.note}”</p>}
          <button type="button" onClick={remove} className="mt-3 flex items-center gap-1.5 text-sm text-warn">
            <TrashIcon width={16} height={16} /> {t('meal.delete')}
          </button>
        </div>
      )}
    </div>
  );
}
