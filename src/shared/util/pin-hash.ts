import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 32;

/** Hashea un PIN (login de chofer en la app de combustible) con salt aleatorio. Formato: `salt:hash` (hex). */
export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pin, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const candidate = scryptSync(pin, salt, KEY_LENGTH);
  if (candidate.length !== hashBuffer.length) return false;
  return timingSafeEqual(candidate, hashBuffer);
}
