import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, localDateKey } from '../lib/db';
import { usePregnancy } from '../lib/hooks';
import { expectedGain, gainBand, pregnancyWeekExact } from '../lib/targets';
import { useSettings } from '../lib/settings';
import { dayLabel } from '../lib/date';
import { useT } from '../i18n';
import { TrashIcon } from '../components/Icons';

const W = 320;
const H = 180;
const PAD = { l: 30, r: 10, t: 10, b: 22 };

export default function Weight() {
  const t = useT();
  const { lang } = useSettings();
  const preg = usePregnancy();
  const entries = useLiveQuery(() => db.weights.orderBy('ts').toArray(), []) ?? [];
  const today = localDateKey();
  const todayEntry = entries.find((e) => e.date === today);
  const [input, setInput] = useState('');
  const profile = preg.profile && preg.week !== null && preg.profile.prePregnancyKg > 0 && preg.profile.heightCm > 0 ? preg.profile : null;

  async function save() {
    const kg = Math.round(Number(input) * 10) / 10;
    if (!Number.isFinite(kg) || kg <= 0) return;
    if (todayEntry) await db.weights.update(todayEntry.id, { kg, ts: Date.now() });
    else await db.weights.add({ date: today, ts: Date.now(), kg });
    setInput('');
  }

  // Chart data: gain (kg) by pregnancy week
  const band = profile ? gainBand(profile) : null;
  const maxWeek = 40;
  const points = profile
    ? entries
        .map((e) => ({ e, week: pregnancyWeekExact(profile.dueDate, e.ts), gain: e.kg - profile.prePregnancyKg }))
        .filter((p): p is { e: (typeof entries)[number]; week: number; gain: number } => p.week !== null)
        .map((p) => ({ ...p, week: Math.min(maxWeek, Math.max(0, p.week)) }))
    : [];
  const yMin = Math.min(-1, ...points.map((p) => p.gain)) - 0.5;
  const yMax = Math.max(band ? band.totalMax : 0, ...points.map((p) => p.gain)) + 1;
  const x = (week: number) => PAD.l + ((W - PAD.l - PAD.r) * week) / maxWeek;
  const y = (gain: number) => PAD.t + ((H - PAD.t - PAD.b) * (yMax - gain)) / (yMax - yMin);
  const bandPath = profile
    ? (() => {
        const weeks = Array.from({ length: maxWeek + 1 }, (_, i) => i);
        const top = weeks.map((w) => `${x(w).toFixed(1)},${y(expectedGain(profile, w).max).toFixed(1)}`);
        const bottom = weeks
          .slice()
          .reverse()
          .map((w) => `${x(w).toFixed(1)},${y(expectedGain(profile, w).min).toFixed(1)}`);
        return `M${top.join(' L')} L${bottom.join(' L')} Z`;
      })()
    : '';
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.week).toFixed(1)},${y(p.gain).toFixed(1)}`).join(' ');

  return (
    <div className="px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 112px)' }}>
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{t('tab.weight')}</h1>
        {profile && (
          <p className="text-sm font-medium text-accent">
            {t('today.week', { w: preg.week! })}
          </p>
        )}
      </div>

      <section className="mt-4 rounded-3xl bg-card p-5">
        <p className="text-sm text-muted">{t('weight.today')}</p>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex flex-1 items-baseline gap-1 rounded-2xl bg-bg px-4">
            <input
              type="number"
              inputMode="decimal"
              step={0.1}
              min={0}
              placeholder={todayEntry ? String(todayEntry.kg) : profile ? String(profile.prePregnancyKg) : '60'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-full bg-transparent py-3 text-xl tabular-nums outline-none placeholder:text-muted"
            />
            <span className="text-sm text-muted">kg</span>
          </div>
          <button type="button" onClick={() => void save()} disabled={!input} className="rounded-full bg-accent px-5 py-3 font-medium text-on-accent disabled:opacity-40">
            {t('weight.save')}
          </button>
        </div>
        {profile && band && (
          <p className="mt-3 text-xs text-muted">
            {t('weight.pre', { kg: profile.prePregnancyKg })} · {t('weight.total', { min: band.totalMin, max: band.totalMax })}
          </p>
        )}
      </section>

      <section className="mt-4 rounded-3xl bg-card p-5">
        <h2 className="font-medium">{t('weight.chart')}</h2>
        {!profile ? (
          <p className="mt-2 text-sm text-muted">{t('weight.noProfile')}</p>
        ) : points.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('weight.empty')}</p>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={t('weight.chart')}>
              <path d={bandPath} className="fill-accent/15" />
              {[0, 10, 20, 30, 40].map((w) => (
                <g key={w}>
                  <line x1={x(w)} x2={x(w)} y1={PAD.t} y2={H - PAD.b} className="stroke-line" strokeWidth={0.5} />
                  <text x={x(w)} y={H - 6} textAnchor="middle" className="fill-muted" fontSize={12}>
                    {w}
                  </text>
                </g>
              ))}
              {[0, 5, 10, 15].filter((g) => g <= yMax && g >= yMin).map((g) => (
                <text key={g} x={PAD.l - 6} y={y(g) + 4} textAnchor="end" className="fill-muted" fontSize={12}>
                  {g > 0 ? `+${g}` : g}
                </text>
              ))}
              <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="stroke-muted" strokeWidth={0.5} strokeDasharray="3 3" />
              <path d={linePath} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {points.map((p) => (
                <circle key={p.e.id} cx={x(p.week)} cy={y(p.gain)} r={3} className="fill-accent" />
              ))}
            </svg>
            <p className="mt-1 text-xs text-muted">{t('weight.band')}</p>
          </>
        )}
      </section>

      {entries.length > 0 && (
        <section className="mt-4 divide-y divide-line rounded-3xl bg-card">
          {entries
            .slice()
            .reverse()
            .slice(0, 30)
            .map((e) => (
              <div key={e.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-muted">{dayLabel(e.date, lang)}</span>
                <span className="flex items-center gap-3 tabular-nums">
                  {e.kg} kg
                  <button type="button" aria-label={t('weight.delete')} onClick={() => void db.weights.delete(e.id)} className="p-1 text-muted">
                    <TrashIcon width={16} height={16} />
                  </button>
                </span>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
