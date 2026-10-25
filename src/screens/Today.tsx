import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, localDateKey, type Meal } from '../lib/db';
import { fmt } from '../lib/nutrients';
import { addNote, deleteNote, setSupplementTaken, updateNote, useDay, useDayNotes, usePregnancy, useWeekAverage } from '../lib/hooks';
import { DISPLAY_ORDER, PRIORITY, expectedGain } from '../lib/targets';
import { gdmLimit, useSettings } from '../lib/settings';
import { ApiError, recommend, type Recommendation } from '../lib/api';
import { loadRecs, markAttempted, saveRecs, slotKeyOf, slotOfKey, wasAttempted } from '../lib/recs';
import { MOODS } from '../lib/moods';
import { TIPS } from '../lib/tips';
import { useT, type TKey } from '../i18n';
import AddMealSheet from '../components/AddMealSheet';
import MealRow from '../components/MealRow';
import NutrientBar from '../components/NutrientBar';
import { AlertIcon, CheckIcon, PhotoIcon, XIcon } from '../components/Icons';
import { timeKey, timeLabel } from '../lib/date';

interface Props {
  onPick: (f: File) => void;
  onText: (text: string) => void;
  onEdit: (meal: Meal) => void;
  onOpenSettings: () => void;
}

/** The current day and the meal coming up, kept fresh while the app stays open. */
function nowState() {
  return { date: localDateKey(), key: slotKeyOf() };
}

export default function Today({ onPick, onText, onEdit, onOpenSettings }: Props) {
  const t = useT();
  const { lang, passcode, gdm } = useSettings();
  const preg = usePregnancy();
  const [now, setNow] = useState(nowState);
  const [showAll, setShowAll] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [text, setText] = useState('');
  const [recs, setRecs] = useState<Recommendation[] | null>(() => {
    const n = nowState();
    return loadRecs(n.date, n.key);
  });
  const [recsBusy, setRecsBusy] = useState(false);
  const [recsError, setRecsError] = useState('');
  const [draft, setDraft] = useState<{ id: number; text: string } | null>(null);
  const [noteFocus, setNoteFocus] = useState(false);
  const [freshNoteId, setFreshNoteId] = useState<number | null>(null);
  const today = now.date;
  const key = now.key;
  const slot = slotOfKey(key);
  const nowRef = useRef(now);
  nowRef.current = now;

  // Keep "today" and the meal slot current when the app is resumed after midnight or left open.
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState !== 'visible') return;
      setNow((n) => {
        const next = nowState();
        return next.date === n.date && next.key === n.key ? n : next;
      });
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
  const notes = useDayNotes(today);
  const latest = notes.length ? notes[notes.length - 1] : null;
  const anyRough = notes.some((n) => n.mood === 1);
  const week = useWeekAverage(true);
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

  async function fetchRecs(previous: Recommendation[] | null) {
    if (recsBusy) return;
    const at = now;
    // Only show the answer if the day and meal are still the ones it was asked for.
    const current = () => nowRef.current.date === at.date && nowRef.current.key === at.key;
    setRecsBusy(true);
    setRecsError('');
    try {
      const targets: Partial<Record<string, number>> = {};
      for (const tg of preg.targets) targets[tg.key] = tg.value;
      const items = await recommend({
        lang,
        passcode,
        week: preg.week,
        trimester: preg.week === null ? null : preg.trimester,
        avg7: week.loggedDays > 0 ? week.avg : null,
        avgDays: week.loggedDays,
        totals: day.totals,
        targets,
        meals: day.meals.map((m) => `${timeKey(m.ts)} ${m.summary || m.items.map((i) => i.name).join(', ')}`),
        previous: previous?.map((r) => r.name) ?? [],
        hour: new Date().getHours(),
        slot,
        mood: latest?.mood ?? null,
        moodText: notes
          .slice()
          .reverse()
          .map((n) => n.text.trim())
          .filter(Boolean)
          .join('；')
          .slice(0, 200),
        gdm: gdm.enabled ? { mainCarbs: gdmLimit(gdm, 'main'), snackCarbs: gdmLimit(gdm, 'snack') } : null,
      });
      if (items.length) {
        saveRecs(at.date, at.key, items);
        if (current()) setRecs(items);
      } else if (current()) {
        setRecsError(t('error.generic'));
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'server';
      if (current()) setRecsError(t(code === 'server' || code === 'refused' ? 'error.generic' : `error.${code}`));
    } finally {
      setRecsBusy(false);
    }
  }

  // One automatic fetch per meal slot, once something is known about today (a meal or a mood) and no note is being typed;
  // otherwise a button, so ideas asked for before anything is logged are her choice.
  const fetchRecsRef = useRef(fetchRecs);
  fetchRecsRef.current = fetchRecs;
  const haveToday = day.meals.length > 0 || notes.length > 0;
  const idle = recs === null && !recsBusy && !recsError && passcode !== '';
  const wantRecs = idle && haveToday && !wasAttempted(today, key) && !noteFocus && draft === null;
  const showAsk = idle && (!haveToday || wasAttempted(today, key));
  useEffect(() => {
    if (!wantRecs) return;
    // A little longer after a mood tap, so a note typed right after it is included.
    const id = setTimeout(
      () => {
        markAttempted(today, key);
        void fetchRecsRef.current(null);
      },
      day.meals.length ? 400 : 3000,
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantRecs, latest?.ts, today, key]);

  useEffect(() => {
    setRecs(loadRecs(today, key));
    setRecsError('');
  }, [today, key]);

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
        <h2 className="font-medium">{t('today.mood')}</h2>
        <p className="text-xs text-muted">{t('today.moodHint')}</p>
        <div className="mt-2 flex justify-between">
          {MOODS.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-label={t(`mood.${m.value}`)}
              onClick={() => {
                void addNote(today, m.value).then((id) => {
                  setFreshNoteId(id);
                  setDraft({ id, text: '' });
                });
              }}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-bg text-2xl active:scale-95"
            >
              {m.emoji}
            </button>
          ))}
        </div>
        {notes.length > 0 && (
          <ul className="mt-3 space-y-2">
            {notes.map((n) => {
              const editing = draft?.id === n.id;
              return (
                <li key={n.id} className="flex items-center gap-2 rounded-2xl bg-bg px-3 py-2">
                  <span className="text-xl">{MOODS.find((m) => m.value === n.mood)?.emoji}</span>
                  <span className="w-11 shrink-0 text-xs tabular-nums text-muted">{timeLabel(n.ts, lang)}</span>
                  <input
                    type="text"
                    autoFocus={freshNoteId === n.id}
                    value={editing ? draft.text : n.text}
                    placeholder={t('today.moodPlaceholder')}
                    onFocus={() => {
                      setNoteFocus(true);
                      setDraft({ id: n.id, text: n.text });
                    }}
                    onChange={(e) => setDraft({ id: n.id, text: e.target.value.slice(0, 200) })}
                    onBlur={() => {
                      if (editing && draft.text.trim() !== n.text) void updateNote(n.id, { text: draft.text.trim() });
                      setDraft(null);
                      setNoteFocus(false);
                      if (freshNoteId === n.id) setFreshNoteId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    enterKeyHint="done"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
                  />
                  <button type="button" aria-label={t('note.delete')} onClick={() => void deleteNote(n.id)} className="-mr-1 p-1.5 text-muted">
                    <XIcon width={14} height={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {anyRough && <p className="mt-2 text-xs leading-relaxed text-muted">{t('today.moodCare')}</p>}
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

      {(recs || recsBusy || recsError || showAsk) && (
        <section className="mt-4 rounded-3xl bg-accent-soft px-5 py-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium text-accent">{t(`recs.${slot}` as TKey)}</h2>
            {recs && (
              <button type="button" onClick={() => void fetchRecs(recs)} disabled={recsBusy} className="-my-1.5 -mr-2 rounded-full px-3 py-2 text-sm text-accent disabled:opacity-60">
                {recsBusy ? t('today.recsLoading') : t('today.recsMore')}
              </button>
            )}
          </div>
          {recs ? (
            <ul className="mt-2 space-y-2">
              {recs.map((r, i) => (
                <li key={i} className="text-sm leading-relaxed">
                  <span className="font-medium text-accent">{r.name}</span>
                  <span className="text-muted"> · {r.reason}</span>
                </li>
              ))}
            </ul>
          ) : recsBusy ? (
            <p className="mt-2 text-sm text-muted">{t('today.recsLoading')}</p>
          ) : showAsk ? (
            <button type="button" onClick={() => void fetchRecs(null)} className="mt-2 rounded-full bg-card px-4 py-2 text-sm text-accent">
              {t('today.recsAsk')}
            </button>
          ) : null}
          {recsError && (
            <p className="mt-2 text-xs text-warn">
              {recsError}{' '}
              <button type="button" onClick={() => void fetchRecs(recs)} className="underline">
                {t('analyze.retry')}
              </button>
            </p>
          )}
          {recs && <p className="mt-2 text-xs text-muted">{t('today.recsNote')}</p>}
        </section>
      )}

      <section className="mt-4 space-y-2">
        {day.meals.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-line px-5 py-8 text-center">
            <p className="font-medium">{t('today.empty')}</p>
            <p className="mt-1 text-sm text-muted">{t('today.emptyHint')}</p>
          </div>
        ) : (
          day.meals.map((m) => <MealRow key={m.id} meal={m} onEdit={onEdit} />)
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
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-bg/80 px-2 text-xs text-muted backdrop-blur">
          <button type="button" onClick={() => pickRef.current?.click()} className="px-1 py-2.5">
            {t('today.pick')}
          </button>
          <span className="text-line">|</span>
          <button type="button" onClick={() => setSheetOpen(true)} className="px-1 py-2.5 text-accent">
            {t('today.text')}
          </button>
        </div>
      </div>

      {sheetOpen && (
        <AddMealSheet
          title={t('text.title')}
          initialMode="text"
          draft={text}
          onDraftChange={setText}
          onClose={() => setSheetOpen(false)}
          onText={(v) => {
            setText('');
            onText(v);
          }}
        />
      )}
    </div>
  );
}
