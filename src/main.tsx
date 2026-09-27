import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initPersistence } from './persist/db';
import { initTheme } from './ui/theme';
import { initHistory } from './state/history';
import { useStore } from './state/store';
import './styles/app.css';

void initPersistence().then(() => {
  initTheme();
  // After restoring, so the restored deck isn't an undo step.
  initHistory(useStore);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
