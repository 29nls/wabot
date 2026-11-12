import makeWASocket, { DisconnectReason, type WAMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import { createBotApiClient } from './api-client';
import { backoffDelay } from './backoff';
import { useAtomicAuthState } from './auth-state';
import { deleteAuthDir } from './atomic-file';
import { readEnv } from './env';
import { startPairingLoop } from './pairing';
import { parseCommand } from './commands';
import { sendPoll } from './poll';
import { sendSticker } from './sticker';
import { startGame, answerGame } from './games';
import { startScheduler } from './scheduler';

function quotedMessage(msg: WAMessage, jid: string): WAMessage | undefined {
  const context = msg.message?.extendedTextMessage?.contextInfo;
  if (!context?.quotedMessage || !context.stanzaId) return undefined;
  return {
    key: { remoteJid: jid, id: context.stanzaId, fromMe: false },
    message: context.quotedMessage
  };
}

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
  let activeSock: ReturnType<typeof makeWASocket> | null = null;
  let stopScheduler: (() => void) | null = null;

  async function connect(): Promise<void> {
    if (stopped) return;

    const { state, saveCreds } = await useAtomicAuthState(env.authDir);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' })
    });

    activeSock = sock;

    sock.ev.on('creds.update', () => {
      void saveCreds();
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;
      for (const msg of messages) void handleMessage(msg);
    });

    async function handleMessage(msg: WAMessage): Promise<void> {
      const jid = msg.key.remoteJid;
      if (!jid || !jid.endsWith('@g.us') || msg.key.fromMe) return;

      const text =
        msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? '';
      const command = parseCommand(text, '.');
      if (!command) return;

      try {
        if (command.name === 'poll') {
          if (!(await sendPoll(sock, jid, command.rawArgs))) {
            await sock.sendMessage(jid, { text: 'Format: .poll "Pertanyaan" "Opsi A" "Opsi B"' });
          }
          return;
        }

        if (command.name === 'sticker') {
          const quoted = quotedMessage(msg, jid);
          const result = await sendSticker(sock, jid, quoted);
          if (result !== 'ok') {
            await sock.sendMessage(jid, {
              text:
                result === 'no_media'
                  ? 'Balas gambar atau video dengan .sticker'
                  : result === 'too_large'
                    ? 'Media maksimal 5 MB.'
                    : 'Media tidak bisa dijadikan stiker.'
            });
          }
          return;
        }

        if (command.name === 'tebak') {
          const started = startGame(jid, msg.key.participant ?? 'unknown', () => {
            void sock.sendMessage(jid, { text: 'Waktu habis. Kata tidak terjawab.' });
          });
          if (!started.isNew) {
            await sock.sendMessage(jid, { text: 'Masih ada ronde berjalan. Jawab dulu.' });
            return;
          }
          await sock.sendMessage(jid, {
            text: `Tebak kata ${started.word.length} huruf. Waktu 60 detik. Jawab dengan .jawab <kata>`
          });
          return;
        }

        if (command.name === 'jawab') {
          const guess = command.rawArgs;
          if (!guess) return;
          const result = answerGame(jid, guess);
          if (result === 'none') {
            await sock.sendMessage(jid, { text: 'Tidak ada ronde aktif.' });
          } else if (result === 'wrong') {
            await sock.sendMessage(jid, { text: 'Salah, coba lagi.' });
          } else {
            await sock.sendMessage(jid, { text: 'Benar! +25 XP' });
            const userJid = msg.key.participant;
            if (userJid) {
              const key = `game-${jid}-${userJid}-${Date.now()}`;
              void api
                .sendXp([{ group_jid: jid, user_jid: userJid, delta: 25 }], key)
                .catch(() => log('gagal mengirim XP game'));
            }
          }
        }
      } catch {
        log('handler pesan gagal');
      }
    }

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

        if (!stopScheduler) {
          stopScheduler = startScheduler({
            api,
            sock: () => activeSock,
            log
          });
        }

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
      stopScheduler?.();
      stopScheduler = null;

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
