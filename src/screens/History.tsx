import { useLiveQuery } from 'dexie-react-hooks';
import { db, localDateKey, type Meal } from '../lib/db';
import { totals } from '../lib/nutrition';
import { fmt, NUTRIENT_KEYS, zeroNutrients, type Nutrients } from '../lib/nutrients';
import { usePregnancy } from '../lib/hooks';
import { PRIORITY } from '../lib/targets';
import { dayLabel } from '../lib/date';
import { useSettings } from '../lib/settings';
import { useT } from '../i18n';
import MealRow from '../components/MealRow';
import NutrientBar from '../components/NutrientBar';

export default function History() {
  const t = useT();
  const { lang } = useSettings();
  const preg = usePregnancy();
  const meals = useLiveQuery(() => db.meals.orderBy('ts').reverse().toArray(), []) ?? [];
  const supplements = useLiveQuery(() => db.supplements.toArray(), []) ?? [];
  const logs = useLiveQuery(() => db.supplementLogs.toArray(), []) ?? [];

  const days = new Map<string, Meal[]>();
  for (const m of meals) {
    const list = days.get(m.date);
    if (list) list.push(m);
    else days.set(m.date, [m]);
  }

  // Average over the days in the last 7 that have at least one meal logged
  const weekKeys = Array.from({ length: 7 }, (_, i) => localDateKey(Date.now() - i * 86_400_000));
  const logged = weekKeys.filter((d) => days.has(d));
  const suppById = new Map(supplements.map((s) => [s.id, s]));
  const avg: Nutrients = zeroNutrients();
  for (const d of logged) {
    const ids = new Set(logs.filter((l) => l.date === d).map((l) => l.supplementId));
    const taken = [...ids].map((id) => suppById.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
    const tot = totals((days.get(d) ?? []).flatMap((m) => m.items), taken);
    for (const k of NUTRIENT_KEYS) avg[k] += tot[k] / logged.length;
  }
  const energy = preg.targetOf('energy');

  return (
    <div className="px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 112px)' }}>
      <h1 className="text-2xl font-semibold">{t('tab.history')}</h1>

      {logged.length > 0 && (
        <section className="mt-4 rounded-3xl bg-card px-5 py-4">
          <h2 className="font-medium">{t('history.week', { n: logged.length })}</h2>
          {energy && (
            <p className="mt-1 text-sm text-muted">
              {t('n.energy')} <span className="tabular-nums text-ink">{fmt('energy', avg.energy)}</span> / {energy.value} {t('kcal')}
            </p>
          )}
          <div className="mt-1 divide-y divide-line">
            {PRIORITY[preg.trimester].map((k) => {
              const tg = preg.targetOf(k);
              return tg ? <NutrientBar key={k} target={tg} value={avg[k]} compact /> : null;
            })}
          </div>
        </section>
      )}

      {days.size === 0 ? (
        <p className="mt-10 text-center text-sm text-muted">{t('history.empty')}</p>
      ) : (
        <div className="mt-6 space-y-7">
          {[...days.entries()].map(([date, list]) => {
            const tot = totals(list.flatMap((m) => m.items));
            return (
              <section key={date}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="font-medium">{dayLabel(date, lang)}</h2>
                  <p className="text-sm text-muted">
                    <span className="tabular-nums">{fmt('energy', tot.energy)}</span> {t('kcal')} · {t(list.length === 1 ? 'history.meal' : 'history.meals', { n: list.length })}
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
