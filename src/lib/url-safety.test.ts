import { describe, it, expect } from 'vitest';
import { assertHttpsPublicUrl, assertResolvesPublic } from './url-safety.js';

describe('assertHttpsPublicUrl', () => {
  it('accepts a public https URL', () => {
    expect(assertHttpsPublicUrl('https://hooks.example.com/kickvault').hostname).toBe('hooks.example.com');
  });

  it.each([
    'http://example.com/hook',
    'https://localhost/hook',
    'https://127.0.0.1/hook',
    'https://10.0.0.5/hook',
    'https://192.168.1.10/hook',
    'https://172.16.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://service.internal/hook',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => assertHttpsPublicUrl(url)).toThrow();
  });
});

describe('assertResolvesPublic', () => {
  it('rejects private literal addresses and allows public ones without DNS', async () => {
    await expect(assertResolvesPublic(new URL('https://10.1.2.3/x'))).rejects.toThrow();
    await expect(assertResolvesPublic(new URL('https://93.184.216.34/x'))).resolves.toBeUndefined();
  });
});
