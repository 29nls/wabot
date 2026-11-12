import type { WASocket } from '@whiskeysockets/baileys';

const WORDS = [
  'kucing', 'anjing', 'gajah', 'harimau', 'kelinci', 'panda', 'lumba', 'burung',
  'rumah', 'sekolah', 'komputer', 'telepon', 'mobil', 'sepeda', 'pesawat'
];

export interface GameSession {
  word: string;
  startedBy: string;
  startedAt: number;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

const sessions = new Map<string, GameSession>();

export function hasActiveGame(groupJid: string): boolean {
  const s = sessions.get(groupJid);
  if (!s) return false;
  if (Date.now() > s.expiresAt) {
    clearTimeout(s.timer);
    sessions.delete(groupJid);
    return false;
  }
  return true;
}

export function startGame(
  groupJid: string,
  startedBy: string,
  onExpire: () => void,
  ttlMs = 60_000
): { word: string; isNew: boolean } {
  if (hasActiveGame(groupJid)) {
    return { word: sessions.get(groupJid)!.word, isNew: false };
  }
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const timer = setTimeout(() => {
    sessions.delete(groupJid);
    onExpire();
  }, ttlMs);
  sessions.set(groupJid, {
    word,
    startedBy,
    startedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    timer
  });
  return { word, isNew: true };
}

export function answerGame(groupJid: string, guess: string): 'correct' | 'wrong' | 'none' {
  const s = sessions.get(groupJid);
  if (!s || Date.now() > s.expiresAt) {
    if (s) {
      clearTimeout(s.timer);
      sessions.delete(groupJid);
    }
    return 'none';
  }
  if (guess.trim().toLowerCase() === s.word) {
    clearTimeout(s.timer);
    sessions.delete(groupJid);
    return 'correct';
  }
  return 'wrong';
}

export function getActiveWord(groupJid: string): string | null {
  const s = sessions.get(groupJid);
  if (!s || Date.now() > s.expiresAt) return null;
  return s.word;
}

// Re-export for convenience
export type { WASocket };
