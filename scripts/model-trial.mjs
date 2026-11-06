// Trial of open-weight models for `parley verify` on the two-founders demo.
// Usage: OPENROUTER_API_KEY=... node scripts/model-trial.mjs <model> [<model> ...]
// Writes docs/model-trial.json and prints a markdown table for docs/models.md.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const models = process.argv.slice(2);
if (!process.env.OPENROUTER_API_KEY || !models.length) {
  console.error('Usage: OPENROUTER_API_KEY=... node scripts/model-trial.mjs <model> [...]');
  process.exit(2);
}
// Ground truth: agent-written terms that contradict what was said on the call.
// 7.2 cites the right utterances but doubles the agreed cap, so only a reading model can catch it.
const PLANTED = new Set(['3.1', '4.3', '6.1', '6.3', '7.2']);
// Agent changes to the core terms that the call clearly supports. Flagging one is a real false positive.
const CORE_SUPPORTED = new Set(['1.1', '1.3', '2.2', '3.3', '4.1', '4.2', '5.1', '7.1']);
// Everything else is boilerplate added under "standard boilerplate is fine" (sections 8 to 18).
// Flagging boilerplate is a judgment call: some of it adds obligations nobody named.
const work = mkdtempSync(join(tmpdir(), 'parley-trial-'));
const repo = join(work, 'two-founders');
execFileSync('bash', [join(ROOT, 'examples/two-founders/build.sh'), repo]);
const results = {};
for (const model of models) {
  const out = join(work, `${model.replace(/\W+/g, '_')}.json`);
  execFileSync(process.execPath, [join(ROOT, 'dist/cli.mjs'), 'verify', '--repo', repo, '--model', model, '--out', out], { stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
  const entries = JSON.parse(readFileSync(out, 'utf8')).entries;
  const flagged = (e) => e.verdict === 'contradicted' || e.verdict === 'unsupported';
  const planted = entries.filter((e) => PLANTED.has(e.clause));
  const clean = entries.filter((e) => !PLANTED.has(e.clause));
  const caught = planted.filter(flagged).map((e) => e.clause);
  const falsePos = clean.filter(flagged).map((e) => e.clause);
  const cost = entries.reduce((s, e) => s + (e.cost_usd ?? 0), 0);
  const lat = entries.map((e) => e.latency_ms ?? 0).sort((a, b) => a - b);
  results[model] = {
    calls: entries.length,
    planted: planted.length,
    caught: caught.length,
    caught_clauses: caught,
    missed: planted.filter((e) => !flagged(e)).map((e) => `${e.clause}:${e.verdict}`),
    false_positives: falsePos.length,
    false_positive_clauses: falsePos,
    core_false_positives: falsePos.filter((c) => CORE_SUPPORTED.has(c)).length,
    boilerplate_flagged: falsePos.filter((c) => !CORE_SUPPORTED.has(c)).length,
    boilerplate_total: clean.filter((e) => !CORE_SUPPORTED.has(e.clause)).length,
    accuracy: (caught.length + clean.filter((e) => !flagged(e)).length) / Math.max(1, entries.length),
    cost_usd: Number(cost.toFixed(5)),
    median_latency_ms: lat[Math.floor(lat.length / 2)] ?? 0,
    verdicts: Object.fromEntries(entries.map((e) => [e.clause, e.verdict])),
    quotes: Object.fromEntries(planted.map((e) => [e.clause, e.quote])),
    entries,
  };
  console.error(`${model}: caught ${caught.length}/${planted.length}, ${falsePos.length} false positives, $${results[model].cost_usd}, ${results[model].median_latency_ms} ms median`);
}
const slim = Object.fromEntries(Object.entries(results).map(([m, r]) => [m, { ...r, entries: undefined }]));
writeFileSync(join(ROOT, 'docs/model-trial.json'), JSON.stringify({ run_at: new Date().toISOString(), fixture: 'examples/two-founders', planted: [...PLANTED], results: slim }, null, 2) + '\n');
for (const [m, r] of Object.entries(results)) writeFileSync(join(work, `entries-${m.replace(/\W+/g, '_')}.json`), JSON.stringify({ entries: r.entries }, null, 2));
console.log(`entries in ${work}`);
console.log('| Model | Planted terms caught | Core terms wrongly flagged | Boilerplate flagged | Cost, all calls | Median latency |');
console.log('|---|---|---|---|---|---|');
for (const [m, r] of Object.entries(results)) {
  console.log(`| \`${m}\` | ${r.caught} of ${r.planted} | ${r.core_false_positives} of ${CORE_SUPPORTED.size} | ${r.boilerplate_flagged} of ${r.boilerplate_total} | $${r.cost_usd.toFixed(4)} | ${(r.median_latency_ms / 1000).toFixed(1)} s |`);
}
