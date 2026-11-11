export interface XpUpdate {
  groupJid: string;
  userJid: string;
  pushName?: string | null;
  delta: number;
}

export class XpBuffer {
  private readonly entries = new Map<string, XpUpdate>();

  constructor(
    readonly flushSize = 50,
    readonly flushIntervalMs = 60_000
  ) {}

  record(update: XpUpdate): void {
    const key = `${update.groupJid}|${update.userJid}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.delta += update.delta;
      if (update.pushName) existing.pushName = update.pushName;
    } else {
      this.entries.set(key, { ...update });
    }
  }

  size(): number {
    return this.entries.size;
  }

  shouldFlush(): boolean {
    return this.entries.size >= this.flushSize;
  }

  drain(): XpUpdate[] {
    const values = [...this.entries.values()];
    this.entries.clear();
    return values;
  }
}