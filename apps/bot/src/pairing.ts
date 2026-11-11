export interface PairingDeps {
  claim: () => Promise<{ request: { id: string; phone_number: string } | null }>;
  requestPairingCode: (phone: string) => Promise<string>;
  reportCode: (id: string, code: string) => Promise<unknown>;
  isRegistered: () => boolean;
  log: (message: string) => void;
}

export type PollResult = 'idle' | 'code_sent' | 'skipped';

/** Satu putaran: klaim satu permintaan dan laporkan kode pairing bila ada. */
export async function pollOnce(deps: PairingDeps): Promise<PollResult> {
  if (deps.isRegistered()) return 'skipped';

  const { request } = await deps.claim();
  if (!request) return 'idle';

  const raw = await deps.requestPairingCode(request.phone_number);
  const code = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  if (code.length !== 8) {
    deps.log('kode pairing tidak valid; tidak dikirim');
    throw new Error('Kode pairing bukan 8 karakter alfanumerik.');
  }

  await deps.reportCode(request.id, code);
  // Kode tidak pernah dicatat ke log.
  deps.log(`kode pairing terkirim untuk ${request.id}`);
  return 'code_sent';
}

/** Loop berkala; kesalahan dicatat tanpa detail sensitif dan tidak menghentikan loop. */
export function startPairingLoop(deps: PairingDeps, intervalMs = 3_000): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      await pollOnce(deps);
    } catch {
      deps.log('polling pairing gagal; mencoba lagi');
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  }

  timer = setTimeout(() => void tick(), 0);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}
