export const RETRY_DELAYS_MS = [1_000, 4_000, 9_000] as const;

export class BotApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null
  ) {
    super(`Bot API menolak permintaan (${status})`);
    this.name = 'BotApiError';
  }
}

export interface BotApiClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface ApiEnvelope {
  ok?: boolean;
  data?: unknown;
  error?: { code?: string };
}

export interface BotStatusValue {
  status: 'unpaired' | 'pairing' | 'connected' | 'disconnected' | 'logged_out' | 'error';
  appVersion?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createBotApiClient(options: BotApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  async function request(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<unknown> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            ...extraHeaders
          },
          body: JSON.stringify(body)
        });

        if (response.status === 429 || response.status >= 500) {
          throw new Error(`HTTP ${response.status}`);
        }

        const envelope = (await response.json().catch(() => null)) as ApiEnvelope | null;

        if (!response.ok || !envelope || envelope.ok !== true) {
          throw new BotApiError(response.status, envelope?.error?.code ?? null);
        }

        return envelope.data;
      } catch (error) {
        if (error instanceof BotApiError) throw error;
        lastError = error;
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Bot API tidak terjangkau');
  }

  async function get(path: string): Promise<unknown> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${options.apiKey}`
          }
        });

        if (response.status === 429 || response.status >= 500) {
          throw new Error(`HTTP ${response.status}`);
        }

        const envelope = (await response.json().catch(() => null)) as ApiEnvelope | null;

        if (!response.ok || !envelope || envelope.ok !== true) {
          throw new BotApiError(response.status, envelope?.error?.code ?? null);
        }

        return envelope.data;
      } catch (error) {
        if (error instanceof BotApiError) throw error;
        lastError = error;
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Bot API tidak terjangkau');
  }

  return {
    request,
    get,

    async claimPairRequest(): Promise<{ request: { id: string; phone_number: string } | null }> {
      const data = (await request('/api/bot/pair-requests/claim', {})) as {
        request: { id: string; phone_number: string } | null;
      };
      return data;
    },

    async reportCode(id: string, code: string): Promise<unknown> {
      return request(`/api/bot/pair-requests/${encodeURIComponent(id)}/code`, { code });
    },

    async reportConnected(id: string, phoneJid: string): Promise<unknown> {
      return request(`/api/bot/pair-requests/${encodeURIComponent(id)}/status`, {
        status: 'connected',
        phone_jid: phoneJid
      });
    },

    async reportFailed(id: string, errorCode: string): Promise<unknown> {
      return request(`/api/bot/pair-requests/${encodeURIComponent(id)}/status`, {
        status: 'failed',
        error_code: errorCode
      });
    },

    async heartbeat(status: BotStatusValue['status'], appVersion?: string): Promise<unknown> {
      return request('/api/bot/heartbeat', {
        status,
        ...(appVersion ? { app_version: appVersion } : {})
      });
    },

    async getConfig(since?: number): Promise<unknown> {
      const query = since !== undefined ? `?since=${encodeURIComponent(String(since))}` : '';
      return get(`/api/bot/config${query}`);
    },

    async syncGroups(
      groups: Array<{ jid: string; name: string; member_count?: number; owner_jid?: string | null }>,
      complete = false
    ): Promise<unknown> {
      return request('/api/bot/groups/sync', { groups, complete });
    },

    async sendXp(
      updates: Array<{ group_jid: string; user_jid: string; push_name?: string | null; delta: number }>,
      idempotencyKey: string
    ): Promise<unknown> {
      return request('/api/bot/members/xp', { updates }, { 'Idempotency-Key': idempotencyKey });
    },

    async sendAudit(
      entries: Array<{
        group_jid: string;
        actor_jid: string;
        action: string;
        target_jid?: string | null;
        detail?: string | null;
      }>
    ): Promise<unknown> {
      return request('/api/bot/audit', { entries });
    },

    async sendEvents(
      entries: Array<{ level: string; scope: string; message: string; meta?: string | null }>
    ): Promise<unknown> {
      return request('/api/bot/events', { entries });
    }
  };
}