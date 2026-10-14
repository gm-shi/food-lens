import { useT } from '../i18n';
import { ClockIcon, HomeIcon, ScaleIcon, SlidersIcon } from './Icons';

export type Tab = 'today' | 'weight' | 'history' | 'settings';

export default function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const t = useT();
  const tabs: { id: Tab; label: string; Icon: typeof HomeIcon }[] = [
    { id: 'today', label: t('tab.today'), Icon: HomeIcon },
    { id: 'weight', label: t('tab.weight'), Icon: ScaleIcon },
    { id: 'history', label: t('tab.history'), Icon: ClockIcon },
    { id: 'settings', label: t('tab.settings'), Icon: SlidersIcon },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/90 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Main"
    >
      <div className="mx-auto flex max-w-md">
        {tabs.map(({ id, label, Icon }) => {
          const active = id === tab;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] ${active ? 'text-accent' : 'text-muted'}`}
            >
              <Icon width={22} height={22} strokeWidth={active ? 2.2 : 1.8} />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
