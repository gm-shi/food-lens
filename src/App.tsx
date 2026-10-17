import { useEffect, useState } from 'react';
import { useSettings } from './lib/settings';
import Onboarding from './screens/Onboarding';
import Today from './screens/Today';
import Weight from './screens/Weight';
import History from './screens/History';
import Settings from './screens/Settings';
import Analyze, { type MealInput } from './screens/Analyze';
import TabBar, { type Tab } from './components/TabBar';

export default function App() {
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('today');
  const [input, setInput] = useState<MealInput | null>(null);

  useEffect(() => {
    document.documentElement.lang = settings.lang === 'zh' ? 'zh-CN' : 'en';
  }, [settings.lang]);

  if (!settings.onboarded) return <Onboarding />;
  if (input) return <Analyze input={input} onClose={() => setInput(null)} />;

  return (
    <div className="mx-auto min-h-dvh max-w-md">
      {tab === 'today' && <Today onPick={(file) => setInput({ kind: 'photo', file })} onText={(text) => setInput({ kind: 'text', text })} onEdit={(meal) => setInput({ kind: 'edit', meal })} onOpenSettings={() => setTab('settings')} />}
      {tab === 'weight' && <Weight />}
      {tab === 'history' && <History onEdit={(meal) => setInput({ kind: 'edit', meal })} />}
      {tab === 'settings' && <Settings />}
      <TabBar tab={tab} onChange={setTab} />
    </div>
  );
}
