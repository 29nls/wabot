import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff';

describe('backoffDelay', () => {
  it('selalu berada di antara 2 dan 60 detik', () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect(backoffDelay(attempt, () => 0)).toBeGreaterThanOrEqual(2_000);
      expect(backoffDelay(attempt, () => 0.999)).toBeLessThanOrEqual(60_000);
    }
  });

  it('tumbuh eksponensial lalu dibatasi 60 detik', () => {
    expect(backoffDelay(6, () => 0)).toBe(30_000);
    expect(backoffDelay(10, () => 0)).toBe(30_000);
    expect(backoffDelay(10, () => 0.999)).toBe(60_000);
  });

  it('jitter memvariasikan hasil untuk attempt yang sama', () => {
    expect(backoffDelay(2, () => 0)).toBeLessThan(backoffDelay(2, () => 0.999));
  });
});
