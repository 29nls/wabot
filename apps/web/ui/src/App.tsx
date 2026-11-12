import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  getHealth,
  getSession,
  login,
  logout,
  logoutAll,
  type BotStatus,
  type HealthData,
  type SessionData
} from './api';
import { AppShell, BrandLine, ThemeToggle } from './Shell';
import { PairPage } from './PairPage';
import { GroupsPage } from './GroupsPage';
import { GroupDetailPage } from './GroupDetailPage';
import { CommandsPage } from './CommandsPage';
import { LogsPage } from './LogsPage';
import { SchedulerPage } from './SchedulerPage';
import { SettingsPage } from './SettingsPage';

type View =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; session: SessionData }
  | { kind: 'error' };

type HealthView =
  | { kind: 'loading' }
  | { kind: 'ok'; data: HealthData }
  | { kind: 'error' };

const botLabels: Record<BotStatus, string> = {
  unpaired: 'Belum dipasangkan',
  pairing: 'Sedang pairing',
  connected: 'Terhubung',
  disconnected: 'Terputus',
  logged_out: 'Sesi berakhir',
  error: 'Butuh perhatian'
};

function LoadingScreen() {
  return (
    <main className="state-screen" aria-live="polite">
      <div className="state-content">
        <BrandLine />
        <div className="loading-line" aria-hidden="true" />
        <p className="state-title">Memeriksa sesi.</p>
        <p className="state-copy">Menyiapkan dashboard dan koneksi ke Worker.</p>
      </div>
    </main>
  );
}

function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="state-screen">
      <div className="state-content">
        <BrandLine />
        <p className="state-title">Sesi tidak bisa dimuat.</p>
        <p className="state-copy">
          Worker tidak merespons atau sesi tidak dapat diperiksa. Coba muat ulang.
        </p>
        <button type="button" className="primary-button state-button" onClick={onRetry}>
          Coba lagi
        </button>
      </div>
    </main>
  );
}

function LoginPage({ onAuthenticated }: { onAuthenticated: (session: SessionData) => void }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!password.trim()) {
      setError('Masukkan kata sandi dashboard.');
      return;
    }

    setSubmitting(true);

    try {
      const result = await login(password);

      if (result.status === 200 && result.body?.ok) {
        const sessionResult = await getSession();
        if (sessionResult.status === 200 && sessionResult.body?.ok) {
          onAuthenticated(sessionResult.body.data);
          return;
        }

        onAuthenticated({
          authenticated: true,
          csrf_token: result.body.data.csrf_token,
          expires_at: result.body.data.expires_at,
          bot: null,
          pair_request: null
        });
        return;
      }

      if (result.status === 429 && result.body && !result.body.ok) {
        const retry = result.body.error.retry_after_seconds;
        setError(
          retry
            ? `Terlalu banyak percobaan. Coba lagi dalam ${retry} detik.`
            : 'Terlalu banyak percobaan. Coba lagi sebentar.'
        );
      } else if (result.status === 401) {
        setError('Kata sandi salah.');
      } else if (result.status === 403) {
        setError('Permintaan ditolak. Muat ulang halaman lalu coba lagi.');
      } else if (result.body && !result.body.ok) {
        setError(result.body.error.message);
      } else {
        setError('Tidak bisa masuk. Coba lagi.');
      }
    } catch {
      setError('Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-intro">
        <BrandLine />

        <div className="intro-copy-block">
          <h1>Kendali grup, tanpa QR.</h1>
          <p className="intro-copy">
            Pairing lewat kode 8 digit, pengaturan per grup, dan data yang tersimpan di D1.
            Dashboard ini adalah pintu masuk ke daemon WhatsApp.
          </p>
        </div>

        <dl className="ledger" aria-label="Cara kerja Wabot">
          <div className="ledger-row">
            <dt>Pairing</dt>
            <dd>Kode 8 digit</dd>
          </div>
          <div className="ledger-row">
            <dt>Data</dt>
            <dd>D1 sebagai sumber kebenaran</dd>
          </div>
          <div className="ledger-row">
            <dt>Runtime</dt>
            <dd>Worker di freebuff.page</dd>
          </div>
        </dl>

        <p className="disclaimer">
          Wabot memakai protokol WhatsApp Web tidak resmi. Gunakan nomor khusus bot dan
          patuhi Ketentuan Layanan WhatsApp.
        </p>
      </header>

      <main className="auth-panel">
        <div className="auth-panel-top">
          <span className="mono-label">Akses owner</span>
          <ThemeToggle />
        </div>

        <div className="auth-form-wrap">
          <p className="section-kicker">Dashboard</p>
          <h2 id="login-title">Masuk ke control plane</h2>
          <p className="form-intro">Masukkan kata sandi dashboard untuk membuka sesi.</p>

          <form className="login-form" onSubmit={handleSubmit} noValidate aria-labelledby="login-title">
            <label htmlFor="password">Kata sandi</label>
            <div className="input-row">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
                maxLength={200}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : 'login-help'}
              />
              <button
                type="button"
                className="reveal-button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
              >
                {showPassword ? 'Sembunyikan' : 'Tampilkan'}
              </button>
            </div>

            <p id="login-help" className="field-help">
              Kata sandi diverifikasi di Worker, bukan di browser.
            </p>

            {error ? (
              <p id="login-error" className="form-error" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? 'Memeriksa...' : 'Masuk ke dashboard'}
            </button>
          </form>

          <p className="microcopy">
            Sesi disimpan sebagai cookie HttpOnly. Token CSRF dikirim di memori, bukan
            localStorage.
          </p>
        </div>
      </main>
    </div>
  );
}

function StatusValue({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: string }) {
  return (
    <span className="status-value">
      <span className={`status-dot ${tone}`} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

interface HomePageProps {
  session: SessionData;
  onLogout: () => void;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
}

function HomePage({ session, onLogout, onNavigate, onRefresh }: HomePageProps) {
  const [health, setHealth] = useState<HealthView>({ kind: 'loading' });
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [logoutAllError, setLogoutAllError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    setHealth({ kind: 'loading' });
    try {
      const result = await getHealth();
      if (result.status === 200 && result.body?.ok) {
        setHealth({ kind: 'ok', data: result.body.data });
      } else {
        setHealth({ kind: 'error' });
      }
    } catch {
      setHealth({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError(null);

    try {
      const result = await logout(session.csrf_token);
      if (result.status === 200 || result.status === 401) {
        onLogout();
        return;
      }

      setLogoutError(
        result.body && !result.body.ok ? result.body.error.message : 'Tidak bisa keluar. Coba lagi.'
      );
    } catch {
      setLogoutError('Tidak bisa menghubungi server. Coba lagi.');
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleLogoutAll() {
    setLoggingOutAll(true);
    setLogoutAllError(null);

    try {
      const result = await logoutAll(session.csrf_token);
      if (result.status === 200 || result.status === 401) {
        onLogout();
        return;
      }

      setLogoutAllError(
        result.body && !result.body.ok
          ? result.body.error.message
          : 'Tidak bisa mencabut semua sesi. Coba lagi.'
      );
    } catch {
      setLogoutAllError('Tidak bisa menghubungi server. Coba lagi.');
    } finally {
      setLoggingOutAll(false);
    }
  }

  const botLabel = session.bot ? botLabels[session.bot.status] : 'Belum terdaftar';
  const heartbeat =
    session.bot?.last_seen_at != null
      ? new Date(session.bot.last_seen_at).toLocaleString('id-ID', {
          dateStyle: 'medium',
          timeStyle: 'short'
        })
      : 'Belum ada heartbeat';

  return (
    <AppShell
      path="/"
      version={health.kind === 'ok' ? health.data.version : 'v0.1.0'}
      loggingOut={loggingOut}
      onLogout={() => void handleLogout()}
      onNavigate={onNavigate}
    >
      <main className="app-main">
        <p className="section-kicker">Sesi owner</p>
        <h1>Control plane aktif.</h1>
        <p className="lead">
          Worker, sesi, dan skema D1 siap. Langkah berikutnya menautkan nomor bot lewat kode
          pairing 8 digit.
        </p>

        {logoutError ? (
          <p className="form-error page-error" role="alert">
            {logoutError}
          </p>
        ) : null}

        {logoutAllError ? (
          <p className="form-error page-error" role="alert">
            {logoutAllError}
          </p>
        ) : null}

        <section className="status-board" aria-labelledby="status-title">
          <div className="board-header">
            <h2 id="status-title">Status sistem</h2>
            <button type="button" className="text-button" onClick={() => void loadHealth()}>
              Periksa lagi
            </button>
          </div>

          <dl className="status-list">
            <div className="status-row">
              <dt>Worker</dt>
              <dd>
                {health.kind === 'loading' ? (
                  <StatusValue tone="muted">Memeriksa</StatusValue>
                ) : health.kind === 'ok' ? (
                  <StatusValue tone="ok">Aktif</StatusValue>
                ) : (
                  <StatusValue tone="warn">Tidak terjangkau</StatusValue>
                )}
              </dd>
            </div>
            <div className="status-row">
              <dt>Database</dt>
              <dd>
                {health.kind === 'loading' ? (
                  <StatusValue tone="muted">Memeriksa</StatusValue>
                ) : health.kind === 'ok' && health.data.database === 'ok' ? (
                  <StatusValue tone="ok">Terhubung</StatusValue>
                ) : (
                  <StatusValue tone="warn">Belum siap</StatusValue>
                )}
              </dd>
            </div>
            <div className="status-row">
              <dt>Bot</dt>
              <dd>
                <StatusValue tone={session.bot?.status === 'connected' ? 'ok' : 'muted'}>
                  {botLabel}
                </StatusValue>
              </dd>
            </div>
            <div className="status-row">
              <dt>Heartbeat</dt>
              <dd className="status-plain">{heartbeat}</dd>
            </div>
          </dl>
        </section>

        <section className="foundation-board" aria-labelledby="foundation-title">
          <div className="board-header">
            <h2 id="foundation-title">Pairing bot</h2>
            <button type="button" className="text-button" onClick={() => onNavigate('/pair')}>
              Buka wizard
            </button>
          </div>
          <p className="board-copy">
            {session.pair_request
              ? 'Ada permintaan pairing yang belum selesai. Lanjutkan untuk melihat kode atau membatalkannya.'
              : 'Tautkan nomor bot lewat kode 8 digit. Tidak perlu memindai QR.'}
          </p>
          <ul>
            <li>Nomor disimpan dalam format internasional, kode berlaku 120 detik.</li>
            <li>Permintaan kedaluwarsa ditandai otomatis saat dashboard dibuka.</li>
            <li>Kode dihapus dari D1 setelah status akhir tercatat.</li>
          </ul>
          {session.bot?.phone_masked ? (
            <p className="microcopy">Nomor tertaut: {session.bot.phone_masked}</p>
          ) : null}
          <button type="button" className="text-button" onClick={onRefresh}>
            Segarkan sesi
          </button>
        </section>

        <section className="status-board" aria-labelledby="session-security-title">
          <div className="board-header">
            <h2 id="session-security-title">Keamanan sesi</h2>
          </div>
          <p className="board-copy">
            Keluar dari semua perangkat menaikkan versi sesi bot. Semua cookie dashboard
            yang pernah disalin langsung tidak berlaku, termasuk sesi di perangkat ini.
          </p>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void handleLogoutAll()}
            disabled={loggingOutAll}
          >
            {loggingOutAll ? 'Mencabut semua sesi...' : 'Keluar dari semua perangkat'}
          </button>
        </section>

        <p className="disclaimer app-disclaimer">
          Wabot memakai protokol WhatsApp Web tidak resmi. Penggunaan pada nomor utama
          berisiko pemblokiran. Gunakan nomor khusus bot dan hindari pengiriman massal.
        </p>
      </main>
    </AppShell>
  );
}

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [view, setView] = useState<View>({ kind: 'loading' });

  const loadSession = useCallback(async () => {
    setView({ kind: 'loading' });
    try {
      const result = await getSession();
      if (result.status === 200 && result.body?.ok) {
        setView({ kind: 'authenticated', session: result.body.data });
      } else if (result.status === 401) {
        setView({ kind: 'anonymous' });
      } else {
        setView({ kind: 'error' });
      }
    } catch {
      setView({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    function handlePopState() {
      setPath(window.location.pathname);
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (view.kind === 'anonymous' && path !== '/login') {
      window.history.replaceState(null, '', '/login');
      setPath('/login');
    }

    const knownPath =
      path === '/' ||
      path === '/pair' ||
      path === '/groups' ||
      path.startsWith('/groups/') ||
      path === '/commands' ||
      path === '/schedules' ||
      path === '/logs' ||
      path === '/settings';
    if (view.kind === 'authenticated' && !knownPath) {
      window.history.replaceState(null, '', '/');
      setPath('/');
    }
  }, [path, view]);

  function navigate(next: string) {
    if (next === path) return;
    window.history.pushState(null, '', next);
    setPath(next);
    window.scrollTo({ top: 0 });
  }

  const refreshSession = useCallback(async () => {
    try {
      const result = await getSession();
      if (result.status === 200 && result.body?.ok) {
        setView({ kind: 'authenticated', session: result.body.data });
      } else if (result.status === 401) {
        setView({ kind: 'anonymous' });
      }
    } catch {
      // Kegagalan penyegaran sesi tidak mengubah tampilan yang sudah ada.
    }
  }, []);

  function goToLogin() {
    setView({ kind: 'anonymous' });
    window.history.replaceState(null, '', '/login');
    setPath('/login');
  }

  if (view.kind === 'loading') return <LoadingScreen />;
  if (view.kind === 'error') return <ErrorScreen onRetry={() => void loadSession()} />;

  if (view.kind === 'anonymous') {
    return (
      <LoginPage
        onAuthenticated={(session) => {
          setView({ kind: 'authenticated', session });
          const next = window.location.pathname === '/pair' ? '/pair' : '/';
          window.history.replaceState(null, '', next);
          setPath(next);
        }}
      />
    );
  }

  if (path === '/pair') {
    return (
      <AppShell
        path="/pair"
        version="v0.1.0"
        loggingOut={false}
        onLogout={() => {
          void logout(view.session.csrf_token).finally(goToLogin);
        }}
        onNavigate={navigate}
      >
        <PairPage session={view.session} onSessionRefresh={() => void refreshSession()} />
      </AppShell>
    );
  }

  if (path === '/groups') {
    return (
      <AppShell
        path="/groups"
        version="v0.1.0"
        loggingOut={false}
        onLogout={() => {
          void logout(view.session.csrf_token).finally(goToLogin);
        }}
        onNavigate={navigate}
      >
        <GroupsPage session={view.session} onNavigate={navigate} />
      </AppShell>
    );
  }

  const groupMatch = /^\/groups\/(.+)$/.exec(path);
  if (groupMatch) {
    return (
      <AppShell
        path="/groups"
        version="v0.1.0"
        loggingOut={false}
        onLogout={() => {
          void logout(view.session.csrf_token).finally(goToLogin);
        }}
        onNavigate={navigate}
      >
        <GroupDetailPage
          session={view.session}
          jid={decodeURIComponent(groupMatch[1])}
          onNavigate={navigate}
        />
      </AppShell>
    );
  }

  if (path === '/commands') {
    return (
      <AppShell path="/commands" version="v0.1.0" loggingOut={false} onLogout={() => { void logout(view.session.csrf_token).finally(goToLogin); }} onNavigate={navigate}>
        <CommandsPage session={view.session} onNavigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/schedules') {
    return (
      <AppShell path="/schedules" version="v0.1.0" loggingOut={false} onLogout={() => { void logout(view.session.csrf_token).finally(goToLogin); }} onNavigate={navigate}>
        <SchedulerPage session={view.session} />
      </AppShell>
    );
  }

  if (path === '/logs') {
    return (
      <AppShell path="/logs" version="v0.1.0" loggingOut={false} onLogout={() => { void logout(view.session.csrf_token).finally(goToLogin); }} onNavigate={navigate}>
        <LogsPage session={view.session} />
      </AppShell>
    );
  }

  if (path === '/settings') {
    return (
      <AppShell path="/settings" version="v0.1.0" loggingOut={false} onLogout={() => { void logout(view.session.csrf_token).finally(goToLogin); }} onNavigate={navigate}>
        <SettingsPage session={view.session} onLogout={goToLogin} />
      </AppShell>
    );
  }

  return (
    <HomePage
      session={view.session}
      onNavigate={navigate}
      onRefresh={() => void refreshSession()}
      onLogout={goToLogin}
    />
  );
}
