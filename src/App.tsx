import { useEffect, useState } from 'react';
import { localDateKey } from './lib/db';
import { useSettings } from './lib/settings';
import Onboarding from './screens/Onboarding';
import Today from './screens/Today';
import Weight from './screens/Weight';
import History from './screens/History';
import Settings from './screens/Settings';
import Analyze, { type MealInput, type SavedMeal } from './screens/Analyze';
import TabBar, { type Tab } from './components/TabBar';

export default function App() {
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('today');
  const [input, setInput] = useState<MealInput | null>(null);
  /** A day History should open on: set when a meal was saved to an earlier day, so it can be seen at once. */
  const [historyFocus, setHistoryFocus] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = settings.lang === 'zh' ? 'zh-CN' : 'en';
  }, [settings.lang]);

  function changeTab(next: Tab) {
    setHistoryFocus(null);
    setTab(next);
  }

  function closeAnalyze(saved?: SavedMeal) {
    setInput(null);
    if (!saved) return;
    const earlier = saved.date !== localDateKey();
    setHistoryFocus(earlier ? saved.date : null);
    if (earlier) setTab('history');
  }

  if (!settings.onboarded) return <Onboarding />;
  if (input) return <Analyze input={input} onClose={closeAnalyze} />;

  return (
    <div className="mx-auto min-h-dvh max-w-md">
      {tab === 'today' && <Today onPick={(file) => setInput({ kind: 'photo', file })} onText={(text) => setInput({ kind: 'text', text })} onEdit={(meal) => setInput({ kind: 'edit', meal })} onOpenSettings={() => setTab('settings')} />}
      {tab === 'weight' && <Weight />}
      {tab === 'history' && (
        <History
          key={historyFocus ?? ''}
          focusDate={historyFocus}
          onEdit={(meal) => setInput({ kind: 'edit', meal })}
          onPick={(file, date) => {
            setHistoryFocus(date);
            setInput({ kind: 'photo', file, date });
          }}
          onText={(text, date) => {
            setHistoryFocus(date);
            setInput({ kind: 'text', text, date });
          }}
        />
      )}
      {tab === 'settings' && <Settings />}
      <TabBar tab={tab} onChange={changeTab} />
    </div>
  );
}
