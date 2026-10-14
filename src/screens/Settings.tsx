import { useRef, useState, type ChangeEvent } from 'react';
import { db, type Meal } from '../lib/db';
import { cleanItem } from '../lib/api';
import { updateSettings, useSettings } from '../lib/settings';
import { useT, type Lang } from '../i18n';

interface Backup {
  app: 'food-lens';
  version: 1;
  exportedAt: string;
  meals: Omit<Meal, 'id'>[];
}

export default function Settings() {
  const t = useT();
  const s = useSettings();
  const importRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  async function exportBackup() {
    const meals = await db.meals.orderBy('ts').toArray();
    const backup: Backup = {
      app: 'food-lens',
      version: 1,
      exportedAt: new Date().toISOString(),
      meals: meals.map(({ id: _id, ...rest }) => rest),
    };
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `food-lens-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function importBackup(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as Partial<Backup>;
      if (data.app !== 'food-lens' || !Array.isArray(data.meals)) throw new Error('bad');
      const have = new Set<number>((await db.meals.orderBy('ts').keys()) as number[]);
      const fresh: Omit<Meal, 'id'>[] = [];
      for (const m of data.meals) {
        if (!m || typeof m.date !== 'string' || typeof m.ts !== 'number' || !Array.isArray(m.items)) continue;
        if (have.has(m.ts)) continue; // already on this phone, or repeated inside the file
        have.add(m.ts);
        fresh.push({
          date: m.date,
          ts: m.ts,
          thumb: typeof m.thumb === 'string' ? m.thumb : '',
          summary: typeof m.summary === 'string' ? m.summary : '',
          note: typeof m.note === 'string' ? m.note : '',
          items: m.items.map(cleanItem),
        });
      }
      await db.meals.bulkAdd(fresh);
      setMsg(t(fresh.length === 1 ? 'settings.importDoneOne' : 'settings.importDone', { n: fresh.length }));
    } catch {
      setMsg(t('settings.importBad'));
    }
  }

  async function clearAll() {
    if (!confirm(t('settings.clearConfirm'))) return;
    await db.meals.clear();
  }

  return (
    <div className="px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 112px)' }}>
      <h1 className="text-2xl font-semibold">{t('tab.settings')}</h1>

      <section className="mt-4 divide-y divide-line rounded-3xl bg-card">
        <Row label={t('settings.language')}>
          <div className="flex rounded-full bg-bg p-0.5 text-sm">
            {(['zh', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => updateSettings({ lang: l })}
                className={`rounded-full px-3 py-1.5 ${s.lang === l ? 'bg-card font-medium shadow-sm' : 'text-muted'}`}
              >
                {l === 'zh' ? '中文' : 'EN'}
              </button>
            ))}
          </div>
        </Row>
        <Row label={t('settings.target')}>
          <label className="flex items-baseline gap-1 tabular-nums">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="1800"
              value={s.target || ''}
              onChange={(e) => updateSettings({ target: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              onFocus={(e) => e.target.select()}
              className="w-20 rounded-lg bg-bg px-2 py-1.5 text-right outline-none"
            />
            <span className="text-xs text-muted">{t('kcal')}</span>
          </label>
        </Row>
        <Row label={t('settings.passcode')} hint={t('settings.passcodeHint')}>
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={s.passcode}
            onChange={(e) => updateSettings({ passcode: e.target.value })}
            className="w-32 rounded-lg bg-bg px-2 py-1.5 text-right outline-none"
          />
        </Row>
      </section>

      <h2 className="mt-7 px-1 text-sm text-muted">{t('settings.data')}</h2>
      <section className="mt-2 divide-y divide-line rounded-3xl bg-card">
        <button type="button" onClick={() => void exportBackup()} className="block w-full px-4 py-3.5 text-left">
          {t('settings.export')}
        </button>
        <button type="button" onClick={() => importRef.current?.click()} className="block w-full px-4 py-3.5 text-left">
          {t('settings.import')}
        </button>
        <button type="button" onClick={() => void clearAll()} className="block w-full px-4 py-3.5 text-left text-warn">
          {t('settings.clear')}
        </button>
      </section>
      <input ref={importRef} type="file" accept="application/json,.json" onChange={(e) => void importBackup(e)} hidden />
      {msg && <p className="mt-3 px-1 text-sm text-accent">{msg}</p>}
      <p className="mt-6 px-1 text-xs leading-relaxed text-muted">{t('settings.local')}</p>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p>{label}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
