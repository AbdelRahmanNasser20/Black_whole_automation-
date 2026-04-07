/**
 * Lightweight E.164 helpers. In production we'd use libphonenumber-js,
 * but the goal here is to keep the surface tiny and pure.
 */
const E164 = /^\+[1-9]\d{6,14}$/;

export function assertE164(value: string): asserts value is string {
  if (!E164.test(value)) {
    throw new Error('phone number must be in E.164 format');
  }
}

export function lastFour(value: string): string {
  if (value.length < 4) return value.padStart(4, '0');
  return value.slice(-4);
}

export function maskPhone(value: string): string {
  if (!value) return '****';
  const tail = lastFour(value);
  return `••• ••• ${tail}`;
}
