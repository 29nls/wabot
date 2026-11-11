import { useState } from 'react';
import { getHealth, logoutAll, type HealthData, type SessionData } from './api';

export function SettingsPage({ session, onLogout }: { session: SessionData; onLogout: () => void }) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  async function loadHealth() {
    const result = await getHealth();
    if (result.status === 200 && result.body?.ok) setHealth(result.body.data);
  }

  async function handleLogoutAll() {
    setLoggingOutAll(true);
    await logoutAll(session.csrf_token);
    setLoggingOutAll(false);
    onLogout();
  }

  return (
    <main className="app-main">
      <p className="section-kicker">Pengaturan</p>
      <h1>Info bot dan sesi</h1>
      <button type="button" className="ghost-button" onClick={() => void loadHealth()}>
        Periksa health
      </button>
      {health ? (
        <ul>
          <li>Versi: {health.version}</li>
          <li>Status: {health.status}</li>
          <li>Database: {health.database}</li>
          <li>Schema: {health.schema}</li>
        </ul>
      ) : null}
      <p className="board-copy">
        Nomor tertaut: {session.bot?.phone_masked ?? 'Belum ada'} · Status:{' '}
        {session.bot?.status ?? 'unpaired'}
      </p>
      <p className="disclaimer">
        Wabot memakai protokol WhatsApp Web tidak resmi. Gunakan nomor khusus bot.
      </p>
      <button
        type="button"
        className="ghost-button"
        onClick={() => void handleLogoutAll()}
        disabled={loggingOutAll}
      >
        {loggingOutAll ? 'Mencabut...' : 'Keluar dari semua perangkat'}
      </button>
    </main>
  );
}