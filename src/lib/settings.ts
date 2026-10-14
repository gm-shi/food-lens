import { useSyncExternalStore } from 'react';
import type { Lang } from '../i18n';

export interface Settings {
  lang: Lang;
  target: number;
  passcode: string;
  onboarded: boolean;
}

const KEY = 'food-lens:settings';

function defaults(): Settings {
  const zh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
  return { lang: zh ? 'zh' : 'en', target: 1800, passcode: '', onboarded: false };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults(), ...(JSON.parse(raw) as Partial<Settings>) } : defaults();
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

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}
