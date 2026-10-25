import { useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Meal, type Note, type Supplement, type SupplementLog, type WeightEntry } from '../lib/db';
import { ApiError, cleanItem, scanLabel } from '../lib/api';
import { prepareImage } from '../lib/image';
import { clearRecs } from '../lib/recs';
import { clearWeekly } from '../lib/weekly';
import { CameraIcon, ChevronIcon } from '../components/Icons';
import { NUTRIENTS, type NutrientKey } from '../lib/nutrients';
import { usePregnancy } from '../lib/hooks';
import { GDM_DEFAULTS, PROVIDERS, isSectionOpen, setOverride, setSectionOpen, updateSettings, useSettings, type Activity, type Gdm, type Profile, type Provider, type Settings, type SettingsSection } from '../lib/settings';
import { useT, type Lang, type TKey } from '../i18n';
import { TrashIcon } from '../components/Icons';

interface Backup {
  app: 'food-lens';
  version: 1 | 2;
  exportedAt: string;
  meals: Omit<Meal, 'id'>[];
  weights?: Omit<WeightEntry, 'id'>[];
  supplements?: Supplement[];
  supplementLogs?: Omit<SupplementLog, 'id'>[];
  profile?: Profile | null;
  overrides?: Partial<Record<NutrientKey, number>>;
  gdm?: Gdm;
  /** v3 backups: one note per day */
  dayNotes?: { date: string; mood: number; text: string; ts: number }[];
  notes?: Omit<Note, 'id'>[];
}

const SUPP_KEYS: NutrientKey[] = ['folate', 'iodine', 'iron', 'calcium', 'vitD', 'dha', 'vitC', 'vitA'];
const EMPTY_PROFILE: Profile = { dueDate: '', age: 0, heightCm: 0, prePregnancyKg: 0, activity: 'moderate' };
/** Product names, the same in both languages */
const PROVIDER_NAMES: Record<Provider, string> = { deepseek: 'DeepSeek', anthropic: 'Claude', openai: 'GPT-6.1 Sol' };

export default function Settings() {
  const t = useT();
  const s = useSettings();
  const preg = usePregnancy();
  const supplements = useLiveQuery(() => db.supplements.toArray(), []) ?? [];
  const importRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const scanTarget = useRef<number | null>(null);
  const [scanState, setScanState] = useState<{ id: number; text: string; busy?: boolean } | null>(null);
  const [cardVersion, setCardVersion] = useState<Record<number, number>>({});
  const [msg, setMsg] = useState('');
  const profile = s.profile ?? EMPTY_PROFILE;

  function patchProfile(p: Partial<Profile>) {
    updateSettings({ profile: { ...profile, ...p } });
  }

  async function exportBackup() {
    const backup: Backup = {
      app: 'food-lens',
      version: 2,
      exportedAt: new Date().toISOString(),
      meals: (await db.meals.orderBy('ts').toArray()).map(({ id: _id, ...rest }) => rest),
      weights: (await db.weights.orderBy('ts').toArray()).map(({ id: _id, ...rest }) => rest),
      supplements: await db.supplements.toArray(),
      supplementLogs: (await db.supplementLogs.toArray()).map(({ id: _id, ...rest }) => rest),
      profile: s.profile,
      overrides: s.overrides,
      gdm: s.gdm,
      notes: (await db.notes.orderBy('ts').toArray()).map(({ id: _id, ...rest }) => rest),
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
      let added = 0;
      await db.transaction('rw', db.meals, db.weights, db.supplements, db.supplementLogs, db.notes, async () => {
        const have = new Set<number>((await db.meals.orderBy('ts').keys()) as number[]);
        const fresh: Omit<Meal, 'id'>[] = [];
        for (const m of data.meals ?? []) {
          if (!m || typeof m.date !== 'string' || typeof m.ts !== 'number' || !Array.isArray(m.items) || have.has(m.ts)) continue;
          have.add(m.ts);
          fresh.push({
            date: m.date,
            ts: m.ts,
            thumb: typeof m.thumb === 'string' ? m.thumb : '',
            summary: typeof m.summary === 'string' ? m.summary : '',
            note: typeof m.note === 'string' ? m.note : '',
            items: m.items.map(cleanItem),
            warnings: Array.isArray(m.warnings) ? m.warnings.filter((w): w is string => typeof w === 'string') : [],
            kind: m.kind === 'main' || m.kind === 'snack' ? m.kind : undefined,
            source: m.source === 'photo' || m.source === 'text' ? m.source : undefined,
          });
        }
        await db.meals.bulkAdd(fresh);
        added += fresh.length;

        const haveDates = new Set((await db.weights.toArray()).map((w) => w.date));
        const weights = (data.weights ?? []).filter((w) => w && typeof w.date === 'string' && typeof w.kg === 'number' && !haveDates.has(w.date)).map((w) => ({ date: w.date, ts: typeof w.ts === 'number' ? w.ts : Date.parse(w.date), kg: w.kg }));
        await db.weights.bulkAdd(weights);
        added += weights.length;

        const idMap = new Map<number, number>();
        const existing = await db.supplements.toArray();
        for (const sp of data.supplements ?? []) {
          if (!sp || typeof sp.name !== 'string') continue;
          const match = existing.find((x) => x.name === sp.name);
          if (match) idMap.set(sp.id, match.id);
          else idMap.set(sp.id, (await db.supplements.add({ name: sp.name.slice(0, 60), enabled: sp.enabled !== false, nutrients: cleanNutrients(sp.nutrients) })) as number);
        }
        const haveNotes = new Set((await db.notes.toArray()).map((n) => `${n.date}|${n.ts}`));
        for (const n of [...(data.notes ?? []), ...(data.dayNotes ?? [])]) {
          if (!n || typeof n.date !== 'string' || typeof n.mood !== 'number' || n.mood < 1 || n.mood > 5) continue;
          const ts = typeof n.ts === 'number' ? n.ts : Date.parse(n.date);
          if (haveNotes.has(`${n.date}|${ts}`)) continue;
          haveNotes.add(`${n.date}|${ts}`);
          await db.notes.add({ date: n.date, ts, mood: Math.round(n.mood) as Note['mood'], text: typeof n.text === 'string' ? n.text.slice(0, 200) : '' });
          added++;
        }
        const logs = (data.supplementLogs ?? []).filter((l) => l && typeof l.date === 'string' && idMap.has(l.supplementId));
        for (const l of logs) {
          const supplementId = idMap.get(l.supplementId)!;
          if (!(await db.supplementLogs.where('[date+supplementId]').equals([l.date, supplementId]).first())) {
            await db.supplementLogs.add({ date: l.date, supplementId });
            added++;
          }
        }
      });
      // Profile and doctor-set targets: restore only what is not already set on this phone.
      const patch: Partial<Settings> = {};
      if (!s.profile && data.profile && typeof data.profile === 'object' && typeof data.profile.dueDate === 'string') {
        patch.profile = { ...EMPTY_PROFILE, ...cleanProfile(data.profile) };
      }
      if (data.overrides && typeof data.overrides === 'object') {
        const merged = { ...s.overrides };
        for (const [k, v] of Object.entries(data.overrides)) {
          if (k in NUTRIENTS && merged[k as NutrientKey] === undefined && typeof v === 'number' && Number.isFinite(v) && v > 0) merged[k as NutrientKey] = v;
        }
        patch.overrides = merged;
      }
      if (!s.gdm.enabled && data.gdm && typeof data.gdm === 'object' && data.gdm.enabled === true) {
        const g = data.gdm;
        patch.gdm = {
          enabled: true,
          mainCarbs: typeof g.mainCarbs === 'number' && g.mainCarbs > 0 ? Math.round(g.mainCarbs) : GDM_DEFAULTS.mainCarbs,
          snackCarbs: typeof g.snackCarbs === 'number' && g.snackCarbs > 0 ? Math.round(g.snackCarbs) : GDM_DEFAULTS.snackCarbs,
        };
      }
      if (Object.keys(patch).length) updateSettings(patch);
      setMsg(t(added === 1 ? 'settings.importDoneOne' : 'settings.importDone', { n: added }));
    } catch {
      setMsg(t('settings.importBad'));
    }
  }

  async function clearAll() {
    if (!confirm(t('settings.clearConfirm'))) return;
    await db.transaction('rw', db.meals, db.weights, db.supplementLogs, db.notes, async () => {
      await db.meals.clear();
      await db.weights.clear();
      await db.supplementLogs.clear();
      await db.notes.clear();
    });
    clearRecs();
    clearWeekly();
  }

  async function addSupplement() {
    await db.supplements.add({ name: '', enabled: true, nutrients: {} });
  }

  function startScan(id: number) {
    scanTarget.current = id;
    scanRef.current?.click();
  }

  async function handleScan(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    const id = scanTarget.current;
    if (!f || id === null) return;
    setScanState({ id, text: t('settings.scanning'), busy: true });
    let img: Awaited<ReturnType<typeof prepareImage>>;
    try {
      img = await prepareImage(f);
    } catch {
      setScanState({ id, text: t('error.image') });
      return;
    }
    try {
      const label = await scanLabel({ base64: img.base64, mediaType: img.mediaType, lang: s.lang, passcode: s.passcode });
      if (!label.readable) {
        setScanState({ id, text: t('settings.scanFail') });
        return;
      }
      const current = await db.supplements.get(id);
      if (!current) {
        setScanState(null);
        return;
      }
      const hasValues = Object.values(current.nutrients).some((v) => (v ?? 0) > 0);
      if (hasValues && !confirm(t('settings.scanReplace'))) {
        setScanState(null);
        return;
      }
      const nutrients = { ...current.nutrients };
      for (const k of SUPP_KEYS) if (label.nutrients[k] !== undefined) nutrients[k] = label.nutrients[k];
      await db.supplements.update(id, { nutrients, ...(current.name.trim() ? {} : { name: label.name.slice(0, 60) }) });
      setCardVersion((v) => ({ ...v, [id]: (v[id] ?? 0) + 1 }));
      setScanState({ id, text: [label.dose ? t('settings.scanDone', { dose: label.dose }) : t('settings.scanDoneNoDose'), label.notes].filter(Boolean).join(' ') });
    } catch (err) {
      setScanState({ id, text: t(`error.${err instanceof ApiError ? err.code : 'server'}`) });
    }
  }

  const input = 'rounded-lg bg-bg px-2 py-1.5 text-right outline-none tabular-nums';

  return (
    <div className="px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 112px)' }}>
      <h1 className="text-2xl font-semibold">{t('tab.settings')}</h1>

      <Section id="profile" title={t('settings.profile')} first defaultOpen={!profile.dueDate || !(profile.heightCm > 0) || !(profile.prePregnancyKg > 0)}>
        <section className="mt-2 divide-y divide-line rounded-3xl bg-card">
          <Row label={t('settings.dueDate')}>
            <input type="date" value={profile.dueDate} onChange={(e) => patchProfile({ dueDate: e.target.value })} className={`${input} w-40`} />
          </Row>
          <Row label={t('settings.age')}>
            <input type="number" inputMode="numeric" min={0} placeholder="30" value={profile.age || ''} onChange={(e) => patchProfile({ age: Math.round(Number(e.target.value) || 0) })} className={`${input} w-20`} />
          </Row>
          <Row label={`${t('settings.height')} (cm)`}>
            <input type="number" inputMode="numeric" min={0} placeholder="160" value={profile.heightCm || ''} onChange={(e) => patchProfile({ heightCm: Math.round(Number(e.target.value) || 0) })} className={`${input} w-20`} />
          </Row>
          <Row label={`${t('settings.preKg')} (kg)`}>
            <input type="number" inputMode="decimal" step={0.1} min={0} placeholder="55" value={profile.prePregnancyKg || ''} onChange={(e) => patchProfile({ prePregnancyKg: Math.round((Number(e.target.value) || 0) * 10) / 10 })} className={`${input} w-20`} />
          </Row>
          <Row label={t('settings.activity')}>
            <div className="flex rounded-full bg-bg p-0.5 text-xs">
              {(['low', 'moderate', 'high'] as Activity[]).map((a) => (
                <button key={a} type="button" onClick={() => patchProfile({ activity: a })} className={`whitespace-nowrap rounded-full px-2.5 py-1.5 ${profile.activity === a ? 'bg-card font-medium shadow-sm' : 'text-muted'}`}>
                  {t(`activity.${a}`)}
                </button>
              ))}
            </div>
          </Row>
        </section>
      </Section>

      <Section id="targets" title={t('settings.targets')}>
        <p className="mt-1 px-1 text-xs text-muted">{t('settings.targetsHint')}</p>
        <section className="mt-2 divide-y divide-line rounded-3xl bg-card">
          {preg.targets.map((tg) => (
            <Row key={tg.key} label={`${t(`n.${tg.key}` as TKey)}${tg.kind === 'limit' ? ` · ${t('n.limit')}` : ''}`} hint={tg.overridden ? t('settings.reset') : undefined} onHint={tg.overridden ? () => setOverride(tg.key, undefined) : undefined}>
              <label className="flex items-baseline gap-1">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={tg.value}
                  onChange={(e) => {
                    if (e.target.value !== '') setOverride(tg.key, Number(e.target.value));
                  }}
                  onFocus={(e) => e.target.select()}
                  className={`${input} w-20 ${tg.overridden ? 'text-accent' : ''}`}
                />
                <span className="text-xs text-muted">{NUTRIENTS[tg.key].unit}</span>
              </label>
            </Row>
          ))}
        </section>
      </Section>

      <h2 className="mt-7 px-1 text-sm text-muted">{t('settings.gdm')}</h2>
      <p className="mt-1 px-1 text-xs text-muted">{t('settings.gdmHint')}</p>
      <section className="mt-2 divide-y divide-line rounded-3xl bg-card">
        <Row label={t('settings.gdm')}>
          <button type="button" role="switch" aria-checked={s.gdm.enabled} onClick={() => updateSettings({ gdm: { ...s.gdm, enabled: !s.gdm.enabled } })} className={`relative h-6 w-10 rounded-full transition-colors ${s.gdm.enabled ? 'bg-accent' : 'bg-line'}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card transition-[left] ${s.gdm.enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </Row>
        {s.gdm.enabled && (
          <>
            <Row label={t('settings.gdmMain')}>
              <label className="flex items-baseline gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={s.gdm.mainCarbs}
                  onChange={(e) => {
                    if (e.target.value !== '') updateSettings({ gdm: { ...s.gdm, mainCarbs: Math.max(1, Math.round(Number(e.target.value))) } });
                  }}
                  onFocus={(e) => e.target.select()}
                  className={`${input} w-20`}
                />
                <span className="text-xs text-muted">g</span>
              </label>
            </Row>
            <Row label={t('settings.gdmSnack')}>
              <label className="flex items-baseline gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={s.gdm.snackCarbs}
                  onChange={(e) => {
                    if (e.target.value !== '') updateSettings({ gdm: { ...s.gdm, snackCarbs: Math.max(1, Math.round(Number(e.target.value))) } });
                  }}
                  onFocus={(e) => e.target.select()}
                  className={`${input} w-20`}
                />
                <span className="text-xs text-muted">g</span>
              </label>
            </Row>
          </>
        )}
      </section>

      <Section id="supps" title={t('settings.supps')}>
        <p className="mt-1 px-1 text-xs text-muted">{t('settings.suppHint')}</p>
        <section className="mt-2 space-y-2">
          {supplements.map((sp) => (
            <div key={`${sp.id}-${cardVersion[sp.id] ?? 0}`} className="rounded-3xl bg-card p-4">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  defaultValue={sp.name}
                  placeholder={t('supp.multi')}
                  onChange={(e) => void db.supplements.update(sp.id, { name: e.target.value.slice(0, 60) })}
                  className="min-w-0 flex-1 rounded-lg bg-bg px-3 py-1.5 outline-none placeholder:text-muted"
                />
                <button type="button" role="switch" aria-checked={sp.enabled} onClick={() => void db.supplements.update(sp.id, { enabled: !sp.enabled })} className={`relative h-6 w-10 rounded-full transition-colors ${sp.enabled ? 'bg-accent' : 'bg-line'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card transition-[left] ${sp.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                <button type="button" aria-label={t('settings.delete')} onClick={() => void removeSupplement(sp.id)} className="p-1 text-muted">
                  <TrashIcon width={18} height={18} />
                </button>
              </div>
              <button type="button" onClick={() => startScan(sp.id)} disabled={scanState?.busy} className="mt-3 flex items-center gap-1.5 text-sm text-accent disabled:opacity-60">
                <CameraIcon width={16} height={16} /> {t('settings.scan')}
              </button>
              {scanState?.id === sp.id && <p className="mt-1 text-xs text-muted">{scanState.text}</p>}
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                {SUPP_KEYS.map((k) => (
                  <label key={k} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted">{t(`n.${k}` as TKey)}</span>
                    <span className="flex items-baseline gap-1">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        placeholder="0"
                        defaultValue={sp.nutrients[k] || ''}
                        onChange={(e) => void db.supplements.update(sp.id, { [`nutrients.${k}`]: Math.max(0, Number(e.target.value) || 0) } as Partial<Supplement>)}
                        className={`${input} w-16`}
                      />
                      <span className="w-6 text-xs text-muted">{NUTRIENTS[k].unit}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button type="button" onClick={() => void addSupplement()} className="w-full rounded-3xl border border-dashed border-line py-3 text-sm text-accent">
            + {t('settings.suppAdd')}
          </button>
        </section>
      </Section>

      <section className="mt-7 divide-y divide-line rounded-3xl bg-card">
        <Row label={t('settings.language')}>
          <div className="flex rounded-full bg-bg p-0.5 text-sm">
            {(['zh', 'en'] as Lang[]).map((l) => (
              <button key={l} type="button" onClick={() => updateSettings({ lang: l })} className={`rounded-full px-3 py-1.5 ${s.lang === l ? 'bg-card font-medium shadow-sm' : 'text-muted'}`}>
                {l === 'zh' ? '中文' : 'EN'}
              </button>
            ))}
          </div>
        </Row>
        <Row label={t('settings.passcode')} hint={t('settings.passcodeHint')}>
          <input type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} value={s.passcode} onChange={(e) => updateSettings({ passcode: e.target.value })} className={`${input} w-32`} />
        </Row>
      </section>

      <h2 className="mt-7 px-1 text-sm text-muted">{t('settings.model')}</h2>
      <section className="mt-2 rounded-3xl bg-card p-3">
        <div role="radiogroup" aria-label={t('settings.model')} className="flex rounded-full bg-bg p-0.5 text-sm">
          {PROVIDERS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={s.provider === p} onClick={() => updateSettings({ provider: p })} className={`flex-1 whitespace-nowrap rounded-full px-2 py-1.5 ${s.provider === p ? 'bg-card font-medium shadow-sm' : 'text-muted'}`}>
              {PROVIDER_NAMES[p]}
            </button>
          ))}
        </div>
      </section>
      <p className="mt-2 px-1 text-xs leading-relaxed text-muted">{t('settings.modelHint')}</p>

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
      <input ref={scanRef} type="file" accept="image/*" onChange={(e) => void handleScan(e)} hidden />
      {msg && <p className="mt-3 px-1 text-sm text-accent">{msg}</p>}
      <p className="mt-6 px-1 text-xs leading-relaxed text-muted">{t('settings.local')}</p>
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted">{t('settings.disclaimer')}</p>
    </div>
  );
}

async function removeSupplement(id: number) {
  await db.transaction('rw', db.supplements, db.supplementLogs, async () => {
    await db.supplementLogs.filter((l) => l.supplementId === id).delete();
    await db.supplements.delete(id);
  });
}

function cleanProfile(p: Partial<Profile>): Partial<Profile> {
  const out: Partial<Profile> = {};
  if (typeof p.dueDate === 'string') out.dueDate = p.dueDate;
  for (const k of ['age', 'heightCm', 'prePregnancyKg'] as const) {
    const v = p[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
  }
  if (p.activity === 'low' || p.activity === 'moderate' || p.activity === 'high') out.activity = p.activity;
  return out;
}

function cleanNutrients(n: unknown): Supplement['nutrients'] {
  const out: Supplement['nutrients'] = {};
  if (!n || typeof n !== 'object') return out;
  for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
    if (k in NUTRIENTS && typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k as NutrientKey] = v;
  }
  return out;
}

/**
 * A collapsible group of settings: the muted heading toggles it. Closed unless `defaultOpen` or opened before;
 * a choice made by hand is kept for the session (see setSectionOpen), so coming back finds it as it was left.
 */
function Section({ id, title, first, defaultOpen, children }: { id: SettingsSection; title: string; first?: boolean; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(isSectionOpen(id) ?? Boolean(defaultOpen));
  function toggle() {
    setSectionOpen(id, !open);
    setOpen(!open);
  }
  return (
    <>
      <h2 className={first ? 'mt-5' : 'mt-7'}>
        <button type="button" aria-expanded={open} onClick={toggle} className="-my-1 flex w-full items-center justify-between py-1 pl-1 pr-2 text-sm text-muted">
          <span>{title}</span>
          <ChevronIcon width={16} height={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
      </h2>
      {open && children}
    </>
  );
}

function Row({ label, hint, onHint, children }: { label: string; hint?: string; onHint?: () => void; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate">{label}</p>
        {hint && (onHint ? <button type="button" onClick={onHint} className="text-xs text-accent">{hint}</button> : <p className="text-xs text-muted">{hint}</p>)}
      </div>
      {children}
    </div>
  );
}
