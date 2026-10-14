import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, localDateKey } from '../lib/db';
import { totals } from '../lib/nutrition';
import { useSettings } from '../lib/settings';
import { useT } from '../i18n';
import MealRow from '../components/MealRow';
import { CameraIcon } from '../components/Icons';

export default function Today({ onPick }: { onPick: (f: File) => void }) {
  const t = useT();
  const { lang, target } = useSettings();
  const [today, setToday] = useState(localDateKey);

  // Keep "today" current when the app is resumed after midnight or left open.
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === 'visible') setToday(localDateKey());
    };
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    const id = setInterval(sync, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      clearInterval(id);
    };
  }, []);

  const meals = useLiveQuery(() => db.meals.where('date').equals(today).sortBy('ts'), [today]) ?? [];
  const tot = totals(meals.flatMap((m) => m.items));
  const left = target - tot.calories;
  const pct = target > 0 ? Math.min(100, (tot.calories / target) * 100) : 0;
  const over = left < 0;

  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);

  function handle(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onPick(f);
  }

  return (
    <div className="px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 192px)' }}>
      <p className="text-sm text-muted">{new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric', weekday: 'long' })}</p>

      <section className="mt-4 rounded-3xl bg-card p-5">
        <div className="flex items-baseline gap-2">
          <span className="text-5xl font-semibold tabular-nums tracking-tight">{tot.calories}</span>
          <span className="text-sm text-muted">/ {target} {t('kcal')}</span>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line">
          <div className={`h-full rounded-full transition-[width] ${over ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className={`mt-3 text-sm ${over ? 'text-warn' : 'text-muted'}`}>{over ? t('today.over', { n: -left }) : t('today.left', { n: left })}</p>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {(
            [
              ['protein', tot.protein],
              ['carbs', tot.carbs],
              ['fat', tot.fat],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-bg px-3 py-2.5">
              <p className="text-xs text-muted">{t(k)}</p>
              <p className="mt-0.5 tabular-nums">
                {v}
                <span className="text-xs text-muted">{t('g')}</span>
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 space-y-2">
        {meals.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-line px-5 py-10 text-center">
            <p className="font-medium">{t('today.empty')}</p>
            <p className="mt-1 text-sm text-muted">{t('today.emptyHint')}</p>
          </div>
        ) : (
          meals.map((m) => <MealRow key={m.id} meal={m} />)
        )}
      </section>

      <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={handle} hidden />
      <input ref={libRef} type="file" accept="image/*" onChange={handle} hidden />

      <div className="pointer-events-none fixed inset-x-0 z-10 flex flex-col items-center gap-2" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}>
        <button
          type="button"
          onClick={() => camRef.current?.click()}
          aria-label={t('today.snap')}
          className="pointer-events-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg shadow-accent/30 active:scale-95"
        >
          <CameraIcon width={28} height={28} strokeWidth={2} />
        </button>
        <button type="button" onClick={() => libRef.current?.click()} className="pointer-events-auto rounded-full bg-bg/80 px-3 py-1.5 text-xs text-muted backdrop-blur">
          {t('today.library')}
        </button>
      </div>
    </div>
  );
}
