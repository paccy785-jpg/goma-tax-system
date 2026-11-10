import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { LanguageProvider } from './i18n/LanguageContext';
import './index.css';
import { installDoubleSubmitGuard } from './utils/doubleSubmitGuard';

installDoubleSubmitGuard();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found — check index.html.');
}

createRoot(rootEl).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
);
