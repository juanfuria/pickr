#!/usr/bin/env node
import { join, basename, extname } from 'node:path';
import { copyFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';
import { ensureLayout, sweep, newTmpPath } from '../server/store.js';
import { ingest } from '../server/ingest.js';
import { isValidId } from '../server/ids.js';
import { generateKey } from '../server/auth.js';
import { purgeVariants } from '../server/cache.js';
import {
  createAccount, getAccountByName, listAccounts, insertKey, revokeKey, getFile, setOwner, listFiles,
} from '../server/repo.js';

const argv = process.argv.slice(2);
const die = msg => { console.error(msg); process.exit(1); };
const need = (n, usage) => { if (argv.length < n) die(`usage: pickr-admin ${usage}`); };

await ensureLayout(config.root);
const db = openDb(join(config.root, 'pickr.sqlite'));
const now = process.env.PICKR_NOW ? new Date(process.env.PICKR_NOW) : new Date();

function opts(startAt) {
  const o = {};
  for (let i = startAt; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) die(`--${k} needs a value`);
    (o[k] ??= []).push(v);
    i++;
  }
  return o;
}
const one = (o, k, def) => (o[k] ? o[k][o[k].length - 1] : def ?? die(`--${k} is required`));

const commands = {
  async 'account add'() {
    need(3, 'account add NAME');
    const name = argv[2];
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) die('account names: lowercase letters, digits, _ and -, starting with a letter');
    if (getAccountByName(db, name)) die(`account ${name} already exists`);
    const a = createAccount(db, name, now.toISOString());
    console.log(`account ${a.name} id=${a.id}`);
  },
  async 'account list'() {
    for (const a of listAccounts(db)) console.log(`${a.name} id=${a.id}`);
  },
  async 'key add'() {
    need(4, 'key add ACCOUNT LABEL');
    const a = getAccountByName(db, argv[2]);
    if (!a) die(`no account named ${argv[2]}`);
    const { key, hash } = generateKey();
    const row = insertKey(db, { accountId: a.id, keyHash: hash, label: argv[3], at: now.toISOString() });
    console.log(`key id=${row.id} for ${a.name} (${row.label}); shown once:`);
    console.log(key);
  },
  async 'key revoke'() {
    need(3, 'key revoke ID');
    if (!/^\d+$/.test(argv[2])) die('key ids are whole numbers');
    const id = Number.parseInt(argv[2], 10);
    const row = db.prepare('SELECT account_id FROM keys WHERE id = ?').get(id);
    if (!row || !revokeKey(db, row.account_id, id, now.toISOString())) die(`no live key with id ${argv[2]}`);
    console.log(`key ${id} revoked`);
  },
  async 'file chown'() {
    need(4, 'file chown ID ACCOUNT');
    const f = getFile(db, argv[2]);
    if (!f) die(`no file with id ${argv[2]}`);
    const a = getAccountByName(db, argv[3]);
    if (!a) die(`no account named ${argv[3]}`);
    setOwner(db, f.id, a.id);
    console.log(`${f.id} now belongs to ${a.name}`);
  },
  async sweep() {
    const r = await sweep({ db, root: config.root, now, trashDays: config.trashDays, purge: (id, ext) => purgeVariants(config.purgeUrl, id, ext) });
    console.log(`removed=${r.removed} tmp=${r.tmpRemoved} failed=${r.failed.length} purge_failed=${r.purgeFailed}`);
    for (const f of r.failed) console.log(`failed: ${f.id} ${f.error}`);
  },
  async 'import-legacy'() {
    const o = opts(1);
    const tsvPath = one(o, 'tsv');
    const dirs = o.dir ?? die('--dir is required');
    const defaultName = one(o, 'default', 'legacy');
    const map = new Map();
    for (const m of o.map ?? []) {
      const [uid, name] = m.split('=');
      const a = getAccountByName(db, name);
      if (!a) die(`no account named ${name}`);
      map.set(Number(uid), a.id);
    }
    const dflt = getAccountByName(db, defaultName);
    if (!dflt) die(`no account named ${defaultName}`);

    const rows = new Map();
    for (const line of (await readFile(tsvPath, 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      const [, userid, filename, timestamp] = line.split('\t');
      rows.set(filename, { userid: Number(userid), timestamp });
    }

    let imported = 0, skipped = 0, failed = 0;
    for (const dir of dirs) {
      for (const name of (await readdir(dir)).sort()) {
        const path = `${dir}/${name}`;
        if (!(await stat(path)).isFile()) continue;
        const id = basename(name, extname(name));
        if (!isValidId(id)) { failed++; console.log(`failed: ${name} invalid id`); continue; }
        if (getFile(db, id)) { skipped++; continue; }
        const row = rows.get(name);
        const accountId = row && map.has(row.userid) ? map.get(row.userid) : dflt.id;
        let createdAt = null;
        if (row && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.timestamp) && !row.timestamp.startsWith('0000')) {
          createdAt = row.timestamp.replace(' ', 'T') + '.000Z';
        } else {
          createdAt = new Date((await stat(path)).mtimeMs).toISOString();
        }
        const tmp = newTmpPath(config.root);
        await copyFile(path, tmp);
        try {
          const hint = extname(name).slice(1).toLowerCase();
          const { file } = await ingest({ db, root: config.root, tmpPath: tmp, accountId, originalName: name, id, createdAt, dedupe: false, extHint: hint });
          // an old URL only survives if the extension did: say so whenever it changed
          if (file.ext !== hint) console.log(`ext-changed: ${name} -> ${file.id}.${file.ext}`);
          imported++;
        } catch (e) {
          failed++;
          console.log(`failed: ${name} ${e.message}`);
        }
      }
    }
    console.log(`imported=${imported} skipped=${skipped} failed=${failed}`);
  },

  async 'import-blog'() {
    const o = opts(1);
    const rootDir = one(o, 'root');
    const refsPath = one(o, 'refs');
    const a = getAccountByName(db, one(o, 'account'));
    if (!a) die('no such account');
    const mappingPath = one(o, 'mapping');
    const deadPath = one(o, 'dead');
    const existing = new Map(listFiles(db, a.id, { limit: 1_000_000 }).filter(f => f.original_name?.startsWith('/')).map(f => [f.original_name, f]));
    const mapping = [], dead = [];
    for (const ref of (await readFile(refsPath, 'utf8')).split('\n').map(s => s.trim()).filter(Boolean)) {
      const path = rootDir + ref;
      const s = await stat(path).catch(() => null);
      if (!s || !s.isFile()) { dead.push(ref); continue; }
      let file = existing.get(ref);
      if (!file) {
        const tmp = newTmpPath(config.root);
        await copyFile(path, tmp);
        try {
          ({ file } = await ingest({ db, root: config.root, tmpPath: tmp, accountId: a.id, originalName: ref, createdAt: new Date(s.mtimeMs).toISOString() }));
        } catch (e) {
          dead.push(`${ref}\t${e.message}`);
          continue;
        }
      }
      mapping.push(`${ref}\t${config.publicUrl}/${file.id}.${file.ext}`);
    }
    await writeFile(mappingPath, mapping.join('\n') + (mapping.length ? '\n' : ''));
    await writeFile(deadPath, dead.join('\n') + (dead.length ? '\n' : ''));
    console.log(`mapped=${mapping.length} dead=${dead.length}`);
  },

  async 'rewrite-sql'() {
    const o = opts(1);
    const host = one(o, 'host').replace(/\/+$/, '');
    const lines = (await readFile(one(o, 'mapping'), 'utf8')).split('\n').filter(Boolean).map(l => l.split('\t'));
    lines.sort((x, y) => y[0].length - x[0].length || x[0].localeCompare(y[0]));
    const q = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
    const out = ['START TRANSACTION;'];
    for (const col of ['contenido', 'especial']) {
      out.push(`UPDATE post SET ${col} = REGEXP_REPLACE(${col}, 'https?://(www\\\\.)?pickr\\\\.me/t/([A-Za-z0-9_.-]+)_([0-9]+)\\\\.([A-Za-z0-9]+)', '${host}/\\\\2.\\\\4?w=\\\\3') WHERE ${col} LIKE '%pickr.me/t/%';`);
      out.push(`UPDATE post SET ${col} = REGEXP_REPLACE(${col}, 'https?://(www\\\\.)?pickr\\\\.me/[if]/', '${host}/') WHERE ${col} LIKE '%pickr.me/%';`);
      for (const [ref, url] of lines) {
        out.push(`UPDATE post SET ${col} = REPLACE(${col}, ${q(ref)}, ${q(url)}) WHERE ${col} LIKE ${q('%' + ref + '%')};`);
      }
    }
    out.push('COMMIT;');
    console.log(out.join('\n'));
  },
};

const name = [argv[0], argv[1]].filter(Boolean).join(' ');
const cmd = Object.hasOwn(commands, name) ? commands[name] : Object.hasOwn(commands, argv[0] ?? '') ? commands[argv[0]] : null;
if (!cmd) die(`usage: pickr-admin <account add|account list|key add|key revoke|file chown|sweep|import-legacy|import-blog|rewrite-sql> …`);
try {
  await cmd();
} finally {
  db.close();
}
