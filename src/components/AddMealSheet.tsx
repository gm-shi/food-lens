import { useRef, useState, type ChangeEvent } from 'react';
import { useT } from '../i18n';
import { PhotoIcon } from './Icons';

/**
 * Bottom sheet for logging a meal: a choice between a photo and a typed description, or the
 * description alone when `initialMode` is "text". The caller decides which day the meal goes to.
 * Pass `draft` and `onDraftChange` to keep the typed text alive while the sheet is closed.
 */
export default function AddMealSheet({
  title,
  initialMode = 'choose',
  draft,
  onDraftChange,
  onClose,
  onPick,
  onText,
}: {
  title: string;
  initialMode?: 'choose' | 'text';
  draft?: string;
  onDraftChange?: (text: string) => void;
  onClose: () => void;
  onPick?: (file: File) => void;
  onText: (text: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState(initialMode);
  const [own, setOwn] = useState('');
  const text = draft ?? own;
  const setText = onDraftChange ?? setOwn;
  const pickRef = useRef<HTMLInputElement>(null);

  function handle(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    onClose();
    onPick?.(f);
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-ink/30" onClick={onClose}>
      <div className="mx-auto w-full max-w-md rounded-t-3xl bg-card px-5 pt-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }} onClick={(e) => e.stopPropagation()}>
        <p className="font-medium">{title}</p>
        {mode === 'choose' ? (
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={() => pickRef.current?.click()} className="flex flex-[2] items-center justify-center gap-2 rounded-full bg-accent py-3 font-medium text-on-accent">
              <PhotoIcon width={20} height={20} /> {t('today.pick')}
            </button>
            <button type="button" onClick={() => setMode('text')} className="flex-1 rounded-full border border-line py-3 font-medium">
              {t('today.text')}
            </button>
          </div>
        ) : (
          <>
            <p className="mt-0.5 text-xs text-muted">{t('text.hint')}</p>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 300))}
              placeholder={t('text.placeholder')}
              rows={3}
              className="mt-3 w-full resize-none rounded-2xl bg-bg px-4 py-3 text-base outline-none placeholder:text-muted"
            />
            <div className="mt-3 flex gap-3">
              <button type="button" onClick={() => (initialMode === 'choose' ? setMode('choose') : onClose())} className="flex-1 rounded-full border border-line py-3 font-medium">
                {t('analyze.cancel')}
              </button>
              <button
                type="button"
                disabled={!text.trim()}
                onClick={() => {
                  const v = text.trim();
                  onClose();
                  onText(v);
                }}
                className="flex-[2] rounded-full bg-accent py-3 font-medium text-on-accent disabled:opacity-40"
              >
                {t('text.go')}
              </button>
            </div>
          </>
        )}
        {onPick && <input ref={pickRef} type="file" accept="image/*" onChange={handle} hidden />}
      </div>
    </div>
  );
}
