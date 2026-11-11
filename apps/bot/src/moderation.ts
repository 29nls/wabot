export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s]+/gi) ?? [];
  return matches.map((url) => url.replace(/[.,!?;:)]+$/, ''));
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isAllowedUrl(url: string, allowlist: string[]): boolean {
  const domain = domainOf(url);
  if (!domain) return false;
  return allowlist.some((allowed) => {
    const normalized = allowed.toLowerCase().trim();
    return domain === normalized || domain.endsWith(`.${normalized}`);
  });
}

export type AntiLinkAction = 'none' | 'delete' | 'kick';

export function antiLinkDecision(
  mode: 'off' | 'delete' | 'kick',
  text: string,
  allowlist: string[]
): AntiLinkAction {
  if (mode === 'off') return 'none';
  const urls = extractUrls(text);
  if (urls.length === 0) return 'none';
  const violating = urls.some((url) => !isAllowedUrl(url, allowlist));
  if (!violating) return 'none';
  return mode;
}

export class SpamTracker {
  private readonly windows = new Map<string, number[]>();

  constructor(
    readonly maxMessages: number,
    readonly windowMs: number
  ) {}

  record(userJid: string, now = Date.now()): number {
    const list = this.windows.get(userJid) ?? [];
    const cutoff = now - this.windowMs;
    const recent = list.filter((timestamp) => timestamp > cutoff);
    recent.push(now);
    this.windows.set(userJid, recent);
    return recent.length;
  }

  isSpamming(userJid: string, now = Date.now()): boolean {
    return this.record(userJid, now) > this.maxMessages;
  }

  reset(userJid?: string): void {
    if (userJid) this.windows.delete(userJid);
    else this.windows.clear();
  }
}