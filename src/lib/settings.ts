import { useSyncExternalStore } from 'react';
import type { Lang } from '../i18n';
import type { NutrientKey } from './nutrients';

export type Activity = 'low' | 'moderate' | 'high';

export interface Profile {
  /** ISO date YYYY-MM-DD */
  dueDate: string;
  age: number;
  heightCm: number;
  prePregnancyKg: number;
  activity: Activity;
}

export interface Settings {
  lang: Lang;
  passcode: string;
  onboarded: boolean;
  profile: Profile | null;
  /** Per-nutrient daily target overrides (doctor's advice) */
  overrides: Partial<Record<NutrientKey, number>>;
}

const KEY = 'food-lens:settings';

function defaults(): Settings {
  const zh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
  return { lang: zh ? 'zh' : 'en', passcode: '', onboarded: false, profile: null, overrides: {} };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    // v1 stored a single calorie `target`; it is dropped, the profile now derives energy.
    const { target: _legacy, ...saved } = JSON.parse(raw) as Partial<Settings> & { target?: number };
    const s: Settings = { ...defaults(), ...saved, overrides: { ...(saved.overrides ?? {}) } };
    if (s.profile && (typeof s.profile.dueDate !== 'string' || !Number.isFinite(s.profile.heightCm))) s.profile = null;
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

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}
