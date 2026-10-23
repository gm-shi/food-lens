import { translate, type Lang } from '../i18n';
import { localDateKey } from './db';

/** Local calendar day from a YYYY-MM-DD key. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The day `n` days after the key (DST-safe: counts calendar days, not 24-hour spans). */
export function addDays(key: string, n: number): string {
  const d = parseDateKey(key);
  return localDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime());
}

/** Whole calendar days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDateKey(b).getTime() - parseDateKey(a).getTime()) / 86_400_000);
}

/** Monday of the week that contains the day. */
export function weekStartOf(key: string): string {
  const back = (parseDateKey(key).getDay() + 6) % 7;
  return addDays(key, -back);
}

/** The start of the minute on the given day and HH:MM, in local time. */
export function timestampOf(dateKey: string, time: string): number {
  const d = parseDateKey(dateKey);
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  const hh = m ? Math.min(23, Number(m[1])) : 12;
  const mm = m ? Math.min(59, Number(m[2])) : 0;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime();
}

/** HH:MM of a timestamp, for a time input. */
export function timeKey(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function dayLabel(dateKey: string, lang: Lang): string {
  const today = localDateKey();
  if (dateKey === today) return translate(lang, 'date.today');
  if (dateKey === addDays(today, -1)) return translate(lang, 'date.yesterday');
  const date = parseDateKey(dateKey);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: lang === 'zh' ? 'long' : 'short',
    day: 'numeric',
    weekday: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function timeLabel(ts: number, lang: Lang): string {
  return new Date(ts).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}
