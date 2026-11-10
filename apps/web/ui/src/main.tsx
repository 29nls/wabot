import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

try {
  const stored = localStorage.getItem('wabot-theme');
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.dataset.theme = stored;
  }
} catch {
  // Tema sistem tetap dipakai bila localStorage tidak tersedia.
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Elemen root tidak ditemukan.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
