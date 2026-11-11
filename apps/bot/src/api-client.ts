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

  async function request(path: string, body: unknown): Promise<unknown> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        // 429 dan 5xx layak dicoba ulang; 4xx lain adalah kesalahan kontrak.
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
    }
  };
}
