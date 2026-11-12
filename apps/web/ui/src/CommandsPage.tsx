import { useCallback, useEffect, useState } from 'react';
import {
  createGroupCommand,
  deleteCommand,
  getGroupCommands,
  getGroups,
  updateCommand,
  type CommandItem,
  type GroupSummary,
  type SessionData
} from './api';

export function CommandsPage({ session, onNavigate }: { session: SessionData; onNavigate: (path: string) => void }) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupJid, setGroupJid] = useState('');
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [trigger, setTrigger] = useState('');
  const [response, setResponse] = useState('');
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

  const loadCommands = useCallback(async () => {
    if (!groupJid) return;
    setState('loading');
    const result = await getGroupCommands(groupJid);
    if (result.status === 200 && result.body?.ok) {
      setCommands(result.body.data.commands);
      setState('ready');
    } else {
      setState('error');
    }
  }, [groupJid]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    void loadCommands();
  }, [loadCommands]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!groupJid) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createGroupCommand(session.csrf_token, groupJid, trigger, response, true);
      if (result.status === 201 && result.body?.ok) {
        setTrigger('');
        setResponse('');
        await loadCommands();
      } else {
        setError(result.body && !result.body.ok ? result.body.error.message : 'Gagal menambah command.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(command: CommandItem) {
    await updateCommand(session.csrf_token, command.id, { enabled: command.enabled !== 1 });
    await loadCommands();
  }

  async function handleDelete(id: string) {
    await deleteCommand(session.csrf_token, id);
    await loadCommands();
  }

  return (
    <main className="app-main">
      <button type="button" className="text-button" onClick={() => onNavigate('/groups')}>
        Kembali ke grup
      </button>
      <p className="section-kicker">Command</p>
      <h1>Custom command grup</h1>

      <section aria-labelledby="builtin-title">
        <h2 id="builtin-title">Command bawaan P1</h2>
        <ul>
          <li><span className="mono-value">.poll "Pertanyaan" "Opsi A" "Opsi B"</span> — kirim polling.</li>
          <li><span className="mono-value">.sticker</span> — balas gambar atau video dengan command ini.</li>
          <li><span className="mono-value">.tebak</span> — mulai ronde tebak kata 60 detik.</li>
          <li><span className="mono-value">.jawab &lt;kata&gt;</span> — jawab ronde aktif, benar dapat 25 XP.</li>
        </ul>
      </section>

      <label htmlFor="group">Grup</label>
      <select id="group" value={groupJid} onChange={(e) => setGroupJid(e.target.value)}>
        {groups.map((group) => (
          <option key={group.jid} value={group.jid}>
            {group.name}
          </option>
        ))}
      </select>

      <form className="settings-form" onSubmit={handleCreate}>
        <label htmlFor="trigger">Trigger</label>
        <input id="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} maxLength={64} />
        <label htmlFor="response">Respons</label>
        <textarea id="response" value={response} onChange={(e) => setResponse(e.target.value)} maxLength={1000} />
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? 'Menyimpan...' : 'Tambah command'}
        </button>
        {error ? <p className="form-error page-error">{error}</p> : null}
      </form>

      {state === 'loading' ? <p className="field-help">Memuat command...</p> : null}
      {state === 'error' ? <p className="form-error page-error">Command tidak bisa dimuat.</p> : null}
      {state === 'ready' && commands.length === 0 ? <p className="field-help">Belum ada command.</p> : null}
      {commands.map((command) => (
        <div key={command.id} className="status-row">
          <span className="mono-value">.{command.trigger}</span>
          <span>{command.response}</span>
          <button type="button" className="ghost-button" onClick={() => void handleToggle(command)}>
            {command.enabled === 1 ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
          <button type="button" className="ghost-button" onClick={() => void handleDelete(command.id)}>
            Hapus
          </button>
        </div>
      ))}
    </main>
  );
}