import { useEffect, useRef, useState } from 'react';
import { analyzePhoto, ApiError, type ApiErrorCode } from '../lib/api';
import { prepareImage, type PreparedImage } from '../lib/image';
import { db, localDateKey, type FoodItem } from '../lib/db';
import { hasSubstance, rescale, totals } from '../lib/nutrition';
import { updateSettings, useSettings } from '../lib/settings';
import { useT } from '../i18n';
import { MinusIcon, PlusIcon, XIcon } from '../components/Icons';

type Phase =
  | { kind: 'preparing' }
  | { kind: 'loading' }
  | { kind: 'result'; basis: FoodItem[]; items: FoodItem[]; summary: string; isFood: boolean }
  | { kind: 'error'; code: ApiErrorCode | 'image' };

export default function Analyze({ file, onClose }: { file: File; onClose: () => void }) {
  const t = useT();
  const { lang, passcode } = useSettings();
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'preparing' });
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const alive = useRef(true);
  const passcodeRef = useRef(passcode);
  passcodeRef.current = passcode;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function run(prepared: PreparedImage, userNote: string) {
    setPhase({ kind: 'loading' });
    try {
      const a = await analyzePhoto({ base64: prepared.base64, mediaType: prepared.mediaType, lang, note: userNote, passcode: passcodeRef.current });
      if (!alive.current) return;
      setPhase({ kind: 'result', basis: a.items, items: a.items, summary: a.summary, isFood: a.is_food });
    } catch (e) {
      if (!alive.current) return;
      setPhase({ kind: 'error', code: e instanceof ApiError ? e.code : 'server' });
    }
  }

  useEffect(() => {
    let cancelled = false;
    prepareImage(file)
      .then((p) => {
        if (cancelled) return;
        setImg(p);
        void run(p, '');
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: 'error', code: 'image' });
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

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
    if (phase.kind !== 'result' || !img || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const items = phase.items.filter(hasSubstance);
      await db.meals.add({ date: localDateKey(), ts: Date.now(), thumb: img.thumb, summary: phase.summary, note: note.trim(), items });
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
        <div className="overflow-hidden rounded-3xl bg-line" style={{ aspectRatio: '4 / 3' }}>
          {img && <img src={img.preview} alt="" className="h-full w-full object-cover" />}
        </div>
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
            {img && phase.code !== 'image' && (
              <button type="button" onClick={() => void run(img, note.trim())} className="mt-4 rounded-full bg-accent-soft px-5 py-2.5 text-sm text-accent">
                {t('analyze.retry')}
              </button>
            )}
          </div>
        )}

        {phase.kind === 'result' && (
          <>
            {!phase.isFood || phase.items.length === 0 ? (
              <p className="py-8 text-center font-medium">{t('analyze.notFood')}</p>
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
                          {it.calories} <span className="text-xs text-muted">{t('kcal')}</span>
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
                  <div className="mt-3 flex items-baseline justify-between px-1">
                    <span className="text-sm text-muted">
                      {t('protein')} {tot.protein}{t('g')} · {t('carbs')} {tot.carbs}{t('g')} · {t('fat')} {tot.fat}{t('g')}
                    </span>
                    <span className="tabular-nums">
                      <span className="text-sm text-muted">{t('analyze.total')} </span>
                      <span className="text-xl font-semibold">{tot.calories}</span>
                      <span className="text-sm text-muted"> {t('kcal')}</span>
                    </span>
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
                  <button
                    type="button"
                    disabled={!note.trim() || !img}
                    onClick={() => img && void run(img, note.trim())}
                    className="mt-2 rounded-full bg-accent-soft px-4 py-2 text-sm text-accent disabled:opacity-40"
                  >
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
