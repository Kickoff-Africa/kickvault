// Set env BEFORE importing anything that reads env
process.env.MASTER_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
process.env.DATABASE_URL = 'postgresql://x:x@localhost:5432/x';

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, type EncryptedData } from './crypto.js';

describe('Envelope Encryption (HKDF + AES-256-GCM)', () => {
  it('should encrypt and decrypt a value correctly', () => {
    const plaintext = 'super-secret-password-123';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'same-input-each-time';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a.encryptedValue).not.toBe(b.encryptedValue);
    expect(a.iv).not.toBe(b.iv);
    // Both must still decrypt correctly
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it('should produce different ciphertext with different key versions', () => {
    const plaintext = 'version-test';
    const v1 = encrypt(plaintext, 1);
    const v2 = encrypt(plaintext, 2);
    expect(v1.encryptedValue).not.toBe(v2.encryptedValue);
    expect(v1.keyVersion).toBe(1);
    expect(v2.keyVersion).toBe(2);
    // Both must decrypt correctly
    expect(decrypt(v1)).toBe(plaintext);
    expect(decrypt(v2)).toBe(plaintext);
  });

  it('should fail decryption with tampered ciphertext', () => {
    const encrypted = encrypt('tamper-test');
    const tampered: EncryptedData = {
      ...encrypted,
      encryptedValue: Buffer.from('tampered-data').toString('base64'),
    };
    expect(() => decrypt(tampered)).toThrow();
  });

  it('should fail decryption with wrong key version', () => {
    const encrypted = encrypt('wrong-key-test', 1);
    const wrongVersion: EncryptedData = {
      ...encrypted,
      keyVersion: 99,
    };
    expect(() => decrypt(wrongVersion)).toThrow();
  });

  it('should handle empty string', () => {
    const encrypted = encrypt('');
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe('');
  });

  it('should handle unicode and special characters', () => {
    const plaintext = '日本語テスト 🔑 <script>alert("xss")</script> \n\t\r';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });
});
