import { basename } from 'node:path';

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function contentDisposition(name) {
  const base = basename(String(name ?? '')).replace(/[\r\n"\\]/g, '_').slice(0, 200) || 'file';
  const ascii = base.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`;
}
