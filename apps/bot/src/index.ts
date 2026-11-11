import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import { createBotApiClient } from './api-client';
import { backoffDelay } from './backoff';
import { useAtomicAuthState } from './auth-state';
import { deleteAuthDir } from './atomic-file';
import { readEnv } from './env';
import { startPairingLoop } from './pairing';

function log(message: string): void {
  // Hanya pesan operasional; tidak ada kode pairing, nomor, atau kredensial.
  console.log(`[bot] ${message}`);
}

async function main(): Promise<void> {
  const env = readEnv(process.env);
  const api = createBotApiClient({ baseUrl: env.apiUrl, apiKey: env.apiKey });
  let reconnectAttempt = 0;
  let stopped = false;
  let activePairRequestId: string | null = null;

  async function connect(): Promise<void> {
    if (stopped) return;

    const { state, saveCreds } = await useAtomicAuthState(env.authDir);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', () => {
      void saveCreds();
    });

    const pairing = startPairingLoop({
      claim: () => api.claimPairRequest(),
      requestPairingCode: (phone) => sock.requestPairingCode(phone),
      reportCode: (id, code) => {
        activePairRequestId = id;
        return api.reportCode(id, code);
      },
      isRegistered: () => Boolean(state.creds.registered),
      log
    });

    const heartbeat = setInterval(() => {
      const status = state.creds.registered ? 'connected' : 'pairing';
      void api.heartbeat(status).catch(() => log('heartbeat gagal'));
    }, env.heartbeatMs);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        reconnectAttempt = 0;
        pairing.stop();
        const me = state.creds.me?.id;
        log('socket WhatsApp terhubung');

        if (activePairRequestId && me) {
          const requestId = activePairRequestId;
          activePairRequestId = null;
          void api.reportConnected(requestId, me).catch(() => log('gagal melaporkan status connected'));
        }

        void api.heartbeat('connected').catch(() => log('heartbeat gagal'));
      }

      if (connection !== 'close') return;

      clearInterval(heartbeat);
      pairing.stop();

      const statusCode = (
        lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
      )?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        stopped = true;
        const requestId = activePairRequestId;
        activePairRequestId = null;

        if (requestId) {
          void api.reportFailed(requestId, 'logged_out').catch(() => undefined);
        }
        void api.heartbeat('logged_out').catch(() => undefined);
        void deleteAuthDir(env.authDir);
        log('sesi WhatsApp berakhir; kredensial lokal dihapus');
        return;
      }

      const delay = backoffDelay(reconnectAttempt);
      reconnectAttempt += 1;
      log(`socket tertutup; reconnect dalam ${delay} ms`);
      setTimeout(() => {
        void connect().catch(() => log('reconnect gagal'));
      }, delay);
    });
  }

  await connect();
}

void main().catch((error) => {
  // Pesan validasi env aman dicetak; nilai rahasia tidak pernah ikut.
  console.error('[bot] gagal start:', error instanceof Error ? error.message : 'unknown');
  process.exitCode = 1;
});
