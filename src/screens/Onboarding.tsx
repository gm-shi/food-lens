import { useState } from 'react';
import { updateSettings, useSettings } from '../lib/settings';
import { useT, type Lang } from '../i18n';

function isIosBrowserTab(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone;
}

export default function Onboarding() {
  const t = useT();
  const s = useSettings();
  const [passcode, setPasscode] = useState('');
  const [target, setTarget] = useState(String(s.target));

  function start() {
    const n = Math.round(Number(target));
    // Ask the browser not to evict our data under storage pressure (user gesture required).
    void navigator.storage?.persist?.().catch(() => false);
    updateSettings({ passcode: passcode.trim(), target: Number.isFinite(n) && n > 0 ? n : 1800, onboarded: true });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12vh)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
      <div className="flex self-end rounded-full bg-card p-0.5 text-sm">
        {(['zh', 'en'] as Lang[]).map((l) => (
          <button key={l} type="button" onClick={() => updateSettings({ lang: l })} className={`rounded-full px-3 py-1 ${s.lang === l ? 'bg-bg font-medium' : 'text-muted'}`}>
            {l === 'zh' ? '中文' : 'EN'}
          </button>
        ))}
      </div>
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="mt-8 h-16 w-16 rounded-2xl" />
      <h1 className="mt-6 text-3xl font-semibold">{t('onboard.title')}</h1>
      <p className="mt-2 text-muted">{t('onboard.intro')}</p>

      <label className="mt-10 block">
        <span className="text-sm text-muted">{t('settings.passcode')}</span>
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder={t('settings.passcodeHint')}
          className="mt-1 w-full rounded-2xl bg-card px-4 py-3 outline-none placeholder:text-muted"
        />
      </label>
      <label className="mt-4 block">
        <span className="text-sm text-muted">{t('settings.target')}</span>
        <div className="mt-1 flex items-center rounded-2xl bg-card px-4">
          <input type="number" inputMode="numeric" min={0} value={target} onChange={(e) => setTarget(e.target.value)} className="w-full bg-transparent py-3 tabular-nums outline-none" />
          <span className="text-sm text-muted">{t('kcal')}</span>
        </div>
      </label>

      <div className="flex-1" />
      {isIosBrowserTab() && <p className="mb-4 text-xs leading-relaxed text-muted">{t('onboard.install')}</p>}
      <button type="button" onClick={start} disabled={!passcode.trim()} className="rounded-full bg-accent py-3.5 font-medium text-on-accent disabled:opacity-40">
        {t('onboard.start')}
      </button>
    </div>
  );
}
