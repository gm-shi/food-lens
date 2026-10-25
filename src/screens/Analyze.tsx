import { useEffect, useRef, useState } from 'react';
import { analyzeMeal, ApiError, estimateItem, type ApiErrorCode, type MealSource } from '../lib/api';
import { prepareImage, type PreparedImage } from '../lib/image';
import { db, localDateKey, type AmountUnit, type FoodItem, type Meal } from '../lib/db';
import { hasSubstance, rescale, totals } from '../lib/nutrition';
import { fmt } from '../lib/nutrients';
import { usePregnancy } from '../lib/hooks';
import { gdmLimit, updateSettings, useSettings } from '../lib/settings';
import { useT } from '../i18n';
import { dayLabel, timeKey, timeLabel, timestampOf } from '../lib/date';
import { AlertIcon, MinusIcon, PlusIcon, XIcon } from '../components/Icons';

/** A new meal may name the day it is for (adding to an earlier day from History); the default is today. */
export type MealInput = { kind: 'photo'; file: File; date?: string } | { kind: 'text'; text: string; date?: string } | { kind: 'edit'; meal: Meal };

/** Told to the caller when a meal was saved: the day it went to. */
export interface SavedMeal {
  date: string;
}

type Phase =
  | { kind: 'preparing' }
  | { kind: 'loading' }
  | { kind: 'result'; basis: FoodItem[]; items: FoodItem[]; summary: string; isFood: boolean; warnings: string[] }
  | { kind: 'error'; code: ApiErrorCode | 'image' };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export default function Analyze({ input, onClose }: { input: MealInput; onClose: (saved?: SavedMeal) => void }) {
  const t = useT();
  const { lang, passcode, gdm } = useSettings();
  const preg = usePregnancy();
  const editing = input.kind === 'edit' ? input.meal : null;
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [phase, setPhase] = useState<Phase>(() =>
    editing ? { kind: 'result', basis: editing.items, items: editing.items, summary: editing.summary, isFood: editing.items.length > 0, warnings: editing.warnings ?? [] } : { kind: 'preparing' },
  );
  const [note, setNote] = useState(editing?.note ?? '');
  const [noteOpen, setNoteOpen] = useState(false);
  const [mealKind, setMealKind] = useState<'main' | 'snack'>(editing?.kind === 'snack' ? 'snack' : 'main');
  // The day and time the meal is logged to: now by default, so yesterday's forgotten dinner can be added today.
  const preset = input.kind === 'edit' ? null : (input.date ?? null);
  const [when, setWhen] = useState(() => ({ date: editing ? editing.date : (preset ?? localDateKey()), time: timeKey(editing ? editing.ts : Date.now()) }));
  // `fromNow`: a new meal for today is stamped with the moment it is saved unless the row is touched.
  const initialWhen = useRef({ ...when, fromNow: !editing && (preset === null || preset === localDateKey()) });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [renaming, setRenaming] = useState<{ idx: number; value: string } | null>(null);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [itemError, setItemError] = useState<{ idx: number; text: string } | null>(null);
  const [adding, setAdding] = useState<{ value: string; busy: boolean; error: string } | null>(null);
  const alive = useRef(true);
  const passcodeRef = useRef(passcode);
  passcodeRef.current = passcode;
  const trimesterRef = useRef(preg.week === null ? null : preg.trimester);
  trimesterRef.current = preg.week === null ? null : preg.trimester;
  const sourceRef = useRef<MealSource | null>(input.kind === 'text' ? { kind: 'text', text: input.text } : null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function run(userNote: string) {
    const source = sourceRef.current;
    if (!source) return;
    setPhase({ kind: 'loading' });
    try {
      const a = await analyzeMeal({ source, lang, note: userNote, passcode: passcodeRef.current, trimester: trimesterRef.current });
      if (!alive.current) return;
      setPhase({ kind: 'result', basis: a.items, items: a.items, summary: a.summary, isFood: a.is_food, warnings: a.warnings });
    } catch (e) {
      if (!alive.current) return;
      setPhase({ kind: 'error', code: e instanceof ApiError ? e.code : 'server' });
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (input.kind === 'edit') return;
    if (input.kind === 'text') {
      // Deferred so the StrictMode cleanup can cancel the duplicate run.
      const id = setTimeout(() => void run(''), 0);
      return () => clearTimeout(id);
    }
    prepareImage(input.file)
      .then((p) => {
        if (cancelled) return;
        setImg(p);
        sourceRef.current = { kind: 'photo', base64: p.base64, mediaType: p.mediaType };
        void run('');
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: 'error', code: 'image' });
      });
    return () => {
      cancelled = true;
    };
  }, [input]);

  function setGrams(idx: number, grams: number) {
    if (phase.kind !== 'result') return;
    const items = phase.items.map((it, i) => (i === idx ? rescale(phase.basis[i], grams) : it));
    setPhase({ ...phase, items });
  }

  /** Switch an item between grams and millilitres; the amount and nutrients stay as they are. */
  function setUnit(idx: number, unit: AmountUnit) {
    if (phase.kind !== 'result') return;
    const patch = (it: FoodItem, i: number): FoodItem => {
      if (i !== idx) return it;
      const { unit: _old, ...rest } = it;
      return unit === 'ml' ? { ...rest, unit } : rest;
    };
    setPhase({ ...phase, items: phase.items.map(patch), basis: phase.basis.map(patch) });
  }

  function removeItem(idx: number) {
    if (phase.kind !== 'result') return;
    setPhase({ ...phase, items: phase.items.filter((_, i) => i !== idx), basis: phase.basis.filter((_, i) => i !== idx) });
  }

  function markBusy(idx: number, on: boolean) {
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(idx);
      else n.delete(idx);
      return n;
    });
  }

  /** Rename an item and re-estimate its nutrients for the new name at the current amount. */
  async function commitRename() {
    if (!renaming || phase.kind !== 'result') return;
    const { idx, value } = renaming;
    setRenaming(null);
    const name = value.trim().slice(0, 60);
    const current = phase.items[idx];
    if (!name || !current || name === current.name) return;
    markBusy(idx, true);
    setItemError(null);
    try {
      const { item: est, warning } = await estimateItem({ name, grams: current.grams || 100, unit: current.unit, lang, passcode: passcodeRef.current });
      if (!alive.current) return;
      const base = current.grams > 0 && est.grams > 0 && est.grams !== current.grams ? rescale(est, current.grams) : est;
      // The amount and unit she set stay; only the name and nutrients come from the estimate.
      const { unit: _estUnit, ...rest } = base;
      const item: FoodItem = current.unit === 'ml' ? { ...rest, name, grams: current.grams || est.grams, unit: 'ml' } : { ...rest, name, grams: current.grams || est.grams };
      setPhase((p) => {
        if (p.kind !== 'result') return p;
        const old = p.items[idx];
        const grams = old?.grams ?? item.grams;
        const scaled = grams > 0 && grams !== item.grams ? rescale(item, grams) : item;
        const summary = p.items.length === 1 || p.summary === current.name ? name : p.summary.includes(current.name) ? p.summary.replaceAll(current.name, name) : p.summary;
        return {
          ...p,
          summary,
          items: p.items.map((it, i) => (i === idx ? scaled : it)),
          basis: p.basis.map((it, i) => (i === idx ? item : it)),
          warnings: warning ? [...new Set([...p.warnings, warning])].slice(0, 4) : p.warnings,
        };
      });
    } catch (e) {
      if (!alive.current) return;
      setItemError({ idx, text: t(`error.${e instanceof ApiError ? e.code : 'server'}`) });
    } finally {
      if (alive.current) markBusy(idx, false);
    }
  }

  async function commitAdd() {
    if (!adding || phase.kind !== 'result') return;
    const name = adding.value.trim().slice(0, 60);
    if (!name) return;
    setAdding({ ...adding, busy: true, error: '' });
    try {
      const { item, warning } = await estimateItem({ name, lang, passcode: passcodeRef.current });
      if (!alive.current) return;
      setPhase((p) => (p.kind === 'result' ? { ...p, items: [...p.items, item], basis: [...p.basis, item], isFood: true, warnings: warning ? [...new Set([...p.warnings, warning])].slice(0, 4) : p.warnings } : p));
      setAdding(null);
    } catch (e) {
      if (!alive.current) return;
      setAdding({ value: adding.value, busy: false, error: t(`error.${e instanceof ApiError ? e.code : 'server'}`) });
    }
  }

  async function save() {
    if (phase.kind !== 'result' || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const items = phase.items.filter(hasSubstance);
      const kind = gdm.enabled ? mealKind : editing?.kind;
      // Untouched day and time: an edited meal keeps its stamp and a new meal for today gets the moment it is saved.
      // Otherwise the chosen minute, plus the current seconds so two meals in one minute never share a timestamp
      // (the backup import tells meals apart by it).
      const untouched = when.date === initialWhen.current.date && when.time === initialWhen.current.time;
      const today = localDateKey();
      let date: string;
      let ts: number;
      if (untouched && editing) {
        ts = editing.ts;
        date = editing.date;
      } else if (untouched && initialWhen.current.fromNow) {
        ts = Date.now();
        date = localDateKey(ts);
      } else {
        date = DATE_KEY.test(when.date) && when.date <= today ? when.date : today;
        ts = timestampOf(date, when.time) + (Date.now() % 60_000);
      }
      if (editing) {
        await db.meals.update(editing.id, { items, summary: phase.summary, note: note.trim(), warnings: phase.warnings, kind, date, ts });
      } else {
        await db.meals.add({
          date,
          ts,
          thumb: img?.thumb ?? '',
          summary: phase.summary,
          note: note.trim(),
          items,
          warnings: phase.warnings,
          kind,
          source: input.kind === 'text' ? 'text' : 'photo',
        });
      }
      onClose({ date });
    } catch {
      if (alive.current) setSaveError(true);
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  const tot = phase.kind === 'result' ? totals(phase.items) : null;
  const canSave = phase.kind === 'result' && phase.items.some(hasSubstance) && busy.size === 0 && !adding?.busy;
  const showSummary = phase.kind === 'result' && phase.summary && !(phase.items.length === 1 && phase.items[0].name === phase.summary);
  const canRetry = phase.kind === 'error' && phase.code !== 'image' && (input.kind === 'text' || img !== null);
  const carbLimit = gdm.enabled ? gdmLimit(gdm, mealKind) : null;
  const carbOver = tot !== null && carbLimit !== null && tot.carbs > carbLimit;
  const todayKey = localDateKey();
  const unitLabel = (it: FoodItem) => (it.unit === 'ml' ? t('ml') : t('g'));

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={() => onClose()} aria-label={t('analyze.cancel')} className="-ml-2 rounded-full p-2 text-muted">
          <XIcon />
        </button>
        <span className="text-sm text-muted">{editing ? `${t('analyze.editTitle')} · ${dayLabel(editing.date, lang)} ${timeLabel(editing.ts, lang)}` : t('appName')}</span>
        <span className="w-9" />
      </header>

      <div className="px-4">
        {input.kind === 'photo' ? (
          <div className="overflow-hidden rounded-3xl bg-line" style={{ aspectRatio: '4 / 3' }}>
            {img && <img src={img.preview} alt="" className="h-full w-full object-cover" />}
          </div>
        ) : input.kind === 'text' ? (
          <div className="rounded-3xl bg-card px-5 py-4">
            <p className="text-xs text-muted">{t('analyze.fromText')}</p>
            <p className="mt-1 text-lg leading-relaxed">{input.text}</p>
          </div>
        ) : editing?.thumb ? (
          <div className="overflow-hidden rounded-3xl bg-line" style={{ aspectRatio: '4 / 3' }}>
            <img src={editing.thumb} alt="" className="h-full w-full object-cover" />
          </div>
        ) : null}
      </div>

      <main className="flex-1 px-4 pt-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 144px)' }}>
        {(phase.kind === 'preparing' || phase.kind === 'loading') && (
          <div className="py-10 text-center">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
            <p className="mt-4 font-medium">{phase.kind === 'preparing' ? t('analyze.preparing') : t('analyze.loading')}</p>
            {phase.kind === 'loading' && <p className="mt-1 text-sm text-muted">{t('analyze.loadingHint')}</p>}
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="py-10 text-center">
            <p className="font-medium">{t(`error.${phase.code}`)}</p>
            {phase.code === 'passcode' && (
              <input
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={passcode}
                onChange={(e) => updateSettings({ passcode: e.target.value })}
                placeholder={t('settings.passcode')}
                className="mx-auto mt-4 block w-48 rounded-2xl bg-card px-4 py-2.5 text-center outline-none placeholder:text-muted"
              />
            )}
            {canRetry && (
              <button type="button" onClick={() => void run(note.trim())} className="mt-4 rounded-full bg-accent-soft px-5 py-2.5 text-sm text-accent">
                {t('analyze.retry')}
              </button>
            )}
          </div>
        )}

        {phase.kind === 'result' && (
          <>
            {!phase.isFood && phase.items.length === 0 && !adding ? (
              <p className="py-8 text-center font-medium">{t(input.kind === 'text' ? 'analyze.notFoodText' : 'analyze.notFood')}</p>
            ) : (
              <>
                {showSummary && <p className="text-lg font-medium">{phase.summary}</p>}
                <p className={`text-xs text-muted ${showSummary ? 'mt-1' : ''}`}>{t('analyze.hint')}</p>
              </>
            )}
            <ul className="mt-4 space-y-2">
              {phase.items.map((it, idx) => {
                const isBusy = busy.has(idx);
                return (
                  <li key={idx} className="rounded-2xl bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {renaming?.idx === idx ? (
                          <input
                            autoFocus
                            type="text"
                            value={renaming.value}
                            onChange={(e) => setRenaming({ idx, value: e.target.value })}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => void commitRename()}
                            onKeyDown={(e) => {
                              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setRenaming(null);
                            }}
                            enterKeyHint="done"
                            className="w-full rounded-lg bg-bg px-2 py-1 font-medium outline-none"
                          />
                        ) : (
                          <button type="button" onClick={() => !isBusy && setRenaming({ idx, value: it.name })} className="max-w-full truncate text-left font-medium underline decoration-muted/50 decoration-dotted underline-offset-4">
                            {it.name}
                          </button>
                        )}
                        {isBusy ? (
                          <p className="text-xs text-accent">{t('analyze.estimating')}</p>
                        ) : itemError?.idx === idx ? (
                          <p className="text-xs text-warn">{itemError.text}</p>
                        ) : (
                          it.confidence === 'low' && <p className="text-xs text-muted">{t('analyze.rough')}</p>
                        )}
                      </div>
                      <p className={`shrink-0 tabular-nums ${isBusy ? 'opacity-40' : ''}`}>
                        {fmt('energy', it.energy)} <span className="text-xs text-muted">{t('kcal')}</span>
                      </p>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center rounded-full bg-bg">
                        <button type="button" aria-label={t('analyze.less')} disabled={isBusy} onClick={() => setGrams(idx, it.grams - 10)} className="p-3 text-muted disabled:opacity-40">
                          <MinusIcon width={18} height={18} />
                        </button>
                        <div className="flex items-baseline gap-0.5 tabular-nums">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            placeholder="0"
                            aria-label={t('analyze.amount')}
                            disabled={isBusy}
                            value={it.grams || ''}
                            onChange={(e) => setGrams(idx, Number(e.target.value))}
                            onFocus={(e) => e.target.select()}
                            className="w-12 bg-transparent text-center outline-none placeholder:text-muted disabled:opacity-40"
                          />
                          <button
                            type="button"
                            aria-label={`${t('analyze.unitToggle')} · ${unitLabel(it)}`}
                            disabled={isBusy}
                            onClick={() => setUnit(idx, it.unit === 'ml' ? 'g' : 'ml')}
                            className="-ml-1 px-2 py-2 text-xs text-muted underline decoration-muted/50 decoration-dotted underline-offset-2 disabled:opacity-40"
                          >
                            {unitLabel(it)}
                          </button>
                        </div>
                        <button type="button" aria-label={t('analyze.more')} disabled={isBusy} onClick={() => setGrams(idx, it.grams + 10)} className="p-3 text-muted disabled:opacity-40">
                          <PlusIcon width={18} height={18} />
                        </button>
                      </div>
                      <button type="button" aria-label={t('analyze.remove', { name: it.name })} disabled={busy.size > 0} onClick={() => removeItem(idx)} className="p-3 text-muted disabled:opacity-40">
                        <XIcon width={16} height={16} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-2">
              {!adding ? (
                <button type="button" onClick={() => setAdding({ value: '', busy: false, error: '' })} className="flex items-center gap-1 py-2 text-sm text-accent">
                  <PlusIcon width={16} height={16} /> {t('analyze.addItem')}
                </button>
              ) : (
                <div className="rounded-2xl bg-card p-3">
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={adding.value}
                      disabled={adding.busy}
                      onChange={(e) => setAdding({ ...adding, value: e.target.value.slice(0, 60) })}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (e.key === 'Enter') void commitAdd();
                        if (e.key === 'Escape') setAdding(null);
                      }}
                      enterKeyHint="done"
                      placeholder={t('analyze.addPlaceholder')}
                      className="min-w-0 flex-1 rounded-xl bg-bg px-3 py-2 text-base outline-none placeholder:text-muted"
                    />
                    <button type="button" disabled={!adding.value.trim() || adding.busy} onClick={() => void commitAdd()} className="rounded-full bg-accent-soft px-4 py-2 text-sm text-accent disabled:opacity-40">
                      {adding.busy ? t('analyze.estimating') : t('analyze.estimate')}
                    </button>
                    <button type="button" aria-label={t('analyze.cancel')} onClick={() => setAdding(null)} className="p-2 text-muted">
                      <XIcon width={16} height={16} />
                    </button>
                  </div>
                  {adding.error && <p className="mt-1 text-xs text-warn">{adding.error}</p>}
                </div>
              )}
            </div>

            {tot && phase.items.length > 0 && (
              <div className="mt-3 px-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted">{t('analyze.total')}</span>
                  <span className="tabular-nums">
                    <span className="text-xl font-semibold">{fmt('energy', tot.energy)}</span>
                    <span className="text-sm text-muted"> {t('kcal')}</span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {t('n.protein')} {fmt('protein', tot.protein)}g · {t('n.fiber')} {fmt('fiber', tot.fiber)}g · {t('n.iron')} {fmt('iron', tot.iron)}mg · {t('n.calcium')} {fmt('calcium', tot.calcium)}mg · {t('n.folate')} {fmt('folate', tot.folate)}µg
                </p>
              </div>
            )}
            {gdm.enabled && tot && carbLimit !== null && phase.items.length > 0 && (
              <div className="mt-4 rounded-2xl bg-card px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted">
                    {t('analyze.carbs')} · {t(mealKind === 'snack' ? 'analyze.snack' : 'analyze.main')}
                  </span>
                  <p className={`whitespace-nowrap tabular-nums ${carbOver ? 'text-warn' : ''}`}>
                    <span className="text-lg font-semibold">{fmt('carbs', tot.carbs)}</span>
                    <span className="text-xs text-muted"> / {carbLimit} g</span>
                  </p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className={`h-full rounded-full ${carbOver ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${Math.min(100, (tot.carbs / carbLimit) * 100)}%` }} />
                </div>
                {carbOver && <p className="mt-1.5 text-xs text-warn">{t('analyze.carbOver')}</p>}
              </div>
            )}
            {phase.warnings.length > 0 && (
              <div className="mt-4 rounded-2xl bg-warn/10 px-4 py-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-warn">
                  <AlertIcon width={16} height={16} /> {t('analyze.safety')}
                </p>
                <ul className="mt-1 space-y-1 text-sm">
                  {phase.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {phase.items.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl bg-card px-4 py-3">
                <span className="whitespace-nowrap text-sm">
                  <span className="text-muted">{t('analyze.when')}</span>
                  {when.date !== todayKey && <span className="ml-1.5 text-accent">{dayLabel(when.date, lang)}</span>}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <input
                    type="date"
                    aria-label={t('analyze.date')}
                    max={todayKey}
                    value={when.date}
                    onChange={(e) => setWhen((w) => ({ ...w, date: DATE_KEY.test(e.target.value) ? e.target.value : todayKey }))}
                    className="rounded-lg bg-bg px-2 py-1.5 text-base tabular-nums outline-none"
                  />
                  <input
                    type="time"
                    aria-label={t('analyze.time')}
                    value={when.time}
                    onChange={(e) => setWhen((w) => ({ ...w, time: e.target.value || w.time }))}
                    className="rounded-lg bg-bg px-2 py-1.5 text-base tabular-nums outline-none"
                  />
                </div>
              </div>
            )}

            {!editing && (
              <div className="mt-4">
                {!noteOpen ? (
                  <button type="button" onClick={() => setNoteOpen(true)} className="py-2 text-sm text-accent">
                    + {t('analyze.note')}
                  </button>
                ) : (
                  <div className="rounded-2xl bg-card p-3">
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value.slice(0, 300))}
                      placeholder={t('analyze.notePlaceholder')}
                      rows={2}
                      className="w-full resize-none bg-transparent text-base outline-none placeholder:text-muted"
                    />
                    <button type="button" disabled={!note.trim()} onClick={() => void run(note.trim())} className="mt-2 rounded-full bg-accent-soft px-4 py-2 text-sm text-accent disabled:opacity-40">
                      {t('analyze.redo')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {phase.kind === 'result' && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/90 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="mx-auto max-w-md">
            {saveError && <p className="px-4 pt-3 text-center text-sm text-warn">{t('error.save')}</p>}
            {gdm.enabled && (
              <div className="flex justify-center px-4 pt-3">
                <div className="flex shrink-0 rounded-full bg-card p-0.5 text-sm">
                  {(['main', 'snack'] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setMealKind(k)} className={`whitespace-nowrap rounded-full px-4 py-1.5 ${mealKind === k ? 'bg-accent-soft font-medium text-accent' : 'text-muted'}`}>
                      {t(k === 'main' ? 'analyze.main' : 'analyze.snack')}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3 p-4">
              <button type="button" onClick={() => onClose()} className="flex-1 rounded-full border border-line py-3 font-medium">
                {t('analyze.cancel')}
              </button>
              <button type="button" onClick={() => void save()} disabled={!canSave || saving} className="flex-[2] rounded-full bg-accent py-3 font-medium text-on-accent disabled:opacity-40">
                {editing ? t('analyze.update') : t('analyze.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
