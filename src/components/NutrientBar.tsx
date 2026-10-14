import { useT, type TKey } from '../i18n';
import { fmt, NUTRIENTS } from '../lib/nutrients';
import type { Target } from '../lib/targets';

export default function NutrientBar({ target, value, compact = false }: { target: Target; value: number; compact?: boolean }) {
  const t = useT();
  const { key, kind, upper } = target;
  const unit = NUTRIENTS[key].unit;
  const pct = target.value > 0 ? Math.min(100, (value / target.value) * 100) : 0;
  const overLimit = kind === 'limit' && value > target.value;
  const overUpper = upper !== undefined && value > upper;
  const alert = overLimit || overUpper;
  return (
    <div className={compact ? 'py-1.5' : 'py-2'}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>
          {t(`n.${key}` as TKey)}
          {kind === 'limit' && <span className="ml-1 text-xs text-muted">{t('n.limit')}</span>}
        </span>
        <span className={`tabular-nums ${alert ? 'text-warn' : ''}`}>
          {fmt(key, value)} <span className="text-muted">/ {fmt(key, target.value)} {unit}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full ${alert ? 'bg-warn' : kind === 'limit' ? 'bg-muted/60' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
      {overUpper && <p className="mt-1 text-xs text-warn">{t('n.over')}</p>}
    </div>
  );
}
