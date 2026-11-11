import { describe, expect, it } from 'vitest';
import { pollOnce, type PairingDeps } from './pairing';

function deps(overrides: Partial<PairingDeps> = {}): PairingDeps & { logs: string[] } {
  const logs: string[] = [];
  return {
    claim: async () => ({ request: { id: 'pr_1', phone_number: '628123456789' } }),
    requestPairingCode: async () => 'abcd-efgh',
    reportCode: async () => undefined,
    isRegistered: () => false,
    log: (message) => logs.push(message),
    ...overrides,
    logs
  } as PairingDeps & { logs: string[] };
}

describe('pollOnce', () => {
  it('mengklaim permintaan dan melaporkan kode 8 karakter tanpa mencetaknya', async () => {
    const reported: Array<{ id: string; code: string }> = [];
    const d = deps({
      reportCode: async (id, code) => {
        reported.push({ id, code });
      }
    });

    const result = await pollOnce(d);

    expect(result).toBe('code_sent');
    expect(reported).toEqual([{ id: 'pr_1', code: 'ABCDEFGH' }]);
    expect(d.logs.join(' ')).not.toContain('ABCDEFGH');
    expect(d.logs.join(' ')).toContain('pr_1');
  });

  it('tidak melakukan apa pun saat tidak ada permintaan', async () => {
    const d = deps({ claim: async () => ({ request: null }) });
    expect(await pollOnce(d)).toBe('idle');
  });

  it('melewati klaim saat sesi sudah terdaftar', async () => {
    let claimed = false;
    const d = deps({
      isRegistered: () => true,
      claim: async () => {
        claimed = true;
        return { request: null };
      }
    });

    expect(await pollOnce(d)).toBe('skipped');
    expect(claimed).toBe(false);
  });

  it('menolak kode yang bukan 8 alfanumerik dan tidak melaporkannya', async () => {
    let reported = false;
    const d = deps({
      requestPairingCode: async () => 'pendek',
      reportCode: async () => {
        reported = true;
      }
    });

    await expect(pollOnce(d)).rejects.toThrow(/8 karakter/);
    expect(reported).toBe(false);
  });
});
