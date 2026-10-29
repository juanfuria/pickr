#!/usr/bin/env node
import { join } from 'node:path';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';
import { ensureLayout, sweep } from '../server/store.js';
import { generateKey } from '../server/auth.js';
import { purgeVariants } from '../server/cache.js';
import {
  createAccount, getAccountByName, listAccounts, insertKey, revokeKey, getFile, setOwner,
} from '../server/repo.js';

const argv = process.argv.slice(2);
const die = msg => { console.error(msg); process.exit(1); };
const need = (n, usage) => { if (argv.length < n) die(`usage: pickr-admin ${usage}`); };

await ensureLayout(config.root);
const db = openDb(join(config.root, 'pickr.sqlite'));
const now = process.env.PICKR_NOW ? new Date(process.env.PICKR_NOW) : new Date();

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
};

const name = [argv[0], argv[1]].filter(Boolean).join(' ');
const cmd = commands[name] ?? commands[argv[0]];
if (!cmd) die(`usage: pickr-admin <account add|account list|key add|key revoke|file chown|sweep> …`);
try {
  await cmd();
} finally {
  db.close();
}
