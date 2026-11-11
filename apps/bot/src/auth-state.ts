import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BufferJSON, initAuthCreds, type AuthenticationState } from '@whiskeysockets/baileys';
import { writeAtomic } from './atomic-file';

type StoredKeys = Record<string, Record<string, unknown>>;

async function readStored<T>(file: string, fallback: () => T): Promise<T> {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text, BufferJSON.reviver) as T;
  } catch {
    return fallback();
  }
}

export interface AtomicAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

/**
 * Auth state Baileys yang disimpan sebagai dua berkas (creds.json dan keys.json).
 * Setiap penulisan memakai tmp + fsync + rename sehingga kredensial tidak pernah
 * tertinggal dalam keadaan setengah tertulis. Penulisan diserialisasi agar dua
 * update bersamaan tidak saling menimpa.
 */
export async function useAtomicAuthState(dir: string): Promise<AtomicAuthState> {
  const credsPath = path.join(dir, 'creds.json');
  const keysPath = path.join(dir, 'keys.json');

  const creds = await readStored(credsPath, initAuthCreds);
  const keys = await readStored<StoredKeys>(keysPath, () => ({}));

  let queue: Promise<void> = Promise.resolve();

  function persist(file: string, value: unknown): Promise<void> {
    queue = queue.then(() => writeAtomic(file, JSON.stringify(value, BufferJSON.replacer)));
    return queue;
  }

  const keysStore = {
    get(type: string, ids: string[]) {
      const bucket = keys[type] ?? {};
      const found: Record<string, unknown> = {};
      for (const id of ids) {
        if (bucket[id] !== undefined) found[id] = bucket[id];
      }
      return found;
    },
    set(data: Record<string, Record<string, unknown>>) {
      for (const [type, values] of Object.entries(data)) {
        const bucket = (keys[type] ??= {});
        for (const [id, value] of Object.entries(values)) {
          if (value === null || value === undefined) {
            delete bucket[id];
          } else {
            bucket[id] = value;
          }
        }
      }
      return persist(keysPath, keys);
    },
    async clear() {
      for (const type of Object.keys(keys)) delete keys[type];
      await persist(keysPath, keys);
    }
  };

  const state = { creds, keys: keysStore } as unknown as AuthenticationState;

  return {
    state,
    saveCreds: () => persist(credsPath, creds)
  };
}
