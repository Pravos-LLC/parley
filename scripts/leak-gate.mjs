// Leak gate: fails if any tracked file mentions a term you never want published (a client,
// a counterparty, a person). The terms are not stored in this repo, hashed or otherwise: they
// come from the PARLEY_LEAK_TERMS environment variable (a CI secret), comma-separated.
// Without it the gate skips with a note. Forks set their own secret.
//
//   PARLEY_LEAK_TERMS="acme,jane doe" node scripts/leak-gate.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const terms = (process.env.PARLEY_LEAK_TERMS ?? '')
  .split(',')
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);
if (!terms.length) {
  console.log('Leak gate: PARLEY_LEAK_TERMS is not set, so there is nothing to check. Set it as a CI secret (comma-separated terms) to enable the gate.');
  process.exit(0);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A term matches as a whole word, with or without trailing digits ("acme" also catches "acme2").
const patterns = terms.map((t) => new RegExp(`(^|[^a-z0-9])${escape(t)}\\d*($|[^a-z0-9])`, 'i'));
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.startsWith('node_modules/') && !f.startsWith('dist/'));
const hits = [];
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue; // binary
  const candidates = [f, ...text.split('\n')];
  candidates.forEach((line, i) => {
    if (patterns.some((p) => p.test(line))) hits.push(i === 0 ? `${f} (file name)` : `${f}:${i}`);
  });
}
if (hits.length) {
  // Never print the matched term itself: CI logs may be public.
  console.error(`Leak gate: ${hits.length} line(s) mention a blocked term:\n  ${[...new Set(hits)].join('\n  ')}`);
  process.exit(1);
}
console.log(`Leak gate: ${files.length} files clean against ${terms.length} term(s).`);
