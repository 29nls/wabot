import { describe, expect, it } from 'vitest';
import { readEnv } from './env';

const VALID = {
  WABOT_API_URL: 'https://wabot.example.com/',
  WABOT_API_KEY: 'kunci-uji-yang-cukup-panjang',
  WABOT_BOT_ID: 'bot_1'
};

describe('readEnv', () => {
  it('membaca env valid dan menormalkan URL', () => {
    const env = readEnv(VALID);
    expect(env.apiUrl).toBe('https://wabot.example.com');
    expect(env.botId).toBe('bot_1');
    expect(env.authDir).toBe('.auth');
    expect(env.heartbeatMs).toBe(30_000);
  });

  it('menolak URL tanpa http(s)', () => {
    expect(() => readEnv({ ...VALID, WABOT_API_URL: 'ftp://contoh' })).toThrow(/WABOT_API_URL/);
  });

  it('menolak API key pendek dan tidak mencetak nilainya', () => {
    let message = '';
    try {
      readEnv({ ...VALID, WABOT_API_KEY: 'pendek' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toMatch(/WABOT_API_KEY/);
    expect(message).not.toContain('pendek');
  });

  it('menolak BOT_ID dengan karakter aneh dan heartbeat terlalu kecil', () => {
    expect(() => readEnv({ ...VALID, WABOT_BOT_ID: 'bot/../../1' })).toThrow(/WABOT_BOT_ID/);
    expect(() => readEnv({ ...VALID, WABOT_HEARTBEAT_MS: '1000' })).toThrow(/WABOT_HEARTBEAT_MS/);
  });
});
