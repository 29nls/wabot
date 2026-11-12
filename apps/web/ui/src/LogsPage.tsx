import { useCallback, useEffect, useState } from 'react';
import { getEvents, type EventItem, type SessionData } from './api';

export function LogsPage({ session: _session }: { session: SessionData }) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [level, setLevel] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async (silent = false) => {
    if (!silent) setState('loading');
    try {
      const result = await getEvents(level || undefined, 100);
      if (result.status === 200 && result.body?.ok) {
        setEvents(result.body.data.events);
        setState('ready');
      } else if (!silent) {
        setState('error');
      }
    } catch {
      if (!silent) setState('error');
    }
  }, [level]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 3000);
    return () => clearInterval(id);
  }, [load]);

  function download() {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wabot-events.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-main">
      <p className="section-kicker">Log</p>
      <h1>Event teknis</h1>
      <label htmlFor="level">Level</label>
      <select id="level" value={level} onChange={(e) => setLevel(e.target.value)}>
        <option value="">Semua</option>
        <option value="debug">debug</option>
        <option value="info">info</option>
        <option value="warn">warn</option>
        <option value="error">error</option>
      </select>
      <p className="field-help">Diperbarui otomatis tiap 3 detik saat tab aktif.</p>
      <button type="button" className="ghost-button" onClick={() => void load()}>
        Muat ulang
      </button>
      <button type="button" className="ghost-button" onClick={download}>
        Unduh JSON
      </button>
      {state === 'loading' ? <p className="field-help">Memuat log...</p> : null}
      {state === 'error' ? <p className="form-error page-error">Log tidak bisa dimuat.</p> : null}
      {state === 'ready' && events.length === 0 ? <p className="field-help">Belum ada event.</p> : null}
      <ul>
        {events.map((event) => (
          <li key={event.id}>
            <span className="mono-value">{event.level}</span> · {event.scope} · {event.message} ·{' '}
            {new Date(event.created_at).toLocaleString('id-ID')}
          </li>
        ))}
      </ul>
    </main>
  );
}