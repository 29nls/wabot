import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Tulis file lewat berkas sementara, fsync, lalu rename.
 * Rename dalam direktori yang sama bersifat atomik sehingga kredensial
 * tidak pernah terbaca dalam keadaan setengah tertulis.
 */
export async function writeAtomic(file: string, data: string, mode = 0o600): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(tmp, 'w', mode);
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  await fs.rename(tmp, file);

  if (process.platform !== 'win32') {
    await fs.chmod(file, mode);
  }
}

export async function readJsonFile<T>(file: string, fallback: () => T): Promise<T> {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text) as T;
  } catch {
    return fallback();
  }
}

export async function deleteAuthDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
