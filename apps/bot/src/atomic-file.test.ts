import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJsonFile, writeAtomic } from './atomic-file';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wabot-bot-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('writeAtomic', () => {
  it('menulis isi lengkap dan tidak menyisakan berkas tmp', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'creds.json');

    await writeAtomic(file, '{"registered":true}');

    expect(await fs.readFile(file, 'utf8')).toBe('{"registered":true}');
    const entries = await fs.readdir(dir);
    expect(entries).toEqual(['creds.json']);
  });

  it('menimpa berkas lama secara utuh', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'keys.json');

    await writeAtomic(file, 'lama');
    await writeAtomic(file, 'baru');

    expect(await fs.readFile(file, 'utf8')).toBe('baru');
  });
});

describe('readJsonFile', () => {
  it('memakai fallback untuk berkas hilang atau JSON rusak', async () => {
    const dir = await tempDir();
    expect(await readJsonFile(path.join(dir, 'hilang.json'), () => ({ fallback: true }))).toEqual({
      fallback: true
    });

    const rusak = path.join(dir, 'rusak.json');
    await fs.writeFile(rusak, '{bukan json');
    expect(await readJsonFile(rusak, () => 'fallback')).toBe('fallback');
  });
});
