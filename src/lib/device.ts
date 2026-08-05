/**
 * Derive a human-readable device label from a User-Agent string.
 * Intentionally simple — no heavy UA parser dependency.
 */
export function parseDeviceName(userAgent?: string | null): string {
  if (!userAgent) return 'Unknown device';

  const ua = userAgent;

  // OS detection
  let os = 'Unknown OS';
  if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) {
    const m = ua.match(/Android ([0-9.]+)/);
    os = m ? `Android ${m[1]}` : 'Android';
  }
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  // Browser/client detection
  let browser = 'Unknown browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/curl\//.test(ua)) browser = 'curl';
  else if (/node/.test(ua.toLowerCase())) browser = 'API client';
  else if (/axios/.test(ua.toLowerCase()) || /fetch/.test(ua.toLowerCase())) browser = 'API client';
  else if (/Postman/.test(ua)) browser = 'Postman';

  return `${browser} on ${os}`;
}
