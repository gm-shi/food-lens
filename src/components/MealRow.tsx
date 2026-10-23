import { useState } from 'react';
import { db, localDateKey, type Meal } from '../lib/db';
import { totals } from '../lib/nutrition';
import { fmt } from '../lib/nutrients';
import { timeLabel } from '../lib/date';
import { gdmLimit, useSettings } from '../lib/settings';
import { useT } from '../i18n';
import { AlertIcon, EditIcon, PlusIcon, TrashIcon } from './Icons';

export default function MealRow({ meal, onEdit }: { meal: Meal; onEdit?: (meal: Meal) => void }) {
  const t = useT();
  const { lang, gdm } = useSettings();
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const tot = totals(meal.items);
  const kind: 'main' | 'snack' = meal.kind === 'snack' ? 'snack' : 'main';
  const carbLimit = gdm.enabled ? gdmLimit(gdm, kind) : null;
  const carbOver = carbLimit !== null && tot.carbs > carbLimit;

  async function remove() {
    if (!confirm(t('meal.deleteConfirm'))) return;
    await db.meals.delete(meal.id);
  }

  /** Copy this meal into today's log with the current time. */
  async function again() {
    if (added) return;
    setAdded(true);
    const { id: _id, ...rest } = meal;
    await db.meals.add({ ...rest, date: localDateKey(), ts: Date.now() });
    setTimeout(() => {
      setAdded(false);
      setOpen(false);
    }, 1500);
  }

  return (
    <div className="rounded-2xl bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-3 text-left">
        {meal.thumb ? <img src={meal.thumb} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-line text-xs text-muted">Aa</div>}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{meal.summary || meal.items.map((i) => i.name).join('、')}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted">
            <span className="whitespace-nowrap">{timeLabel(meal.ts, lang)}</span>
            {carbLimit !== null && (
              <span className={`whitespace-nowrap ${carbOver ? 'text-warn' : ''}`}>· {t('meal.carbs', { kind: t(kind === 'snack' ? 'analyze.snack' : 'analyze.main'), n: fmt('carbs', tot.carbs), limit: carbLimit })}</span>
            )}
            {meal.warnings?.length > 0 && <AlertIcon width={14} height={14} className="shrink-0 text-warn" />}
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
                  {i.name} <span className="text-muted">{i.grams}{t(i.unit === 'ml' ? 'ml' : 'g')}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">{fmt('energy', i.energy)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            {t('n.protein')} {fmt('protein', tot.protein)}g · {t('n.carbs')} {fmt('carbs', tot.carbs)}g · {t('n.fiber')} {fmt('fiber', tot.fiber)}g · {t('n.iron')} {fmt('iron', tot.iron)}mg · {t('n.calcium')} {fmt('calcium', tot.calcium)}mg · {t('n.folate')} {fmt('folate', tot.folate)}µg
          </p>
          {meal.warnings?.map((w, i) => (
            <p key={i} className="mt-1 text-xs text-warn">
              {w}
            </p>
          ))}
          {meal.note && <p className="mt-1 text-xs text-muted">“{meal.note}”</p>}
          {gdm.enabled && (
            <div className="mt-3 flex rounded-full bg-bg p-0.5 text-sm self-start w-fit">
              {(['main', 'snack'] as const).map((k) => (
                <button key={k} type="button" onClick={() => void db.meals.update(meal.id, { kind: k })} className={`whitespace-nowrap rounded-full px-3 py-1 ${kind === k ? 'bg-card font-medium shadow-sm' : 'text-muted'}`}>
                  {t(k === 'main' ? 'analyze.main' : 'analyze.snack')}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
            {onEdit && (
              <button type="button" onClick={() => onEdit(meal)} className="flex items-center gap-1.5 py-1 text-sm text-accent">
                <EditIcon width={16} height={16} /> {t('meal.edit')}
              </button>
            )}
            <button type="button" onClick={() => void again()} disabled={added} className="flex items-center gap-1.5 py-1 text-sm text-accent disabled:opacity-70">
              <PlusIcon width={16} height={16} /> {added ? t('meal.added') : t('meal.again')}
            </button>
            <button type="button" onClick={remove} className="flex items-center gap-1.5 py-1 text-sm text-warn">
              <TrashIcon width={16} height={16} /> {t('meal.delete')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
