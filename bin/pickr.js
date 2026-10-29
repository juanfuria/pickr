#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

async function loadConfig() {
  try {
    const c = JSON.parse(await readFile(CONFIG, 'utf8'));
    if (!c.url || !c.key) throw new Error();
    return c;
  } catch {
    die(`no config at ${CONFIG}; run: pickr init https://i.juan.is pk_…`);
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
    const [url, key] = rest;
    if (!url || !key) die('usage: pickr init URL KEY');
    await mkdir(dirname(CONFIG), { recursive: true, mode: 0o700 });
    await writeFile(CONFIG, JSON.stringify({ url: url.replace(/\/+$/, ''), key }) + '\n', { mode: 0o600 });
    console.log(`config written to ${CONFIG}`);
  },
  async up() {
    if (!rest.length) die('usage: pickr up FILE…');
    const out = [];
    for (const path of rest) {
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
    await call('DELETE', `/api/files/${rest[0]}`);
    console.log(`${rest[0]} moved to trash`);
  },
  async restore() {
    if (!rest[0]) die('usage: pickr restore ID');
    await call('POST', `/api/files/${rest[0]}/restore`);
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

if (!commands[cmd]) die('usage: pickr <init|up|ls|rm|restore|keys|me> [--json] [--kind image|video|file]');
await commands[cmd]();
