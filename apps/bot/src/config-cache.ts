export interface CachedConfig<T> {
  data: T;
  fetchedAt: number;
}

export class ConfigCache<T> {
  private cached: CachedConfig<T> | null = null;

  constructor(
    private readonly fetcher: (since?: number) => Promise<T>,
    private readonly ttlMs = 10_000
  ) {}

  async get(since?: number, force = false): Promise<T> {
    const now = Date.now();
    if (!force && this.cached && now - this.cached.fetchedAt < this.ttlMs) {
      return this.cached.data;
    }
    const data = await this.fetcher(since ?? this.cached?.fetchedAt);
    this.cached = { data, fetchedAt: now };
    return data;
  }

  invalidate(): void {
    this.cached = null;
  }
}