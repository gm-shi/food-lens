import { useEffect, useState } from 'react';
import { useSettings } from './lib/settings';
import Onboarding from './screens/Onboarding';
import Today from './screens/Today';
import Weight from './screens/Weight';
import History from './screens/History';
import Settings from './screens/Settings';
import Analyze from './screens/Analyze';
import TabBar, { type Tab } from './components/TabBar';

export default function App() {
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('today');
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    document.documentElement.lang = settings.lang === 'zh' ? 'zh-CN' : 'en';
  }, [settings.lang]);

  if (!settings.onboarded) return <Onboarding />;
  if (file) return <Analyze file={file} onClose={() => setFile(null)} />;

  return (
    <div className="mx-auto min-h-dvh max-w-md">
      {tab === 'today' && <Today onPick={setFile} onOpenSettings={() => setTab('settings')} />}
      {tab === 'weight' && <Weight />}
      {tab === 'history' && <History />}
      {tab === 'settings' && <Settings />}
      <TabBar tab={tab} onChange={setTab} />
    </div>
  );
}
