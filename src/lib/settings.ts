import { useSyncExternalStore } from 'react';
import type { Lang } from '../i18n';
import type { NutrientKey } from './nutrients';

export type Activity = 'low' | 'moderate' | 'high';

/** Which API the Worker asks on this phone's behalf: DeepSeek, Claude (anthropic) or GPT-6.1 Sol (openai). */
export type Provider = 'deepseek' | 'anthropic' | 'openai';
/** In the order the picker shows them; the first is the default. */
export const PROVIDERS: readonly Provider[] = ['deepseek', 'anthropic', 'openai'];
export const DEFAULT_PROVIDER: Provider = PROVIDERS[0];

export function isProvider(v: unknown): v is Provider {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}

export interface Profile {
  /** ISO date YYYY-MM-DD */
  dueDate: string;
  age: number;
  heightCm: number;
  prePregnancyKg: number;
  activity: Activity;
}

export interface Gdm {
  enabled: boolean;
  /** grams of carbohydrate per main meal */
  mainCarbs: number;
  /** grams of carbohydrate per snack */
  snackCarbs: number;
}

/**
 * Starting points only; the dietitian's numbers replace them. NDSS carbohydrate-counting guidance
 * (NDSSFS005 v6, 2023) gives 30-45 g (2-3 × 15 g exchanges) per main meal and 15-30 g per snack for women;
 * the NDSS gestational-diabetes booklet (v11, 2025) defers the exact amount to the dietitian.
 */
export const GDM_DEFAULTS: Gdm = { enabled: false, mainCarbs: 45, snackCarbs: 20 };

/** Effective carbohydrate limit: a cleared or zero field falls back to the default. */
export function gdmLimit(g: Gdm, kind: 'main' | 'snack'): number {
  const v = kind === 'snack' ? g.snackCarbs : g.mainCarbs;
  return v > 0 ? v : kind === 'snack' ? GDM_DEFAULTS.snackCarbs : GDM_DEFAULTS.mainCarbs;
}

export interface Settings {
  lang: Lang;
  /** Sent as `provider` with every Worker request */
  provider: Provider;
  passcode: string;
  onboarded: boolean;
  profile: Profile | null;
  /** Per-nutrient daily target overrides (doctor's advice) */
  overrides: Partial<Record<NutrientKey, number>>;
  gdm: Gdm;
}

const KEY = 'food-lens:settings';

function defaults(): Settings {
  const zh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
  return { lang: zh ? 'zh' : 'en', provider: DEFAULT_PROVIDER, passcode: '', onboarded: false, profile: null, overrides: {}, gdm: { ...GDM_DEFAULTS } };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    // v1 stored a single calorie `target`; it is dropped, the profile now derives energy.
    const { target: _legacy, ...saved } = JSON.parse(raw) as Partial<Settings> & { target?: number };
    const g = { ...GDM_DEFAULTS, ...(saved.gdm ?? {}) };
    const s: Settings = { ...defaults(), ...saved, overrides: { ...(saved.overrides ?? {}) }, gdm: { ...g, mainCarbs: g.mainCarbs || GDM_DEFAULTS.mainCarbs, snackCarbs: g.snackCarbs || GDM_DEFAULTS.snackCarbs } };
    if (s.profile && (typeof s.profile.dueDate !== 'string' || !Number.isFinite(s.profile.heightCm))) s.profile = null;
    if (!isProvider(s.provider)) s.provider = DEFAULT_PROVIDER;
    return s;
  } catch {
    return defaults();
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: keep in memory */
  }
  listeners.forEach((l) => l());
}

export function setOverride(key: NutrientKey, value: number | undefined): void {
  const overrides = { ...current.overrides };
  if (value === undefined || !Number.isFinite(value)) delete overrides[key];
  else overrides[key] = value;
  updateSettings({ overrides });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Collapsible groups on the Settings screen. */
export type SettingsSection = 'profile' | 'targets' | 'supps';
const openSections = new Map<SettingsSection, boolean>();

/** Whether the user opened or closed a Settings section by hand this session; undefined if untouched. Not persisted. */
export function isSectionOpen(id: SettingsSection): boolean | undefined {
  return openSections.get(id);
}

export function setSectionOpen(id: SettingsSection, open: boolean): void {
  openSections.set(id, open);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}
