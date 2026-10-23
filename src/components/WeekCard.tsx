import { useEffect, useRef, useState } from 'react';
import { ApiError, weeklySummary } from '../lib/api';
import { localDateKey } from '../lib/db';
import { addDays, parseDateKey, weekStartOf } from '../lib/date';
import { fmt } from '../lib/nutrients';
import { pregnancyFor } from '../lib/hooks';
import { MOODS } from '../lib/moods';
import { gdmLimit, useSettings } from '../lib/settings';
import { DISPLAY_ORDER, PRIORITY } from '../lib/targets';
import { useWeekStats } from '../lib/week';
import { loadWeekly, markWeeklyAttempted, saveWeekly, wasWeeklyAttempted, type WeeklyText } from '../lib/weekly';
import { useT, type Lang } from '../i18n';
import NutrientBar from './NutrientBar';
import { ChevronIcon } from './Icons';

function rangeLabel(start: string, end: string, lang: Lang): string {
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const a = parseDateKey(start);
  const b = parseDateKey(end);
  const sameYear = a.getFullYear() === new Date().getFullYear() && b.getFullYear() === a.getFullYear();
  const opts: Intl.DateTimeFormatOptions = { month: lang === 'zh' ? 'long' : 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) };
  return `${a.toLocaleDateString(locale, opts)} – ${b.toLocaleDateString(locale, opts)}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0';
}

/** One Monday-to-Sunday week: intake against targets, weight, mood, and a short written summary from the Worker. */
export default function WeekCard({ start, onChange }: { start: string; onChange: (start: string) => void }) {
  const t = useT();
  const settings = useSettings();
  const { lang, passcode, gdm } = settings;
  const stats = useWeekStats(start);
  const prev = useWeekStats(addDays(start, -7));
  // Targets and priorities as they stood in the week shown: an earlier week may fall in an earlier trimester.
  const preg = pregnancyFor(settings, Math.min(Date.now(), parseDateKey(stats.end).getTime()));
  const thisWeek = weekStartOf(localDateKey());
  const isThis = start === thisWeek;
  const isLast = start === addDays(thisWeek, -7);
  const [showAll, setShowAll] = useState(false);
  const [text, setText] = useState<WeeklyText | null>(() => loadWeekly(start));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    setText(loadWeekly(start));
    setError('');
    setBusy(false);
  }, [start]);

  async function generate() {
    if (busy || stats.loggedDays === 0) return;
    const s = start;
    setBusy(true);
    setError('');
    try {
      const targets: Partial<Record<string, number>> = {};
      for (const tg of preg.targets) targets[tg.key] = tg.value;
      const moods = stats.moods;
      const r = await weeklySummary({
        lang,
        passcode,
        week: preg.week,
        range: { start: stats.start, end: stats.end },
        complete: stats.complete,
        daysElapsed: stats.daysElapsed,
        loggedDays: stats.loggedDays,
        mealsCount: stats.mealsCount,
        avg: stats.avg,
        caffeineMax: stats.caffeineMax,
        targets,
        prev: prev.loggedDays > 0 ? { loggedDays: prev.loggedDays, avg: prev.avg } : null,
        weight: stats.weight && stats.weight.entries >= 2 ? { start: stats.weight.start, end: stats.weight.end } : null,
        moodAvg: moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null,
        moodLow: moods.filter((m) => m <= 2).length,
        moodNotes: stats.moodTexts.slice(-5),
        warnings: stats.warnings.slice(0, 4),
        gdm: gdm.enabled ? { mainCarbs: gdmLimit(gdm, 'main'), snackCarbs: gdmLimit(gdm, 'snack') } : null,
      });
      const saved = { ...r, lang, loggedDays: stats.loggedDays, mealsCount: stats.mealsCount, complete: stats.complete };
      saveWeekly(s, saved);
      if (startRef.current === s) setText({ ...saved, at: Date.now() });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'server';
      if (startRef.current === s) setError(t(code === 'server' || code === 'refused' ? 'error.generic' : `error.${code}`));
    } finally {
      if (startRef.current === s) setBusy(false);
    }
  }

  // The saved text no longer matches the week (meals added or removed, the week has since ended, the language changed).
  const stale = text === null || text.lang !== lang || text.loggedDays !== stats.loggedDays || text.mealsCount !== stats.mealsCount || (stats.complete && !text.complete);
  // Write the summary once by itself for a finished week with a few days logged; otherwise on request.
  const generateRef = useRef(generate);
  generateRef.current = generate;
  const autoKey = `${start}|${lang}|${stats.loggedDays}|${stats.mealsCount}`;
  const wantAuto = stale && !busy && !error && passcode !== '' && stats.complete && stats.loggedDays >= 2 && !wasWeeklyAttempted(autoKey);
  useEffect(() => {
    if (!wantAuto) return;
    const id = setTimeout(() => {
      markWeeklyAttempted(autoKey);
      void generateRef.current();
    }, 300);
    return () => clearTimeout(id);
  }, [wantAuto, autoKey]);

  const energy = preg.targetOf('energy');
  const keys = showAll ? DISPLAY_ORDER : PRIORITY[preg.trimester];
  const range = rangeLabel(stats.start, stats.end, lang);
  const moodCounts = MOODS.slice()
    .reverse()
    .map((m) => ({ ...m, n: stats.moods.filter((x) => x === m.value).length }))
    .filter((m) => m.n > 0);
  const weightLine = stats.weight ? (stats.weight.entries >= 2 ? t('week.weight', { a: stats.weight.start, b: stats.weight.end }) : t('week.weightOne', { kg: stats.weight.end })) : '';

  return (
    <section className="mt-4 rounded-3xl bg-card px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label={t('week.prev')} onClick={() => onChange(addDays(start, -7))} className="-ml-2 shrink-0 p-2 text-muted">
          <ChevronIcon width={18} height={18} className="rotate-180" />
        </button>
        <div className="min-w-0 text-center">
          <h2 className="font-medium">{isThis ? t('week.this') : isLast ? t('week.last') : range}</h2>
          <p className="text-xs text-muted">
            {isThis || isLast ? `${range} · ` : ''}
            {stats.loggedDays === 0 ? t('week.none') : `${t(stats.loggedDays === 1 ? 'week.day' : 'week.days', { n: stats.loggedDays })} · ${t(stats.mealsCount === 1 ? 'history.meal' : 'history.meals', { n: stats.mealsCount })}`}
          </p>
        </div>
        <button type="button" aria-label={t('week.next')} disabled={isThis} onClick={() => onChange(addDays(start, 7))} className="-mr-2 shrink-0 p-2 text-muted disabled:opacity-30">
          <ChevronIcon width={18} height={18} />
        </button>
      </div>

      {stats.loggedDays > 0 && (
        <>
          {energy && (
            <p className="mt-3 text-sm text-muted">
              {t('n.energy')} <span className="tabular-nums text-ink">{fmt('energy', stats.avg.energy)}</span> / {energy.value} {t('kcal')}
              {prev.loggedDays > 0 && <span className="tabular-nums"> · {t('week.vsLast', { d: signed(Math.round(stats.avg.energy - prev.avg.energy)) })}</span>}
            </p>
          )}
          <div className="mt-1 divide-y divide-line">
            {keys.map((k) => {
              const tg = preg.targetOf(k);
              return tg ? <NutrientBar key={k} target={tg} value={stats.avg[k]} compact /> : null;
            })}
          </div>
          <button type="button" onClick={() => setShowAll((v) => !v)} className="py-1 text-sm text-accent">
            {showAll ? t('today.less') : t('today.all')}
          </button>
          {(weightLine || moodCounts.length > 0) && (
            <p className="mt-2 text-xs text-muted">
              {weightLine && <span className="tabular-nums">{weightLine}</span>}
              {weightLine && moodCounts.length > 0 && ' · '}
              {moodCounts.map((m) => `${m.emoji} ${m.n}`).join(' ')}
            </p>
          )}

          <div className="mt-4 rounded-2xl bg-accent-soft px-4 py-3">
            {text ? (
              <>
                {text.headline && <p className="font-medium text-accent">{text.headline}</p>}
                {text.summary && <p className={`text-sm leading-relaxed ${text.headline ? 'mt-1' : ''}`}>{text.summary}</p>}
                {text.focus.length > 0 && (
                  <>
                    <p className="mt-2 text-xs font-medium text-accent">{t('week.focus')}</p>
                    <ul className="mt-1 space-y-1 text-sm leading-relaxed">
                      {text.focus.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">{stale && !busy ? t('week.stale') : t('today.recsNote')}</span>
                  <button type="button" onClick={() => void generate()} disabled={busy} className="-my-1 -mr-2 shrink-0 rounded-full px-3 py-1.5 text-xs text-accent disabled:opacity-60">
                    {busy ? t('week.generating') : t('week.regenerate')}
                  </button>
                </div>
                {error && <p className="mt-1 text-xs text-warn">{error}</p>}
              </>
            ) : busy ? (
              <p className="text-sm text-muted">{t('week.generating')}</p>
            ) : error ? (
              <p className="text-xs text-warn">
                {error}{' '}
                <button type="button" onClick={() => void generate()} className="underline">
                  {t('analyze.retry')}
                </button>
              </p>
            ) : (
              <button type="button" disabled={passcode === ''} onClick={() => void generate()} className="w-full py-1 text-center text-sm text-accent disabled:opacity-40">
                {t('week.generate')}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
