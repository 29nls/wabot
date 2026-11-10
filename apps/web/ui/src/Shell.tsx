import { useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

export interface NavItem {
  path: string;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Ringkasan' },
  { path: '/pair', label: 'Pairing' }
];

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem('wabot-theme');
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('wabot-theme', next);
    } catch {
      // Preferensi tema tidak perlu memblokir penggunaan dashboard.
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Gunakan mode terang' : 'Gunakan mode gelap'}
    >
      {theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
    </button>
  );
}

export function BrandLine({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`brand-line${compact ? ' compact' : ''}`}>
      <span className="brand-mark">WABOT</span>
      <span className="brand-slash">/</span>
      <span>CONTROL PLANE</span>
    </p>
  );
}

interface AppShellProps {
  path: string;
  version: string;
  loggingOut: boolean;
  onLogout: () => void;
  onNavigate: (path: string) => void;
  children: ReactNode;
}

export function AppShell({ path, version, loggingOut, onLogout, onNavigate, children }: AppShellProps) {
  return (
    <div className="app-page">
      <header className="app-header">
        <BrandLine compact />
        <div className="header-actions">
          <nav className="app-nav" aria-label="Navigasi utama">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.path}
                href={item.path}
                className="nav-link"
                aria-current={path === item.path ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(item.path);
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <ThemeToggle />
          <button type="button" className="ghost-button" onClick={onLogout} disabled={loggingOut}>
            {loggingOut ? 'Keluar...' : 'Keluar'}
          </button>
        </div>
      </header>

      {children}

      <footer className="app-footer">
        <span>Wabot {version}</span>
        <span>Worker + D1</span>
      </footer>
    </div>
  );
}
