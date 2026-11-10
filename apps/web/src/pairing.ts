// Aturan domain untuk permintaan pairing: format nomor, masking, kode,
// dan transisi status yang legal. Semua fungsi murni agar mudah diuji.

export const PAIR_CODE_TTL_MS = 120 * 1000;
export const PAIR_REQUEST_TTL_MS = 10 * 60 * 1000;
export const PAIR_COOLDOWN_MS = 30 * 1000;
export const PAIR_LIMIT = 3;
export const PAIR_WINDOW_MS = 15 * 60 * 1000;

export type PairStatus =
  | 'pending'
  | 'dispatched'
  | 'code_ready'
  | 'connected'
  | 'expired'
  | 'failed'
  | 'cancelled';

export const FINAL_PAIR_STATUSES: readonly PairStatus[] = [
  'connected',
  'expired',
  'failed',
  'cancelled'
];

export const OPEN_PAIR_STATUSES: readonly PairStatus[] = ['pending', 'dispatched', 'code_ready'];

export function isOpenPairStatus(status: string): boolean {
  return (OPEN_PAIR_STATUSES as readonly string[]).includes(status);
}

export function isFinalPairStatus(status: string): boolean {
  return (FINAL_PAIR_STATUSES as readonly string[]).includes(status);
}

/** Nomor disimpan sebagai digit internasional tanpa `+`, spasi, atau tanda hubung. */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const digits = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return digits;
}

/** `628123456789` menjadi `62812••••789`; nomor pendek tetap tidak utuh. */
export function maskPhone(value: string): string {
  if (value.length <= 8) return `${value.slice(0, 2)}••••`;
  return `${value.slice(0, 5)}••••${value.slice(-3)}`;
}

export function maskJid(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return maskPhone(value);
  return `${maskPhone(value.slice(0, at))}${value.slice(at)}`;
}

/** Kode dari WhatsApp berupa 8 karakter alfanumerik; disimpan huruf besar tanpa pemisah. */
export function normalizePairCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.trim().replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{8}$/.test(compact) ? compact : null;
}

/**
 * Status yang boleh dituju sebuah permintaan. Dipakai handler agar transisi
 * ilegal (mis. `connected` dari `pending`) ditolak, bukan ditimpa diam-diam.
 */
const ALLOWED_TRANSITIONS: Record<PairStatus, readonly PairStatus[]> = {
  pending: ['dispatched', 'cancelled', 'expired'],
  dispatched: ['code_ready', 'failed', 'cancelled', 'expired'],
  code_ready: ['connected', 'failed', 'cancelled', 'expired'],
  connected: [],
  expired: [],
  failed: [],
  cancelled: []
};

export function canTransition(from: string, to: PairStatus): boolean {
  if (!(from in ALLOWED_TRANSITIONS)) return false;
  return (ALLOWED_TRANSITIONS[from as PairStatus] as readonly string[]).includes(to);
}
