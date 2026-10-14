import { useState } from 'react';
import { db, type Meal } from '../lib/db';
import { totals } from '../lib/nutrition';
import { fmt } from '../lib/nutrients';
import { timeLabel } from '../lib/date';
import { useSettings } from '../lib/settings';
import { useT } from '../i18n';
import { AlertIcon, TrashIcon } from './Icons';

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
        {meal.thumb ? <img src={meal.thumb} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : <div className="h-14 w-14 shrink-0 rounded-xl bg-line" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{meal.summary || meal.items.map((i) => i.name).join('、')}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            {timeLabel(meal.ts, lang)}
            {meal.warnings?.length > 0 && <AlertIcon width={14} height={14} className="text-warn" />}
          </p>
        </div>
        <p className="shrink-0 tabular-nums">
          {fmt('energy', tot.energy)} <span className="text-xs text-muted">{t('kcal')}</span>
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
                <span className="shrink-0 tabular-nums text-muted">{fmt('energy', i.energy)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            {t('n.protein')} {fmt('protein', tot.protein)}g · {t('n.fiber')} {fmt('fiber', tot.fiber)}g · {t('n.iron')} {fmt('iron', tot.iron)}mg · {t('n.calcium')} {fmt('calcium', tot.calcium)}mg · {t('n.folate')} {fmt('folate', tot.folate)}µg
          </p>
          {meal.warnings?.map((w, i) => (
            <p key={i} className="mt-1 text-xs text-warn">
              {w}
            </p>
          ))}
          {meal.note && <p className="mt-1 text-xs text-muted">“{meal.note}”</p>}
          <button type="button" onClick={remove} className="mt-3 flex items-center gap-1.5 py-1 text-sm text-warn">
            <TrashIcon width={16} height={16} /> {t('meal.delete')}
          </button>
        </div>
      )}
    </div>
  );
}
