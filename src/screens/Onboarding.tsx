import { useState } from 'react';
import { db, localDateKey } from '../lib/db';
import { updateSettings, useSettings, type Activity, type Profile } from '../lib/settings';
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
  const [step, setStep] = useState<1 | 2>(1);
  const [passcode, setPasscode] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [preKg, setPreKg] = useState('');
  const [nowKg, setNowKg] = useState('');
  const [activity, setActivity] = useState<Activity>('moderate');

  const profileValid = Number.isFinite(Date.parse(dueDate)) && Number(age) > 0 && Number(height) > 0 && Number(preKg) > 0;

  async function finish(withProfile: boolean) {
    // Ask the browser not to evict our data under storage pressure (user gesture required).
    void navigator.storage?.persist?.().catch(() => false);
    const profile: Profile | null = withProfile && profileValid ? { dueDate, age: Math.round(Number(age)), heightCm: Math.round(Number(height)), prePregnancyKg: Math.round(Number(preKg) * 10) / 10, activity } : null;
    try {
      const kg = Math.round(Number(nowKg) * 10) / 10;
      if (withProfile && Number.isFinite(kg) && kg > 0 && !(await db.weights.where('date').equals(localDateKey()).first())) {
        await db.weights.add({ date: localDateKey(), ts: Date.now(), kg });
      }
    } catch {
      /* storage problems are surfaced later by the screens */
    }
    updateSettings({ passcode: passcode.trim(), profile, onboarded: true });
  }

  const field = 'mt-1 w-full rounded-2xl bg-card px-4 py-3 outline-none placeholder:text-muted';

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8vh)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
      {step === 1 ? (
        <>
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
            <input type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder={t('settings.passcodeHint')} className={field} />
          </label>
          <div className="flex-1" />
          {isIosBrowserTab() && <p className="mb-4 text-xs leading-relaxed text-muted">{t('onboard.install')}</p>}
          <button type="button" onClick={() => setStep(2)} disabled={!passcode.trim()} className="rounded-full bg-accent py-3.5 font-medium text-on-accent disabled:opacity-40">
            {t('onboard.next')}
          </button>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-semibold">{t('onboard.profileTitle')}</h1>
          <p className="mt-2 text-sm text-muted">{t('onboard.profileHint')}</p>
          <label className="mt-6 block">
            <span className="text-sm text-muted">{t('settings.dueDate')}</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={field} />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm text-muted">{t('settings.age')}</span>
              <input type="number" inputMode="numeric" min={0} value={age} onChange={(e) => setAge(e.target.value)} placeholder="30" className={field} />
            </label>
            <label className="block">
              <span className="text-sm text-muted">{t('settings.height')} (cm)</span>
              <input type="number" inputMode="numeric" min={0} value={height} onChange={(e) => setHeight(e.target.value)} placeholder="160" className={field} />
            </label>
            <label className="block">
              <span className="text-sm text-muted">{t('settings.preKg')} (kg)</span>
              <input type="number" inputMode="decimal" step={0.1} min={0} value={preKg} onChange={(e) => setPreKg(e.target.value)} placeholder="55" className={field} />
            </label>
            <label className="block">
              <span className="text-sm text-muted">{t('onboard.currentKg')} (kg)</span>
              <input type="number" inputMode="decimal" step={0.1} min={0} value={nowKg} onChange={(e) => setNowKg(e.target.value)} placeholder="58" className={field} />
            </label>
          </div>
          <div className="mt-3">
            <span className="text-sm text-muted">{t('settings.activity')}</span>
            <div className="mt-1 flex rounded-2xl bg-card p-1 text-sm">
              {(['low', 'moderate', 'high'] as Activity[]).map((a) => (
                <button key={a} type="button" onClick={() => setActivity(a)} className={`flex-1 rounded-xl py-2 ${activity === a ? 'bg-bg font-medium' : 'text-muted'}`}>
                  {t(`activity.${a}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1" />
          <button type="button" onClick={() => void finish(true)} disabled={!profileValid} className="rounded-full bg-accent py-3.5 font-medium text-on-accent disabled:opacity-40">
            {t('onboard.start')}
          </button>
          <button type="button" onClick={() => void finish(false)} className="mt-3 py-2 text-sm text-muted">
            {t('onboard.skip')}
          </button>
        </>
      )}
    </div>
  );
}
