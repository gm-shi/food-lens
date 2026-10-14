import { translate, type Lang } from '../i18n';
import { localDateKey } from './db';

export function dayLabel(dateKey: string, lang: Lang): string {
  const today = localDateKey();
  if (dateKey === today) return translate(lang, 'date.today');
  if (dateKey === localDateKey(Date.now() - 86_400_000)) return translate(lang, 'date.yesterday');
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
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
