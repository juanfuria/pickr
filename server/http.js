import { basename } from 'node:path';

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// RFC 5987 leaves ! ' ( ) * out of attr-char; encodeURIComponent does not encode them.
const rfc5987 = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function contentDisposition(name) {
  // toWellFormed() replaces lone surrogates (encodeURIComponent would throw); the cut is by code point so it never splits a pair.
  const base = Array.from(basename(String(name ?? '')).toWellFormed().replace(/[\r\n"\\]/g, '_')).slice(0, 200).join('') || 'file';
  const ascii = base.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${rfc5987(base)}`;
}
