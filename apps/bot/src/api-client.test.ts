import { describe, expect, it } from 'vitest';
import { createBotApiClient, BotApiError, RETRY_DELAYS_MS } from './api-client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('createBotApiClient', () => {
  it('mencoba ulang 5xx dengan jeda 1/4/9 detik lalu berhasil', async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const responses = [
      jsonResponse(500, { ok: false }),
      jsonResponse(502, { ok: false }),
      jsonResponse(200, { ok: true, data: { request: null } })
    ];

    const client = createBotApiClient({
      baseUrl: 'https://wabot.example.com',
      apiKey: 'kunci-uji-yang-cukup-panjang',
      fetchImpl: (async (input: Parameters<typeof fetch>[0]) => {
        calls.push(String(input));
        return responses.shift() as Response;
      }) as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });

    const result = await client.claimPairRequest();
    expect(result.request).toBeNull();
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]]);
    expect(calls[0]).toBe('https://wabot.example.com/api/bot/pair-requests/claim');
  });

  it('tidak mencoba ulang 401 dan melempar BotApiError', async () => {
    let calls = 0;
    const client = createBotApiClient({
      baseUrl: 'https://wabot.example.com',
      apiKey: 'kunci-uji-yang-cukup-panjang',
      fetchImpl: (async () => {
        calls += 1;
        return jsonResponse(401, { ok: false, error: { code: 'unauthorized' } });
      }) as typeof fetch
    });

    await expect(client.heartbeat('connected')).rejects.toBeInstanceOf(BotApiError);
    expect(calls).toBe(1);
  });

  it('mengirim status dan app_version pada heartbeat', async () => {
    let body: unknown = null;
    const client = createBotApiClient({
      baseUrl: 'https://wabot.example.com',
      apiKey: 'kunci-uji-yang-cukup-panjang',
      fetchImpl: (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        body = JSON.parse(String(init?.body ?? '{}'));
        return jsonResponse(200, { ok: true, data: { last_seen_at: 1 } });
      }) as typeof fetch
    });

    await client.heartbeat('pairing', '0.1.0');
    expect(body).toEqual({ status: 'pairing', app_version: '0.1.0' });
  });

  it('mengirim kode pairing ke endpoint yang benar', async () => {
    let url = '';
    let body: unknown = null;
    const client = createBotApiClient({
      baseUrl: 'https://wabot.example.com',
      apiKey: 'kunci-uji-yang-cukup-panjang',
      fetchImpl: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        url = String(input);
        body = JSON.parse(String(init?.body ?? '{}'));
        return jsonResponse(200, { ok: true, data: { id: 'pr_1' } });
      }) as typeof fetch
    });

    await client.reportCode('pr_1', 'ABCDEFGH');
    expect(url).toBe('https://wabot.example.com/api/bot/pair-requests/pr_1/code');
    expect(body).toEqual({ code: 'ABCDEFGH' });
  });
});
