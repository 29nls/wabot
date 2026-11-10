import { describe, expect, it } from 'vitest';
import {
  canTransition,
  isFinalPairStatus,
  isOpenPairStatus,
  maskJid,
  maskPhone,
  normalizePairCode,
  normalizePhone
} from './pairing';

describe('normalizePhone', () => {
  it('accepts digits and strips a leading plus', () => {
    expect(normalizePhone('628123456789')).toBe('628123456789');
    expect(normalizePhone('+628123456789')).toBe('628123456789');
  });

  it('rejects separators instead of guessing the intended digits', () => {
    expect(normalizePhone('62 812-3456-789')).toBeNull();
    expect(normalizePhone('(62) 812 3456 789')).toBeNull();
  });

  it('rejects numbers that are too short, too long or start with zero', () => {
    expect(normalizePhone('628123')).toBeNull();
    expect(normalizePhone('0123456789')).toBeNull();
    expect(normalizePhone('1234567890123456')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('rejects letters', () => {
    expect(normalizePhone('62abc812345')).toBeNull();
  });
});

describe('maskPhone', () => {
  it('keeps the country prefix and last three digits', () => {
    expect(maskPhone('628123456789')).toBe('62812••••789');
  });

  it('never returns the full short value', () => {
    expect(maskPhone('1234')).toBe('12••••');
    expect(maskPhone('')).toBe('••••');
  });

  it('masks the number part of a JID', () => {
    expect(maskJid('628123456789@s.whatsapp.net')).toBe('62812••••789@s.whatsapp.net');
  });
});

describe('normalizePairCode', () => {
  it('strips separators and uppercases', () => {
    expect(normalizePairCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizePairCode(' ABCD EFGH ')).toBe('ABCDEFGH');
  });

  it('rejects wrong length or non alphanumeric characters', () => {
    expect(normalizePairCode('ABCDEFG')).toBeNull();
    expect(normalizePairCode('ABCDEFGHI')).toBeNull();
    expect(normalizePairCode('ABCD$FGH')).toBeNull();
    expect(normalizePairCode('')).toBeNull();
  });
});

describe('pair status helpers', () => {
  it('classifies open and final statuses', () => {
    expect(isOpenPairStatus('pending')).toBe(true);
    expect(isOpenPairStatus('dispatched')).toBe(true);
    expect(isOpenPairStatus('code_ready')).toBe(true);
    expect(isOpenPairStatus('connected')).toBe(false);
    expect(isFinalPairStatus('connected')).toBe(true);
    expect(isFinalPairStatus('expired')).toBe(true);
    expect(isFinalPairStatus('failed')).toBe(true);
    expect(isFinalPairStatus('cancelled')).toBe(true);
    expect(isFinalPairStatus('code_ready')).toBe(false);
  });

  it('allows only forward transitions from open statuses', () => {
    expect(canTransition('pending', 'dispatched')).toBe(true);
    expect(canTransition('pending', 'cancelled')).toBe(true);
    expect(canTransition('pending', 'expired')).toBe(true);
    expect(canTransition('pending', 'connected')).toBe(false);
    expect(canTransition('dispatched', 'code_ready')).toBe(true);
    expect(canTransition('code_ready', 'connected')).toBe(true);
    expect(canTransition('code_ready', 'code_ready')).toBe(false);
    expect(canTransition('connected', 'failed')).toBe(false);
    expect(canTransition('expired', 'pending')).toBe(false);
  });
});
