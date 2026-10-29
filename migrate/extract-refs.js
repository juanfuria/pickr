#!/usr/bin/env node
// Reads post bodies on stdin (any text), prints each distinct root-relative /imagenes/… or /archivos/… path once.
// Trailing backslashes from a SQL export's escaping are dropped.
let text = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) text += chunk;
const found = new Set();
for (const m of text.matchAll(/\/(?:imagenes|archivos)\/[^"'<>()\s\\]+/g)) found.add(m[0]);
for (const p of [...found].sort()) console.log(p);
