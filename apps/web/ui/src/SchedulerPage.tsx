import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  createSchedule,
  deleteSchedule,
  getGroups,
  getSchedules,
  updateSchedule,
  type GroupSummary,
  type ScheduleItem,
  type SessionData
} from './api';

const REPEAT_OPTIONS = [
  { value: 0, label: 'Sekali' },
  { value: 3600, label: 'Tiap jam' },
  { value: 86400, label: 'Tiap hari' },
  { value: 604800, label: 'Tiap minggu' }
];

function toLocalInput(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function SchedulerPage({ session }: { session: SessionData }) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupJid, setGroupJid] = useState('');
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [runAt, setRunAt] = useState(() => toLocalInput(Date.now() + 60 * 60 * 1000));
  const [repeatSec, setRepeatSec] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    const result = await getGroups('', 'all');
    if (result.status === 200 && result.body?.ok) {
      setGroups(result.body.data.groups);
      if (!groupJid && result.body.data.groups.length > 0) {
        setGroupJid(result.body.data.groups[0].jid);
      }
    }
  }, [groupJid]);

  const loadSchedules = useCallback(async () => {
    if (!groupJid) {
      setSchedules([]);
      setState('ready');
      return;
    }
    setState('loading');
    const result = await getSchedules(groupJid);
    if (result.status === 200 && result.body?.ok) {
      setSchedules(result.body.data);
      setState('ready');
    } else {
      setState('error');
    }
  }, [groupJid]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!groupJid) return;
    const nextRunAt = new Date(runAt).getTime();
    if (!message.trim() || !Number.isFinite(nextRunAt)) {
      setError('Isi pesan dan waktu kirim.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await createSchedule(session.csrf_token, groupJid, {
        message: message.trim(),
        next_run_at: nextRunAt,
        repeat_sec: repeatSec,
        enabled: true
      });
      if (result.status === 201 && result.body?.ok) {
        setMessage('');
        await loadSchedules();
      } else {
        setError(result.body && !result.body.ok ? result.body.error.message : 'Gagal menyimpan jadwal.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(item: ScheduleItem) {
    await updateSchedule(session.csrf_token, item.id, { enabled: item.enabled !== 1 });
    await loadSchedules();
  }

  async function handleDelete(id: string) {
    await deleteSchedule(session.csrf_token, id);
    await loadSchedules();
  }

  return (
    <main className="app-main">
      <p className="section-kicker">Jadwal</p>
      <h1>Pesan terjadwal</h1>
      <p className="lead">
        Bot mengirim pesan saat waktu tiba selama daemon berjalan. Jadwal berulang memakai
        interval tetap, bukan ekspresi cron.
      </p>

      <label htmlFor="schedule-group">Grup</label>
      <select id="schedule-group" value={groupJid} onChange={(e) => setGroupJid(e.target.value)}>
        {groups.map((group) => (
          <option key={group.jid} value={group.jid}>
            {group.name}
          </option>
        ))}
      </select>

      <form className="settings-form" onSubmit={handleCreate}>
        <label htmlFor="schedule-message">Pesan</label>
        <textarea
          id="schedule-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1000}
        />
        <label htmlFor="schedule-time">Kirim pada</label>
        <input
          id="schedule-time"
          type="datetime-local"
          value={runAt}
          onChange={(e) => setRunAt(e.target.value)}
        />
        <label htmlFor="schedule-repeat">Ulangi</label>
        <select
          id="schedule-repeat"
          value={repeatSec}
          onChange={(e) => setRepeatSec(Number(e.target.value))}
        >
          {REPEAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit" className="primary-button" disabled={saving || !groupJid}>
          {saving ? 'Menyimpan...' : 'Tambah jadwal'}
        </button>
        {error ? <p className="form-error page-error">{error}</p> : null}
      </form>

      {state === 'loading' ? <p className="field-help">Memuat jadwal...</p> : null}
      {state === 'error' ? <p className="form-error page-error">Jadwal tidak bisa dimuat.</p> : null}
      {state === 'ready' && schedules.length === 0 ? (
        <p className="field-help">Belum ada jadwal untuk grup ini.</p>
      ) : null}
      {schedules.map((item) => (
        <div key={item.id} className="status-row">
          <span>{item.message}</span>
          <span className="mono-value">
            {new Date(item.next_run_at).toLocaleString('id-ID')}
          </span>
          <span className="field-help">
            {item.repeat_sec === 0 ? 'sekali' : `tiap ${item.repeat_sec} detik`}
          </span>
          <button type="button" className="ghost-button" onClick={() => void handleToggle(item)}>
            {item.enabled === 1 ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
          <button type="button" className="ghost-button" onClick={() => void handleDelete(item.id)}>
            Hapus
          </button>
        </div>
      ))}
    </main>
  );
}
