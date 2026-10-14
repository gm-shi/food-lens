import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Meal } from '../lib/db';
import { totals } from '../lib/nutrition';
import { dayLabel } from '../lib/date';
import { useSettings } from '../lib/settings';
import { useT } from '../i18n';
import MealRow from '../components/MealRow';

export default function History() {
  const t = useT();
  const { lang, target } = useSettings();
  const meals = useLiveQuery(() => db.meals.orderBy('ts').reverse().toArray(), []) ?? [];

  const days = new Map<string, Meal[]>();
  for (const m of meals) {
    const list = days.get(m.date);
    if (list) list.push(m);
    else days.set(m.date, [m]);
  }

  return (
    <div className="px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 112px)' }}>
      <h1 className="text-2xl font-semibold">{t('tab.history')}</h1>
      {days.size === 0 ? (
        <p className="mt-10 text-center text-sm text-muted">{t('history.empty')}</p>
      ) : (
        <div className="mt-4 space-y-7">
          {[...days.entries()].map(([date, list]) => {
            const tot = totals(list.flatMap((m) => m.items));
            const over = tot.calories > target;
            return (
              <section key={date}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="font-medium">{dayLabel(date, lang)}</h2>
                  <p className="text-sm text-muted">
                    <span className={`tabular-nums ${over ? 'text-warn' : ''}`}>{tot.calories}</span> {t('kcal')} · {t(list.length === 1 ? 'history.meal' : 'history.meals', { n: list.length })}
                  </p>
                </div>
                <div className="space-y-2">
                  {list.map((m) => (
                    <MealRow key={m.id} meal={m} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
