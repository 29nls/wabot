import { useCallback, useEffect, useState } from 'react';
import {
  getGroup,
  updateGroupSettings,
  type GroupDetail,
  type GroupSettings,
  type SessionData
} from './api';

type Tab = 'umum' | 'sambutan' | 'moderasi' | 'xp';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'umum', label: 'Umum' },
  { id: 'sambutan', label: 'Penyambutan' },
  { id: 'moderasi', label: 'Moderasi' },
  { id: 'xp', label: 'XP' }
];

function parseAllowlist(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Nilai lama bukan JSON: perlakukan sebagai daftar dipisah baris.
  }
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readonlySet(setting: GroupSettings): GroupSettings {
  return { ...setting, link_allowlist: parseAllowlist(setting.link_allowlist).join('\n') };
}

function renderTemplate(template: string): string {
  return template
    .replaceAll('{nama}', 'Budi')
    .replaceAll('{grup}', 'Grup Contoh')
    .replaceAll('{tanggal}', new Date().toLocaleDateString('id-ID'));
}

interface GroupDetailPageProps {
  session: SessionData;
  jid: string;
  onNavigate: (path: string) => void;
}

export function GroupDetailPage({ session, jid, onNavigate }: GroupDetailPageProps) {
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [form, setForm] = useState<GroupSettings | null>(null);
  const [tab, setTab] = useState<Tab>('umum');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await getGroup(jid);
      if (result.status === 200 && result.body?.ok) {
        setGroup(result.body.data.group);
        setForm(readonlySet(result.body.data.settings));
        setState('ready');
        return;
      }
      setState('error');
    } catch {
      setState('error');
    }
  }, [jid]);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof GroupSettings>(key: K, value: GroupSettings[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await updateGroupSettings(session.csrf_token, jid, patch);
      if (result.status === 200 && result.body && result.body.ok) {
        setForm(readonlySet(result.body.data.settings));
        setSaved(true);
        return;
      }
      setError(
        result.body && !result.body.ok
          ? result.body.error.message
          : 'Tidak bisa menyimpan pengaturan grup.'
      );
    } catch {
      setError('Tidak bisa menghubungi server. Coba lagi.');
    } finally {
      setSaving(false);
    }
  }

  if (state === 'loading' || !form || !group) {
    return (
      <main className="app-main">
        <button type="button" className="text-button" onClick={() => onNavigate('/groups')}>
          Kembali ke daftar grup
        </button>
        {state === 'error' ? (
          <>
            <p className="form-error page-error" role="alert">
              Detail grup tidak bisa dimuat.
            </p>
            <button type="button" className="ghost-button" onClick={() => void load()}>
              Coba lagi
            </button>
          </>
        ) : (
          <p className="field-help">Memuat grup...</p>
        )}
      </main>
    );
  }

  const allowlistText = form.link_allowlist;

  return (
    <main className="app-main">
      <button type="button" className="text-button group-back" onClick={() => onNavigate('/groups')}>
        Kembali ke daftar grup
      </button>

      <p className="section-kicker">Grup</p>
      <h1>{group.name}</h1>
      <p className="lead">
        <span className="mono-value">{group.jid_masked}</span> · {group.member_count} anggota ·{' '}
        {group.is_active ? 'aktif' : 'nonaktif'}
      </p>

      <div className="settings-tabs" role="tablist" aria-label="Bagian pengaturan grup">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="ghost-button"
            aria-selected={tab === item.id}
            onClick={() => {
              setTab(item.id);
              setSaved(false);
              setError(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="form-error page-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? <p className="success-line">Pengaturan tersimpan.</p> : null}

      {tab === 'umum' ? (
        <section className="settings-form" aria-label="Pengaturan umum">
          <label htmlFor="prefix">Prefix command</label>
          <input
            id="prefix"
            value={form.prefix}
            maxLength={3}
            onChange={(event) => set('prefix', event.target.value)}
          />
          <p className="field-help">1-3 karakter tanpa spasi, misalnya titik atau seru.</p>

          <label htmlFor="locale">Bahasa bot</label>
          <select
            id="locale"
            value={form.locale}
            onChange={(event) => set('locale', event.target.value as GroupSettings['locale'])}
          >
            <option value="id">Indonesia</option>
            <option value="en">Inggris</option>
          </select>

          <label className="check-row-inline" htmlFor="message_log">
            <input
              id="message_log"
              type="checkbox"
              checked={form.message_log === 1}
              onChange={(event) => set('message_log', event.target.checked ? 1 : 0)}
            />
            <span>Simpan log pesan untuk audit grup</span>
          </label>

          <button
            type="button"
            className="primary-button"
            disabled={saving}
            onClick={() =>
              void save({ prefix: form.prefix, locale: form.locale, message_log: form.message_log === 1 })
            }
          >
            {saving ? 'Menyimpan...' : 'Simpan pengaturan umum'}
          </button>
        </section>
      ) : null}

      {tab === 'sambutan' ? (
        <section className="settings-form" aria-label="Pengaturan penyambutan">
          <label className="check-row-inline" htmlFor="welcome_enabled">
            <input
              id="welcome_enabled"
              type="checkbox"
              checked={form.welcome_enabled === 1}
              onChange={(event) => set('welcome_enabled', event.target.checked ? 1 : 0)}
            />
            <span>Kirim pesan selamat datang</span>
          </label>
          <label htmlFor="welcome_template">Template selamat datang</label>
          <textarea
            id="welcome_template"
            value={form.welcome_template}
            maxLength={1000}
            onChange={(event) => set('welcome_template', event.target.value)}
          />
          <p className="field-help">Variabel: {'{nama}'}, {'{grup}'}, {'{tanggal}'}. Pratinjau: {renderTemplate(form.welcome_template)}</p>

          <label className="check-row-inline" htmlFor="goodbye_enabled">
            <input
              id="goodbye_enabled"
              type="checkbox"
              checked={form.goodbye_enabled === 1}
              onChange={(event) => set('goodbye_enabled', event.target.checked ? 1 : 0)}
            />
            <span>Kirim pesan pamit</span>
          </label>
          <label htmlFor="goodbye_template">Template pamit</label>
          <textarea
            id="goodbye_template"
            value={form.goodbye_template}
            maxLength={1000}
            onChange={(event) => set('goodbye_template', event.target.value)}
          />
          <p className="field-help">Pratinjau: {renderTemplate(form.goodbye_template)}</p>

          <button
            type="button"
            className="primary-button"
            disabled={saving}
            onClick={() =>
              void save({
                welcome_enabled: form.welcome_enabled === 1,
                welcome_template: form.welcome_template,
                goodbye_enabled: form.goodbye_enabled === 1,
                goodbye_template: form.goodbye_template
              })
            }
          >
            {saving ? 'Menyimpan...' : 'Simpan penyambutan'}
          </button>
        </section>
      ) : null}

      {tab === 'moderasi' ? (
        <section className="settings-form" aria-label="Pengaturan moderasi">
          <label htmlFor="anti_link_mode">Tindakan anti-link</label>
          <select
            id="anti_link_mode"
            value={form.anti_link_mode}
            onChange={(event) =>
              set('anti_link_mode', event.target.value as GroupSettings['anti_link_mode'])
            }
          >
            <option value="off">Nonaktif</option>
            <option value="delete">Hapus pesan</option>
            <option value="kick">Keluarkan pengirim</option>
          </select>

          <label htmlFor="link_allowlist">Allowlist domain</label>
          <textarea
            id="link_allowlist"
            value={allowlistText}
            placeholder="contoh.com"
            onChange={(event) => set('link_allowlist', event.target.value)}
          />
          <p className="field-help">Satu domain per baris. Domain di sini tidak ditindak.</p>

          <label className="check-row-inline" htmlFor="anti_spam_enabled">
            <input
              id="anti_spam_enabled"
              type="checkbox"
              checked={form.anti_spam_enabled === 1}
              onChange={(event) => set('anti_spam_enabled', event.target.checked ? 1 : 0)}
            />
            <span>Aktifkan anti-spam</span>
          </label>

          <label htmlFor="spam_max_msgs">Maksimal pesan per jendela</label>
          <input
            id="spam_max_msgs"
            type="number"
            min={3}
            max={20}
            value={form.spam_max_msgs}
            onChange={(event) => set('spam_max_msgs', Number(event.target.value))}
          />

          <label htmlFor="spam_window_sec">Jendela waktu (detik)</label>
          <input
            id="spam_window_sec"
            type="number"
            min={5}
            max={60}
            value={form.spam_window_sec}
            onChange={(event) => set('spam_window_sec', Number(event.target.value))}
          />

          <label htmlFor="spam_action">Tindakan anti-spam</label>
          <select
            id="spam_action"
            value={form.spam_action}
            onChange={(event) => set('spam_action', event.target.value as GroupSettings['spam_action'])}
          >
            <option value="warn">Peringatkan</option>
            <option value="delete">Hapus pesan</option>
            <option value="mute">Bisukan 5 menit</option>
          </select>

          <button
            type="button"
            className="primary-button"
            disabled={saving}
            onClick={() =>
              void save({
                anti_link_mode: form.anti_link_mode,
                link_allowlist: parseAllowlist(allowlistText),
                anti_spam_enabled: form.anti_spam_enabled === 1,
                spam_max_msgs: form.spam_max_msgs,
                spam_window_sec: form.spam_window_sec,
                spam_action: form.spam_action
              })
            }
          >
            {saving ? 'Menyimpan...' : 'Simpan moderasi'}
          </button>
        </section>
      ) : null}

      {tab === 'xp' ? (
        <section className="settings-form" aria-label="Pengaturan XP">
          <label className="check-row-inline" htmlFor="xp_enabled">
            <input
              id="xp_enabled"
              type="checkbox"
              checked={form.xp_enabled === 1}
              onChange={(event) => set('xp_enabled', event.target.checked ? 1 : 0)}
            />
            <span>Aktifkan XP dan level</span>
          </label>

          <label htmlFor="xp_per_message">XP per pesan</label>
          <input
            id="xp_per_message"
            type="number"
            min={1}
            max={50}
            value={form.xp_per_message}
            onChange={(event) => set('xp_per_message', Number(event.target.value))}
          />

          <label className="check-row-inline" htmlFor="level_up_announce">
            <input
              id="level_up_announce"
              type="checkbox"
              checked={form.level_up_announce === 1}
              onChange={(event) => set('level_up_announce', event.target.checked ? 1 : 0)}
            />
            <span>Umumkan kenaikan level</span>
          </label>

          <button
            type="button"
            className="primary-button"
            disabled={saving}
            onClick={() =>
              void save({
                xp_enabled: form.xp_enabled === 1,
                xp_per_message: form.xp_per_message,
                level_up_announce: form.level_up_announce === 1
              })
            }
          >
            {saving ? 'Menyimpan...' : 'Simpan XP'}
          </button>
        </section>
      ) : null}
    </main>
  );
}
