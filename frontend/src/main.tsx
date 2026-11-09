import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './OperationsApp.tsx';
import './operations.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element missing');
ReactDOM.createRoot(rootElement).render(<React.StrictMode><App /></React.StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}
