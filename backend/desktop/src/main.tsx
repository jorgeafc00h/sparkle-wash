import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { store } from './store';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dev/test seam only: lets Playwright drive store transitions that normally
// originate in main-process callbacks (e.g. an invoice reaching Completada at
// MH, which the ticket-consolidation middleware reacts to). Never present in
// production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __fsStore?: typeof store }).__fsStore = store;
}
