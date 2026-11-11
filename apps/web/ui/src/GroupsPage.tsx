import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getGroups, type GroupSummary, type SessionData } from './api';

type Filter = 'all' | 'active' | 'inactive';

interface GroupsPageProps {
  session: SessionData;
  onNavigate: (path: string) => void;
}

export function GroupsPage({ onNavigate }: GroupsPageProps) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async (q: string, f: Filter) => {
    setState('loading');
    try {
      const result = await getGroups(q, f);
      if (result.status === 200 && result.body?.ok) {
        setGroups(result.body.data.groups);
        setState('ready');
        return;
      }
      setState('error');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load(appliedQuery, filter);
  }, [appliedQuery, filter, load]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedQuery(query.trim());
  }

  return (
    <main className="app-main">
      <p className="section-kicker">Grup</p>
      <h1>Grup yang dikelola bot.</h1>
      <p className="lead">
        Daftar ini berasal dari sinkronisasi WhatsApp. Pilih grup untuk mengatur sapaan,
        moderasi, dan XP.
      </p>

      <form className="groups-toolbar" onSubmit={handleSearch} role="search">
        <div className="input-row">
          <label htmlFor="group-search">Cari nama grup</label>
          <input
            id="group-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Keluarga, komunitas, ..."
          />
        </div>
        <div className="groups-filters" role="group" aria-label="Filter status grup">
          {(['all', 'active', 'inactive'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="ghost-button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? 'Semua' : value === 'active' ? 'Aktif' : 'Nonaktif'}
            </button>
          ))}
        </div>
        <button type="submit" className="ghost-button">
          Cari
        </button>
      </form>

      {state === 'loading' ? <p className="field-help">Memuat grup...</p> : null}

      {state === 'error' ? (
        <div>
          <p className="form-error page-error" role="alert">
            Daftar grup tidak bisa dimuat.
          </p>
          <button type="button" className="ghost-button" onClick={() => void load(appliedQuery, filter)}>
            Coba lagi
          </button>
        </div>
      ) : null}

      {state === 'ready' && groups.length === 0 ? (
        <p className="field-help">
          Belum ada grup yang cocok. Grup muncul setelah bot bergabung dan daemon
          menyinkronkan metadata.
        </p>
      ) : null}

      {state === 'ready' && groups.length > 0 ? (
        <div className="group-list">
          {groups.map((group) => (
            <button
              key={group.jid}
              type="button"
              className="group-row"
              onClick={() => onNavigate(`/groups/${encodeURIComponent(group.jid)}`)}
            >
              <span className="group-identity">
                <span className="group-name">{group.name}</span>
                <span className="group-jid">{group.jid_masked}</span>
              </span>
              <span className={group.is_active ? 'group-active' : 'group-inactive'}>
                {group.is_active ? 'Aktif' : 'Nonaktif'}
              </span>
              <span>{group.member_count} anggota</span>
              <span className="group-jid">
                {group.last_active_at
                  ? new Date(group.last_active_at).toLocaleDateString('id-ID')
                  : 'Belum aktif'}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </main>
  );
}
