export interface BotEnv {
  apiUrl: string;
  apiKey: string;
  botId: string;
  authDir: string;
  heartbeatMs: number;
}

/**
 * Validasi env saat start. Pesan error tidak boleh memuat nilai key.
 */
export function readEnv(env: NodeJS.ProcessEnv): BotEnv {
  const apiUrl = (env.WABOT_API_URL ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/.test(apiUrl)) {
    throw new Error('WABOT_API_URL wajib berupa URL http(s) tanpa spasi.');
  }

  const apiKey = env.WABOT_API_KEY ?? '';
  if (apiKey.length < 16) {
    throw new Error('WABOT_API_KEY wajib diisi minimal 16 karakter.');
  }

  const botId = (env.WABOT_BOT_ID ?? 'bot_1').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(botId)) {
    throw new Error('WABOT_BOT_ID tidak valid.');
  }

  const authDir = (env.WABOT_AUTH_DIR ?? '.auth').trim();
  if (!authDir) {
    throw new Error('WABOT_AUTH_DIR tidak boleh kosong.');
  }

  const heartbeatMs = Number(env.WABOT_HEARTBEAT_MS ?? 30_000);
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 5_000) {
    throw new Error('WABOT_HEARTBEAT_MS minimal 5000 ms.');
  }

  return { apiUrl, apiKey, botId, authDir, heartbeatMs };
}
