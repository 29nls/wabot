const MIN_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;

/**
 * Backoff eksponensial 2-60 detik dengan jitter 0.5x-1.5x.
 * `random` dapat diinjeksi agar deterministik pada test.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const safeAttempt = Math.max(0, Math.min(20, attempt));
  const base = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** safeAttempt);
  const jitter = 0.5 + random();
  return Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, Math.round(base * jitter)));
}
