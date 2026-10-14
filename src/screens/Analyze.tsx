import { useEffect, useRef, useState } from 'react';
import { analyzeMeal, ApiError, type ApiErrorCode, type MealSource } from '../lib/api';
import { prepareImage, type PreparedImage } from '../lib/image';
import { db, localDateKey, type FoodItem } from '../lib/db';
import { hasSubstance, rescale, totals } from '../lib/nutrition';
import { fmt } from '../lib/nutrients';
import { usePregnancy } from '../lib/hooks';
import { gdmLimit, updateSettings, useSettings } from '../lib/settings';
import { useT } from '../i18n';
import { AlertIcon, MinusIcon, PlusIcon, XIcon } from '../components/Icons';

export type MealInput = { kind: 'photo'; file: File } | { kind: 'text'; text: string };

type Phase =
  | { kind: 'preparing' }
  | { kind: 'loading' }
  | { kind: 'result'; basis: FoodItem[]; items: FoodItem[]; summary: string; isFood: boolean; warnings: string[] }
  | { kind: 'error'; code: ApiErrorCode | 'image' };

export default function Analyze({ input, onClose }: { input: MealInput; onClose: () => void }) {
  const t = useT();
  const { lang, passcode, gdm } = useSettings();
  const preg = usePregnancy();
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'preparing' });
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [mealKind, setMealKind] = useState<'main' | 'snack'>('main');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
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

  function removeItem(idx: number) {
    if (phase.kind !== 'result') return;
    setPhase({ ...phase, items: phase.items.filter((_, i) => i !== idx), basis: phase.basis.filter((_, i) => i !== idx) });
  }

  async function save() {
    if (phase.kind !== 'result' || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const items = phase.items.filter(hasSubstance);
      await db.meals.add({
        date: localDateKey(),
        ts: Date.now(),
        thumb: img?.thumb ?? '',
        summary: phase.summary,
        note: note.trim(),
        items,
        warnings: phase.warnings,
        kind: gdm.enabled ? mealKind : undefined,
        source: input.kind,
      });
      onClose();
    } catch {
      if (alive.current) setSaveError(true);
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  const tot = phase.kind === 'result' ? totals(phase.items) : null;
  const canSave = phase.kind === 'result' && phase.items.some(hasSubstance);
  const showSummary = phase.kind === 'result' && phase.summary && !(phase.items.length === 1 && phase.items[0].name === phase.summary);
  const canRetry = phase.kind === 'error' && phase.code !== 'image' && (input.kind === 'text' || img !== null);
  const carbLimit = gdm.enabled ? gdmLimit(gdm, mealKind) : null;
  const carbOver = tot !== null && carbLimit !== null && tot.carbs > carbLimit;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={onClose} aria-label={t('analyze.cancel')} className="-ml-2 rounded-full p-2 text-muted">
          <XIcon />
        </button>
        <span className="text-sm text-muted">{t('appName')}</span>
        <span className="w-9" />
      </header>

      <div className="px-4">
        {input.kind === 'photo' ? (
          <div className="overflow-hidden rounded-3xl bg-line" style={{ aspectRatio: '4 / 3' }}>
            {img && <img src={img.preview} alt="" className="h-full w-full object-cover" />}
          </div>
        ) : (
          <div className="rounded-3xl bg-card px-5 py-4">
            <p className="text-xs text-muted">{t('analyze.fromText')}</p>
            <p className="mt-1 text-lg leading-relaxed">{input.text}</p>
          </div>
        )}
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
            {!phase.isFood || phase.items.length === 0 ? (
              <p className="py-8 text-center font-medium">{t(input.kind === 'text' ? 'analyze.notFoodText' : 'analyze.notFood')}</p>
            ) : (
              <>
                {showSummary && <p className="text-lg font-medium">{phase.summary}</p>}
                <p className={`text-xs text-muted ${showSummary ? 'mt-1' : ''}`}>{t('analyze.hint')}</p>
                <ul className="mt-4 space-y-2">
                  {phase.items.map((it, idx) => (
                    <li key={idx} className="rounded-2xl bg-card p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{it.name}</p>
                          {it.confidence === 'low' && <p className="text-xs text-muted">{t('analyze.rough')}</p>}
                        </div>
                        <p className="shrink-0 tabular-nums">
                          {fmt('energy', it.energy)} <span className="text-xs text-muted">{t('kcal')}</span>
                        </p>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center rounded-full bg-bg">
                          <button type="button" aria-label={t('analyze.less')} onClick={() => setGrams(idx, it.grams - 10)} className="p-3 text-muted">
                            <MinusIcon width={18} height={18} />
                          </button>
                          <label className="flex items-baseline gap-0.5 tabular-nums">
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              placeholder="0"
                              value={it.grams || ''}
                              onChange={(e) => setGrams(idx, Number(e.target.value))}
                              onFocus={(e) => e.target.select()}
                              className="w-12 bg-transparent text-center outline-none placeholder:text-muted"
                            />
                            <span className="pr-1 text-xs text-muted">{t('g')}</span>
                          </label>
                          <button type="button" aria-label={t('analyze.more')} onClick={() => setGrams(idx, it.grams + 10)} className="p-3 text-muted">
                            <PlusIcon width={18} height={18} />
                          </button>
                        </div>
                        <button type="button" aria-label={t('analyze.remove', { name: it.name })} onClick={() => removeItem(idx)} className="p-3 text-muted">
                          <XIcon width={16} height={16} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {tot && (
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
                {gdm.enabled && tot && carbLimit !== null && (
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
              </>
            )}

            <div className="mt-6">
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
              <button type="button" onClick={onClose} className="flex-1 rounded-full border border-line py-3 font-medium">
                {t('analyze.cancel')}
              </button>
              <button type="button" onClick={() => void save()} disabled={!canSave || saving} className="flex-[2] rounded-full bg-accent py-3 font-medium text-on-accent disabled:opacity-40">
                {t('analyze.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
