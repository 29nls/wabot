import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WASocket } from '@whiskeysockets/baileys';
import { parsePollArgs, sendPoll } from './poll';
import { answerGame, getActiveWord, startGame } from './games';
import { startScheduler } from './scheduler';
import { sendSticker } from './sticker';

function fakeSock(): { sock: WASocket; sendMessage: ReturnType<typeof vi.fn> } {
  const sendMessage = vi.fn(async () => undefined);
  return { sock: { sendMessage } as unknown as WASocket, sendMessage };
}

describe('parsePollArgs', () => {
  it('menerima pertanyaan dan dua opsi', () => {
    expect(parsePollArgs('"Pilih?" "A" "B"')).toEqual({ question: 'Pilih?', options: ['A', 'B'] });
  });

  it('menolak kurang dari dua opsi', () => {
    expect(parsePollArgs('"Pilih?" "A"')).toBeNull();
  });

  it('menolak opsi kosong', () => {
    expect(parsePollArgs('"Pilih?" "A" ""')).toBeNull();
  });

  it('menolak lebih dari 12 opsi', () => {
    const args = ['"Pilih?"', ...Array.from({ length: 13 }, (_, i) => `"O${i}"`)].join(' ');
    expect(parsePollArgs(args)).toBeNull();
  });
});

describe('sendPoll', () => {
  it('mengirim poll saat argumen valid', async () => {
    const { sock, sendMessage } = fakeSock();
    await expect(sendPoll(sock, 'g@g.us', '"Pilih?" "A" "B"')).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('tidak mengirim apa pun saat argumen invalid', async () => {
    const { sock, sendMessage } = fakeSock();
    await expect(sendPoll(sock, 'g@g.us', 'ngawur')).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('games', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ronde baru mengembalikan kata dan isNew', () => {
    const result = startGame('game1@g.us', 'u@s.whatsapp.net', () => undefined);
    expect(result.isNew).toBe(true);
    expect(result.word.length).toBeGreaterThan(0);
    expect(getActiveWord('game1@g.us')).toBe(result.word);
    answerGame('game1@g.us', result.word);
  });

  it('ronde ganda tidak membuat sesi baru', () => {
    const first = startGame('game2@g.us', 'u@s.whatsapp.net', () => undefined);
    const second = startGame('game2@g.us', 'u@s.whatsapp.net', () => undefined);
    expect(second.isNew).toBe(false);
    expect(second.word).toBe(first.word);
    answerGame('game2@g.us', first.word);
  });

  it('jawaban salah lalu benar', () => {
    const { word } = startGame('game3@g.us', 'u@s.whatsapp.net', () => undefined);
    expect(answerGame('game3@g.us', 'salah-pasti')).toBe('wrong');
    expect(answerGame('game3@g.us', word.toUpperCase())).toBe('correct');
    expect(answerGame('game3@g.us', word)).toBe('none');
  });

  it('ronde kedaluwarsa memicu timer dan menjadi none', async () => {
    const onExpire = vi.fn();
    startGame('game4@g.us', 'u@s.whatsapp.net', onExpire, 1000);
    await vi.advanceTimersByTimeAsync(1001);
    expect(onExpire).toHaveBeenCalledOnce();
    expect(getActiveWord('game4@g.us')).toBeNull();
    expect(answerGame('game4@g.us', 'apa')).toBe('none');
  });
});

describe('scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mengirim jadwal jatuh tempo lalu melapor', async () => {
    const { sock, sendMessage } = fakeSock();
    const api = {
      getSchedules: vi.fn(async () => ({
        schedules: [{ id: 'sm_1', group_jid: 'g@g.us', message: 'halo', repeat_sec: 0 }]
      })),
      reportExecuted: vi.fn(async () => ({})),
      runMaintenance: vi.fn(async () => ({}))
    };
    const stop = startScheduler({
      api: api as never,
      sock: () => sock,
      log: () => undefined,
      intervalMs: 1000
    });

    await vi.advanceTimersByTimeAsync(5000);

    expect(sendMessage).toHaveBeenCalledWith('g@g.us', { text: 'halo' });
    expect(api.reportExecuted).toHaveBeenCalledWith('sm_1', true);
    expect(api.runMaintenance).toHaveBeenCalledOnce();
    stop();
  });

  it('melewati pengiriman saat socket belum ada', async () => {
    const api = {
      getSchedules: vi.fn(async () => ({
        schedules: [{ id: 'sm_2', group_jid: 'g@g.us', message: 'halo', repeat_sec: 0 }]
      })),
      reportExecuted: vi.fn(async () => ({})),
      runMaintenance: vi.fn(async () => ({}))
    };
    const stop = startScheduler({
      api: api as never,
      sock: () => null,
      log: () => undefined,
      intervalMs: 1000
    });

    await vi.advanceTimersByTimeAsync(5000);

    expect(api.reportExecuted).not.toHaveBeenCalled();
    const callsBeforeStop = api.getSchedules.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.getSchedules.mock.calls.length).toBe(callsBeforeStop);
  });
});

describe('sendSticker', () => {
  const imageMessage = { imageMessage: { mimetype: 'image/jpeg' } };

  it('menolak saat tidak ada media dikutip', async () => {
    const { sock } = fakeSock();
    await expect(sendSticker(sock, 'g@g.us', undefined)).resolves.toBe('no_media');
  });

  it('menolak media lebih dari 5 MB', async () => {
    const { sock } = fakeSock();
    const quoted = { message: imageMessage } as never;
    await expect(sendSticker(sock, 'g@g.us', quoted, async () => Buffer.alloc(6 * 1024 * 1024))).resolves.toBe(
      'too_large'
    );
  });

  it('mengembalikan error saat unduhan gagal', async () => {
    const { sock } = fakeSock();
    const quoted = { message: imageMessage } as never;
    await expect(
      sendSticker(sock, 'g@g.us', quoted, async () => {
        throw new Error('gagal');
      })
    ).resolves.toBe('error');
  });
});
