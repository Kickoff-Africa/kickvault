import { describe, it, expect } from 'vitest';
import { generateTotpSecret, totpUri, verifyTotp } from './totp.js';

// RFC 6238 appendix B: secret "12345678901234567890" (SHA-1). At T=59s the 8-digit code is 94287082,
// so the 6-digit code is 287082.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp', () => {
  it('matches the RFC 6238 test vector', () => {
    expect(verifyTotp(RFC_SECRET, '287082', 59_000)).toBe(true);
  });

  it('accepts one step of clock drift but not more', () => {
    expect(verifyTotp(RFC_SECRET, '287082', 59_000 + 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, '287082', 59_000 + 120_000)).toBe(false);
  });

  it('rejects wrong or malformed codes', () => {
    expect(verifyTotp(RFC_SECRET, '000000', 59_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '28708', 59_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET, 'abcdef', 59_000)).toBe(false);
  });

  it('generates a base32 secret and a valid otpauth URI', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = totpUri(secret, 'a@b.com');
    expect(uri.startsWith('otpauth://totp/Kick%20Vault%3Aa%40b.com?secret=')).toBe(true);
  });
});
