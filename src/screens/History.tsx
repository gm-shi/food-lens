import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, localDateKey, type Meal } from '../lib/db';
import { totals } from '../lib/nutrition';
import { fmt } from '../lib/nutrients';
import { addDays, dayLabel, parseDateKey, timeLabel, weekStartOf } from '../lib/date';
import { MOODS } from '../lib/moods';
import { useSettings } from '../lib/settings';
import { useT } from '../i18n';
import MealRow from '../components/MealRow';
import WeekCard from '../components/WeekCard';
import { ChevronIcon } from '../components/Icons';

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `focusDate` opens the calendar on that day (used after a meal is saved to an earlier day). */
export default function History({ onEdit, focusDate = null }: { onEdit: (meal: Meal) => void; focusDate?: string | null }) {
  const t = useT();
  const { lang } = useSettings();
  const loadedMeals = useLiveQuery(() => db.meals.orderBy('ts').reverse().toArray(), []);
  const meals = loadedMeals ?? [];
  const notes = useLiveQuery(() => db.notes.orderBy('ts').toArray(), []) ?? [];
  const [calOpen, setCalOpen] = useState(focusDate !== null);
  const [month, setMonth] = useState(() => {
    const n = focusDate ? parseDateKey(focusDate) : new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(focusDate);
  const [pickedWeek, setPickedWeek] = useState<string | null>(null);

  const days = new Map<string, Meal[]>();
  for (const m of meals) {
    const list = days.get(m.date);
    if (list) list.push(m);
    else days.set(m.date, [m]);
  }
  const noteByDate = new Map<string, typeof notes>();
  for (const n of notes) noteByDate.set(n.date, [...(noteByDate.get(n.date) ?? []), n]);
  const today = localDateKey();

  // The week card opens on this week, or on last week while this one is still empty.
  const thisWeek = weekStartOf(today);
  const lastWeek = addDays(thisWeek, -7);
  const hasThisWeek = meals.some((m) => m.date >= thisWeek);
  const hasLastWeek = meals.some((m) => m.date >= lastWeek && m.date < thisWeek);
  const weekStart = pickedWeek ?? (loadedMeals && !hasThisWeek && hasLastWeek ? lastWeek : thisWeek);

  // Calendar grid, Monday first
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${monthKey(month)}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const weekdays = t('cal.weekdays').split(',');

  const dates = [...new Set([...days.keys(), ...noteByDate.keys()])].sort().reverse();
  const shown = selected ? [[selected, days.get(selected) ?? []] as const] : dates.map((d) => [d, days.get(d) ?? []] as const);

  return (
    <div className="px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 112px)' }}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('tab.history')}</h1>
        <button
          type="button"
          onClick={() => {
            setCalOpen((v) => !v);
            setSelected(null);
          }}
          aria-pressed={calOpen}
          className={`rounded-full px-3 py-1.5 text-sm ${calOpen ? 'bg-accent-soft text-accent' : 'bg-card text-muted'}`}
        >
          {t('history.calendar')}
        </button>
      </div>

      {calOpen && (
        <section className="mt-4 rounded-3xl bg-card px-4 py-4">
          <div className="flex items-center justify-between">
            <button type="button" aria-label="previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="p-2 text-muted">
              <ChevronIcon width={18} height={18} className="rotate-180" />
            </button>
            <span className="font-medium">{month.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long' })}</span>
            <button type="button" aria-label="next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="p-2 text-muted">
              <ChevronIcon width={18} height={18} />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-7 text-center text-xs text-muted">
            {weekdays.map((w, i) => (
              <span key={i} className="py-1">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center text-sm">
            {cells.map((key, i) =>
              key ? (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected(selected === key ? null : key)}
                  className={`mx-auto flex h-10 w-10 flex-col items-center justify-center rounded-full ${selected === key ? 'bg-accent text-on-accent' : key === today ? 'bg-accent-soft text-accent' : ''}`}
                >
                  <span className="tabular-nums leading-none">{Number(key.slice(-2))}</span>
                  <span className={`mt-1 h-1 w-1 rounded-full ${days.has(key) || noteByDate.has(key) ? (selected === key ? 'bg-on-accent' : 'bg-accent') : 'bg-transparent'}`} />
                </button>
              ) : (
                <span key={`e${i}`} />
              ),
            )}
          </div>
          {selected && (
            <button type="button" onClick={() => setSelected(null)} className="mt-2 w-full py-1 text-center text-xs text-accent">
              {t('history.all')}
            </button>
          )}
        </section>
      )}

      {!selected && (meals.length > 0 || pickedWeek !== null) && <WeekCard start={weekStart} onChange={setPickedWeek} />}

      {shown.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted">{t('history.empty')}</p>
      ) : (
        <div className="mt-6 space-y-7">
          {shown.map(([date, list]) => {
            const tot = totals(list.flatMap((m) => m.items));
            const n = noteByDate.get(date);
            return (
              <section key={date}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="font-medium">{dayLabel(date, lang)}</h2>
                  {list.length > 0 && (
                    <p className="text-sm text-muted">
                      <span className="tabular-nums">{fmt('energy', tot.energy)}</span> {t('kcal')} · {t(list.length === 1 ? 'history.meal' : 'history.meals', { n: list.length })}
                    </p>
                  )}
                </div>
                {n && (
                  <ul className="mb-2 space-y-0.5 px-1 text-sm text-muted">
                    {n.map((x) => (
                      <li key={x.id}>
                        {MOODS.find((m) => m.value === x.mood)?.emoji} <span className="tabular-nums">{timeLabel(x.ts, lang)}</span> {t(`mood.${x.mood}`)}
                        {x.text && <span> · {x.text}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {list.length === 0 && !n ? (
                  <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{t('history.noneThatDay')}</p>
                ) : list.length === 0 ? null : (
                  <div className="space-y-2">
                    {list.map((m) => (
                      <MealRow key={m.id} meal={m} onEdit={onEdit} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
