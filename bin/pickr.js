#!/usr/bin/env node
import { readFile, mkdir, open, stat } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';

const CONFIG = process.env.PICKR_CONFIG ?? join(homedir(), '.config', 'pickr', 'config.json');
const args = process.argv.slice(2);
const json = args.includes('--json');
const kindIdx = args.indexOf('--kind');
const kind = kindIdx >= 0 ? args[kindIdx + 1] : null;
const positional = args.filter((a, i) => !a.startsWith('--') && !(kindIdx >= 0 && i === kindIdx + 1));
const [cmd, ...rest] = positional;

const die = msg => { console.error(msg); process.exit(1); };

// A key is pk_ plus base64url; anything else is a typo or swapped arguments, and must never be sent or echoed.
const KEY_RE = /^pk_[A-Za-z0-9_-]{16,}$/;

// https only, except plain http to this machine; no credentials, query or fragment. Returns the URL without a trailing
// slash, or null.
function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.username || u.password || /[?#]/.test(u.href)) return null;
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return null;
  return u.href.replace(/\/+$/, '');
}

async function loadConfig() {
  try {
    const c = JSON.parse(await readFile(CONFIG, 'utf8'));
    if (!checkUrl(c.url ?? '') || !KEY_RE.test(c.key ?? '')) throw new Error();
    return { url: checkUrl(c.url), key: c.key };
  } catch {
    die(`no usable config at ${CONFIG}; run: pickr init https://i.juan.is pk_…`);
  }
}

async function call(method, path, { body, form } = {}) {
  const cfg = await loadConfig();
  const headers = { authorization: `Bearer ${cfg.key}` };
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(cfg.url + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }));
  if (!r.ok) die(data.error ?? `${r.status}`);
  return data;
}

function copy(text) {
  try { const p = execFile('pbcopy'); p.stdin.end(text); p.on('error', () => {}); } catch { /* no clipboard */ }
}

const fmtBytes = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}B`);
const line = f => `${f.id}  ${f.kind.padEnd(5)}  ${fmtBytes(f.bytes).padStart(6)}  ${f.width ? `${f.width}x${f.height}` : ''.padEnd(9)}  ${f.created_at.slice(0, 10)}  ${f.original_name ?? ''}`;

const commands = {
  async init() {
    const [rawUrl, key] = rest;
    if (!rawUrl || !key) die('usage: pickr init URL KEY');
    const url = checkUrl(rawUrl);
    // neither message echoes what was typed: with swapped arguments, that would be the key
    if (!url) die('the URL must be https:// (plain http only for localhost), with no credentials; the order is pickr init URL KEY');
    if (!KEY_RE.test(key)) die('that is not a pickr key (pk_ followed by letters, digits, _ or -); the order is pickr init URL KEY');
    await mkdir(dirname(CONFIG), { recursive: true, mode: 0o700 });
    // open first (it fails on a directory before anything is changed), tighten, then write
    const fh = await open(CONFIG, 'w', 0o600);
    try {
      await fh.chmod(0o600);
      await fh.writeFile(JSON.stringify({ url, key }) + '\n');
    } finally {
      await fh.close();
    }
    console.log(`config written to ${CONFIG}`);
  },
  async up() {
    if (!rest.length) die('usage: pickr up FILE…');
    const out = [];
    for (const path of rest) {
      try { await stat(path); } catch (e) { die(`cannot read ${path}: ${e.code ?? e.message}`); }
      const form = new FormData();
      form.set('file', await openAsBlob(path), basename(path));
      const f = await call('POST', '/api/files', { form });
      out.push(f);
      if (!json) console.log(f.url);
    }
    if (json) console.log(JSON.stringify(out, null, 2));
    copy(out[out.length - 1].url);
  },
  async ls() {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    const { files } = await call('GET', `/api/files${qs}`);
    if (json) console.log(JSON.stringify(files, null, 2));
    else for (const f of files) console.log(line(f));
  },
  async rm() {
    if (!rest[0]) die('usage: pickr rm ID');
    await call('DELETE', `/api/files/${encodeURIComponent(rest[0])}`);
    console.log(`${rest[0]} moved to trash`);
  },
  async restore() {
    if (!rest[0]) die('usage: pickr restore ID');
    await call('POST', `/api/files/${encodeURIComponent(rest[0])}/restore`);
    console.log(`${rest[0]} restored`);
  },
  async keys() {
    const { keys } = await call('GET', '/api/keys');
    if (json) console.log(JSON.stringify(keys, null, 2));
    else for (const k of keys) console.log(`${k.id}  ${k.revoked_at ? 'revoked' : 'live   '}  ${k.label}  last used ${k.last_used_at ?? 'never'}`);
  },
  async me() {
    const me = await call('GET', '/api/me');
    if (json) console.log(JSON.stringify(me, null, 2));
    else console.log(`${me.account}: ${me.files} files, ${fmtBytes(me.bytes)}`);
  },
};

if (!Object.hasOwn(commands, cmd ?? '')) die('usage: pickr <init|up|ls|rm|restore|keys|me> [--json] [--kind image|video|file]');
try {
  await commands[cmd]();
} catch (e) {
  // one line, never a stack, never a key: "fetch failed: connect ECONNREFUSED …" or "ENOENT: no such file …"
  const msg = e?.cause?.message ? `${e.message}: ${e.cause.message}` : String(e?.message ?? e);
  die(msg.replace(/pk_[A-Za-z0-9_-]+/g, 'pk_…').split('\n')[0]);
}
