import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, localDateKey } from '../lib/db';
import { fmt } from '../lib/nutrients';
import { setSupplementTaken, useDay, usePregnancy } from '../lib/hooks';
import { DISPLAY_ORDER, PRIORITY, expectedGain } from '../lib/targets';
import { useSettings } from '../lib/settings';
import { ApiError, suggestNext } from '../lib/api';
import { TIPS } from '../lib/tips';
import { useT } from '../i18n';
import MealRow from '../components/MealRow';
import NutrientBar from '../components/NutrientBar';
import { AlertIcon, CheckIcon, PhotoIcon, SparkIcon } from '../components/Icons';

export default function Today({ onPick, onOpenSettings }: { onPick: (f: File) => void; onOpenSettings: () => void }) {
  const t = useT();
  const { lang, passcode } = useSettings();
  const preg = usePregnancy();
  const [today, setToday] = useState(localDateKey);
  const [showAll, setShowAll] = useState(false);
  const [suggestion, setSuggestion] = useState<{ text: string } | { error: string } | null>(null);
  const [suggesting, setSuggesting] = useState(false);

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

  const day = useDay(today);
  const latestWeight = useLiveQuery(() => db.weights.orderBy('ts').last(), []);
  const energy = preg.targetOf('energy');
  const target = energy?.value ?? 0;
  const eaten = day.totals.energy;
  const left = target - eaten;
  const pct = target > 0 ? Math.min(100, (eaten / target) * 100) : 0;
  const over = left < 0;
  const keys = showAll ? DISPLAY_ORDER : PRIORITY[preg.trimester];
  const profileOk = preg.profile && preg.week !== null;
  const full = profileOk && preg.profile!.prePregnancyKg > 0 && preg.profile!.heightCm > 0;
  const gain = full && latestWeight ? latestWeight.kg - preg.profile!.prePregnancyKg : null;
  const band = full ? expectedGain(preg.profile!, preg.week!) : null;

  const pickRef = useRef<HTMLInputElement>(null);

  function handle(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onPick(f);
  }

  async function suggest() {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestion(null);
    try {
      const targets: Partial<Record<string, number>> = {};
      for (const tg of preg.targets) targets[tg.key] = tg.value;
      const text = await suggestNext({
        lang,
        passcode,
        week: preg.week,
        trimester: preg.week === null ? null : preg.trimester,
        totals: day.totals,
        targets,
        meals: day.meals.map((m) => m.summary || m.items.map((i) => i.name).join(', ')),
        hour: new Date().getHours(),
      });
      setSuggestion({ text });
    } catch (e) {
      setSuggestion({ error: t(`error.${e instanceof ApiError ? e.code : 'server'}`) });
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div className="px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 192px)' }}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted">{new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric', weekday: 'long' })}</p>
        {profileOk && (
          <p className="shrink-0 text-sm font-medium text-accent">
            {t('today.week', { w: preg.week! })} · {t(`tri.${preg.trimester}`)}
          </p>
        )}
      </div>
      {!profileOk && <p className="mt-2 text-xs text-muted">{t('today.noProfile')}</p>}

      <section className="mt-4 rounded-3xl bg-card p-5">
        <div className="flex items-baseline gap-2">
          <span className="text-5xl font-semibold tabular-nums tracking-tight">{fmt('energy', eaten)}</span>
          <span className="text-sm text-muted">/ {target} {t('kcal')}</span>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-sm text-muted">{over ? t('today.over', { n: Math.round(-left) }) : t('today.left', { n: Math.round(left) })}</p>
        {gain !== null && band && (
          <p className="mt-2 text-xs text-muted">
            {gain < 0 ? t('today.weightLoss', { kg: latestWeight!.kg, n: (-gain).toFixed(1) }) : t('today.weightLine', { kg: latestWeight!.kg, gain: gain.toFixed(1) })} · {t('today.weightBand', { min: band.min.toFixed(1), max: band.max.toFixed(1) })}
          </p>
        )}
      </section>

      <section className="mt-4 rounded-3xl bg-card px-5 py-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">{t('today.progress')}</h2>
          <button type="button" onClick={() => setShowAll((v) => !v)} className="py-1 text-sm text-accent">
            {showAll ? t('today.less') : t('today.all')}
          </button>
        </div>
        {!showAll && <p className="text-xs text-muted">{t('today.focus')}</p>}
        <div className="mt-1 divide-y divide-line">
          {keys.map((k) => {
            const tg = preg.targetOf(k);
            return tg ? <NutrientBar key={k} target={tg} value={day.totals[k]} /> : null;
          })}
        </div>
        {profileOk && <p className="mt-3 text-xs leading-relaxed text-muted">{TIPS[lang][preg.trimester]}</p>}
      </section>

      {day.supplements.length === 0 ? (
        <button type="button" onClick={onOpenSettings} className="mt-3 w-full py-1 text-center text-xs text-muted">
          {t('today.addSupps')}
        </button>
      ) : (
        <section className="mt-4 rounded-3xl bg-card px-5 py-4">
          <h2 className="font-medium">{t('today.supplements')}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {day.supplements.map((s) => {
              const on = day.takenIds.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => void setSupplementTaken(today, s.id, !on)}
                  aria-pressed={on}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm ${on ? 'bg-accent-soft text-accent' : 'bg-bg text-muted'}`}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${on ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}>
                    {on && <CheckIcon width={12} height={12} strokeWidth={3} />}
                  </span>
                  {s.name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {day.warnings.length > 0 && (
        <section className="mt-4 rounded-3xl bg-warn/10 px-5 py-4">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-warn">
            <AlertIcon width={16} height={16} /> {t('today.safety')}
          </h2>
          <ul className="mt-1.5 space-y-1 text-sm">
            {day.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-4">
        {suggestion && 'text' in suggestion ? (
          <div className="rounded-3xl bg-accent-soft px-5 py-4">
            <p className="text-sm leading-relaxed text-accent">{suggestion.text}</p>
            <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-muted">
              <span>{t('today.suggestNote')}</span>
              <button type="button" onClick={() => void suggest()} disabled={suggesting} className="shrink-0 py-1 text-accent disabled:opacity-60">
                {suggesting ? t('today.suggesting') : t('today.suggestAgain')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void suggest()}
            disabled={suggesting}
            className="flex w-full items-center justify-center gap-2 rounded-3xl border border-dashed border-line py-3 text-sm text-accent disabled:opacity-60"
          >
            <SparkIcon width={16} height={16} /> {suggesting ? t('today.suggesting') : t('today.suggest')}
          </button>
        )}
        {suggestion && 'error' in suggestion && <p className="mt-2 text-center text-xs text-warn">{suggestion.error}</p>}
      </section>

      <section className="mt-4 space-y-2">
        {day.meals.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-line px-5 py-8 text-center">
            <p className="font-medium">{t('today.empty')}</p>
            <p className="mt-1 text-sm text-muted">{t('today.emptyHint')}</p>
          </div>
        ) : (
          day.meals.map((m) => <MealRow key={m.id} meal={m} />)
        )}
      </section>

      <input ref={pickRef} type="file" accept="image/*" onChange={handle} hidden />

      <div className="pointer-events-none fixed inset-x-0 z-10 flex flex-col items-center gap-2" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}>
        <button
          type="button"
          onClick={() => pickRef.current?.click()}
          aria-label={t('today.pick')}
          className="pointer-events-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg shadow-accent/30 active:scale-95"
        >
          <PhotoIcon width={28} height={28} strokeWidth={2} />
        </button>
        <span className="rounded-full bg-bg/80 px-3 py-1 text-xs text-muted backdrop-blur">{t('today.pick')}</span>
      </div>
    </div>
  );
}
