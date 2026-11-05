import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ValidationError } from './errors.js';

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Synchronous check used when a webhook URL is saved: HTTPS only, no obvious internal hosts. */
export function assertHttpsPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('Invalid URL');
  }
  if (url.protocol !== 'https:') throw new ValidationError('Webhook URL must use HTTPS');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ValidationError('Webhook URL must be publicly reachable');
  }
  if (isIP(host) && isPrivateIp(host)) {
    throw new ValidationError('Webhook URL must be publicly reachable');
  }
  return url;
}

/** Resolve the hostname right before delivery so a DNS change cannot point us at an internal address. */
export async function assertResolvesPublic(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Refusing to deliver to a private address');
    return;
  }
  const addrs = await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error('Refusing to deliver to a private address');
  }
}
