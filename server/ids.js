import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const ID_LENGTH = 12;
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const EXT_RE = /^[a-z0-9]{1,8}$/;

// Rejection sampling: 248 = 62 * 4, so bytes below it map uniformly onto the alphabet.
export function newId(length = ID_LENGTH) {
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length)) {
      if (b < 248) {
        out += ALPHABET[b % 62];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

export function splitName(name) {
  if (typeof name !== 'string') return null;
  const i = name.lastIndexOf('.');
  if (i <= 0) return null;
  const id = name.slice(0, i);
  const ext = name.slice(i + 1).toLowerCase();
  if (!isValidId(id) || !EXT_RE.test(ext)) return null;
  return { id, ext };
}
