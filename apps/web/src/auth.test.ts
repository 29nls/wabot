import { describe, expect, it } from 'vitest';
import {
  constantTimeEqualText,
  hashPassword,
  signSession,
  verifyPassword,
  verifySession,
  type SessionPayload
} from './auth';

function session(exp = Date.now() + 60000): SessionPayload {
  return {
    sub: 'owner',
    iat: Date.now(),
    exp,
    csrf: 'csrf-token'
  };
}

describe('password hashing', () => {
  it('verifies the correct password and rejects the wrong one', async () => {
    const encoded = await hashPassword('kata-sandi-uji', 100000);

    expect(encoded.startsWith('pbkdf2$100000$')).toBe(true);
    expect(await verifyPassword('kata-sandi-uji', encoded)).toBe(true);
    expect(await verifyPassword('kata-sandi-salah', encoded)).toBe(false);
  });

  it('rejects malformed hashes and weak iteration counts', async () => {
    expect(await verifyPassword('apa saja', 'bukan-hash')).toBe(false);
    expect(await verifyPassword('apa saja', 'pbkdf2$1000$c2FsdA$aGFzaA')).toBe(false);
  });
});

describe('session signing', () => {
  it('round-trips a valid session', async () => {
    const payload = session();
    const token = await signSession(payload, 'secret-yang-cukup-panjang');

    expect(await verifySession(token, 'secret-yang-cukup-panjang')).toEqual(payload);
  });

  it('rejects a tampered token', async () => {
    const token = await signSession(session(), 'secret-yang-cukup-panjang');
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    expect(await verifySession(tampered, 'secret-yang-cukup-panjang')).toBeNull();
  });

  it('rejects an expired session', async () => {
    const token = await signSession(session(Date.now() - 1000), 'secret-yang-cukup-panjang');

    expect(await verifySession(token, 'secret-yang-cukup-panjang')).toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signSession(session(), 'secret-yang-cukup-panjang');

    expect(await verifySession(token, 'secret-lain-yang-cukup-panjang')).toBeNull();
  });
});

describe('csrf comparison', () => {
  it('compares equal and unequal strings', () => {
    expect(constantTimeEqualText('token-a', 'token-a')).toBe(true);
    expect(constantTimeEqualText('token-a', 'token-b')).toBe(false);
  });
});
