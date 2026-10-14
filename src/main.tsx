import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Check for a new version whenever the app comes back to the foreground.
// Never force a reload here: an analysis in progress must not be lost.
if ('serviceWorker' in navigator) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.update())
      .catch(() => {});
  });
}
