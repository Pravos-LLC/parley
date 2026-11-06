// End-to-end tests against the built CLI (run `npm run build` first; `npm test` does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Hermetic: no model key, and every child process refuses network calls (logged to NET_LOG).
const NET_LOG = join(mkdtempSync(join(tmpdir(), 'parley-net-')), 'network.log');
delete process.env.OPENROUTER_API_KEY;
delete process.env.PARLEY_OPENROUTER_API;
process.env.PARLEY_NET_LOG = NET_LOG;
process.env.NODE_OPTIONS = `--import ${join(ROOT, 'test/no-network.mjs')}`;
const CLI = join(ROOT, 'dist', 'cli.mjs');
const parley = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts });

let fixture;
const buildFixture = () => {
  if (fixture) return fixture;
  const dir = mkdtempSync(join(tmpdir(), 'parley-fixture-'));
  fixture = join(dir, 'two-founders');
  execFileSync('bash', [join(ROOT, 'examples/two-founders/build.sh'), fixture], { encoding: 'utf8' });
  return fixture;
};

test('audit on the two-founders demo flags exactly the planted synthetic terms', () => {
  const repo = buildFixture();
  const r = parley(['audit', '--repo', repo, '--json']);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  const synthetic = out.findings.filter((f) => f.status === 'synthetic').map((f) => f.clause).sort();
  // 3.1 IP flipped to the studio, citing an utterance that does not exist
  // 4.3 exclusivity nobody asked for (no Source)
  // 6.1 the studio's termination right removed (no Source)
  // 6.3 auto-renewal citing "follow-up notes" an agent wrote itself
  assert.deepEqual(synthetic, ['3.1', '4.3', '6.1', '6.3']);
  const reasons = Object.fromEntries(out.findings.filter((f) => f.status === 'synthetic').map((f) => [f.clause, f.reasons.join(' ')]));
  assert.match(reasons['3.1'], /u099 does not exist/);
  assert.match(reasons['4.3'], /no Source/);
  assert.match(reasons['6.3'], /agents do not write records/);
  // Supported agent changes pass, and people's own text is attributed to them.
  const byClause = Object.fromEntries(out.findings.map((f) => [f.clause, f.status]));
  for (const c of ['1.1', '1.3', '2.2', '3.3', '4.1', '4.2', '5.1', '7.2']) assert.equal(byClause[c], 'agent-sourced', c);
  for (const c of ['2.1', '3.2', '6.2']) assert.equal(byClause[c], 'human', c);
  assert.equal(out.errors.filter((e) => e.startsWith('SYNTHETIC TERM')).length, 4);
  // Every change that cites the call was approved by the other side in history: no amber.
  assert.equal(out.findings.filter((f) => f.status === 'needs-person').length, 0);
});

test('audit of the human draft alone passes', () => {
  const repo = buildFixture();
  const v1 = execFileSync('git', ['-C', repo, 'log', '--format=%H', '--grep', 'short draft from the kickoff call'], { encoding: 'utf8' }).trim();
  const r = parley(['audit', '--repo', repo, '--head', v1]);
  assert.equal(r.status, 0, r.stderr);
});

test('each round is judged on its own: round 4 is clean, round 2 is not', () => {
  const repo = buildFixture();
  const sha = (grep) => execFileSync('git', ['-C', repo, 'log', '--format=%H', '--grep', grep], { encoding: 'utf8' }).trim();
  const r4 = sha('round 4,');
  // The other side's per-change reviews of round 4 end just before the agent's follow-up notes.
  const r4review = execFileSync('git', ['-C', repo, 'rev-parse', `${sha('records: follow-up notes')}~1`], { encoding: 'utf8' }).trim();
  const r2 = sha('round 2,');
  // Round 4 with the other side's review commit is clean; the round alone still needs a person.
  assert.equal(parley(['audit', '--repo', repo, '--base', `${r4}~1`, '--head', r4review]).status, 0);
  const alone = JSON.parse(parley(['audit', '--repo', repo, '--base', `${r4}~1`, '--head', r4, '--json']).stdout);
  assert.ok(alone.findings.length > 0 && alone.findings.every((f) => f.status === 'needs-person'));
  const bad = parley(['audit', '--repo', repo, '--base', `${r2}~1`, '--head', r2, '--json']);
  assert.equal(bad.status, 1);
  assert.deepEqual(JSON.parse(bad.stdout).findings.filter((f) => f.status === 'synthetic').map((f) => f.clause), ['4.3']);
});

test('the ledger shows draft inflation and words by origin', async () => {
  const repo = buildFixture();
  const port = 4400 + Math.floor(Math.random() * 500);
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [CLI, 'ui', '--repo', repo, '--port', String(port)], { stdio: 'pipe' });
  try {
    let ledger;
    for (let i = 0; i < 40 && !ledger; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try {
        ledger = await (await fetch(`http://127.0.0.1:${port}/api/ledger`)).json();
      } catch {}
    }
    assert.ok(ledger, 'ui server answered');
    const a = ledger.agreements[0];
    assert.equal(a.versions.length, 7);
    const first = a.versions[0];
    const last = a.versions.at(-1);
    assert.ok(first.words >= 200 && first.words <= 260, `v1 words ${first.words}`);
    assert.ok(last.words >= 1800, `v7 words ${last.words}`);
    assert.equal(first.byOrigin.person, first.words);
    assert.ok(last.byOrigin.synthetic > 0 && last.byOrigin.agent > last.byOrigin.person);
    assert.ok(a.removed.length === 0, 'no clause removed outright');
    const c61 = a.clauses.find((c) => c.id === '6.1');
    assert.equal(c61.status, 'synthetic');
    assert.equal(c61.history.length, 2);
    const c22 = a.clauses.find((c) => c.id === '2.2');
    assert.equal(c22.cited[0].speaker, 'Priya Shah');
    assert.equal(ledger.records.length, 2);
  } finally {
    child.kill('SIGINT');
  }
});

test('export --agent-trace marks agent lines as ai with their record', () => {
  const repo = buildFixture();
  const r = parley(['export', '--agent-trace', '--repo', repo]);
  assert.equal(r.status, 0, r.stderr);
  const trace = JSON.parse(r.stdout);
  assert.equal(trace.tool.name, 'parley');
  const conv = trace.files[0].conversations;
  const c22 = conv.find((c) => c.metadata.clause === '2.2');
  assert.equal(c22.contributor.type, 'ai');
  assert.equal(c22.contributor.agent_id, 'fleetwise-counsel');
  assert.match(c22.url, /records\/2026-10-14-kickoff\.md#u009/);
  assert.ok(c22.ranges[0].start_line > 0);
  assert.equal(conv.find((c) => c.metadata.clause === '2.1').contributor.type, 'human');
});

test('init scaffolds rules, templates, config, CI and a vendored checker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parley-init-'));
  const r = parley(['init', '--repo', dir, '--party', 'Acme=acme-1:Jo Lee', '--party', 'Globex=gx-1,gx-2:Sam Park,Ria Das']);
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['AGENTS.md', 'NEGOTIATION.md', 'parley.config.yaml', '.github/workflows/parley.yml', '.github/PULL_REQUEST_TEMPLATE/agreement.md', 'agreements/issues/TEMPLATE.md', 'agreements/term-sheets/TEMPLATE.md', 'agreements/call-sheets/TEMPLATE.md', 'records/README.md', '.agents/skills/agreement-negotiation/SKILL.md', '.parley/parley.mjs']) {
    assert.ok(existsSync(join(dir, f)), f);
  }
  const config = readFileSync(join(dir, 'parley.config.yaml'), 'utf8');
  assert.match(config, /name: Globex\n\s+logins: \[gx-1, gx-2\]\n\s+people: \[Sam Park, Ria Das\]/);
  assert.match(readFileSync(join(dir, 'agreements/issues/TEMPLATE.md'), 'utf8'), /\| Acme position \| Globex position \|/);
  // The vendored checker runs on its own.
  const v = spawnSync(process.execPath, [join(dir, '.parley/parley.mjs'), '--version'], { encoding: 'utf8' });
  assert.equal(v.stdout.trim(), '0.1.0');
  // A second init keeps existing files.
  assert.match(parley(['init', '--repo', dir]).stdout, /kept\s+AGENTS\.md/);
  rmSync(dir, { recursive: true, force: true });
});

test('ingest reads WebVTT, WhisperX, Fireflies and plain transcripts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parley-ingest-'));
  const cases = {
    'a.vtt': 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nJo Lee: We agree on net thirty.\n\n2\n00:00:03.200 --> 00:00:04.000\nJo Lee: For both invoices.\n\n3\n00:00:06.000 --> 00:00:08.000\n<v Sam Park>Fine by us.</v>\n',
    'b.json': JSON.stringify({ segments: [{ start: 1, end: 2, text: ' We agree on net thirty.', speaker: 'SPEAKER_00' }, { start: 5, end: 6, text: 'Fine by us.', speaker: 'SPEAKER_01' }] }),
    'c.json': JSON.stringify({ data: { transcript: { sentences: [{ speaker_name: 'Jo Lee', start_time: 1.5, end_time: 3, text: 'We agree on net thirty.' }, { speaker_name: 'Sam Park', start_time: 6, end_time: 7, text: 'Fine by us.' }] } } }),
    'd.txt': '[00:01] Jo Lee: We agree on net thirty.\nSam Park: Fine by us.\n',
  };
  const slugs = { 'a.vtt': 'vtt', 'b.json': 'whisperx', 'c.json': 'fireflies', 'd.txt': 'plain' };
  for (const [name, text] of Object.entries(cases)) {
    writeFileSync(join(dir, name), text);
    const r = parley(['ingest', join(dir, name), '--meeting', slugs[name], '--date', '2026-01-02', '--repo', dir, '--map', 'SPEAKER_00=Jo Lee;SPEAKER_01=Sam Park', '--yes']);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const rec = readFileSync(join(dir, 'records', `2026-01-02-${slugs[name]}.md`), 'utf8');
    assert.match(rec, /\*\*u001\*\* \[00:00:0\d.*\] \*\*Jo Lee:\*\* We agree on net thirty\./, name);
    assert.match(rec, /\*\*u002\*\* \[.*\] \*\*Sam Park:\*\* Fine by us\./, name);
    assert.match(rec, new RegExp(`source: ${slugs[name]}`));
  }
  // Consecutive cues from one speaker merge into one utterance.
  assert.match(readFileSync(join(dir, 'records/2026-01-02-vtt.md'), 'utf8'), /We agree on net thirty\. For both invoices\./);
  // Records are never overwritten.
  const again = parley(['ingest', join(dir, 'a.vtt'), '--meeting', 'vtt', '--date', '2026-01-02', '--repo', dir, '--yes']);
  assert.equal(again.status, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('verify without a key explains itself and leaves the structural rule in place', () => {
  const repo = buildFixture();
  const env = { ...process.env };
  delete env.OPENROUTER_API_KEY;
  const r = parley(['verify', '--repo', repo], { env });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /OPENROUTER_API_KEY is not set/);
});

test('the demo with its saved verify run flags the meaning-level trap too, and doubts do not fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parley-withverify-'));
  const repo = join(dir, 'tf');
  execFileSync('bash', [join(ROOT, 'examples/two-founders/build.sh'), repo, '--with-verify'], { encoding: 'utf8' });
  const r = parley(['audit', '--repo', repo, '--json']);
  const out = JSON.parse(r.stdout);
  const synthetic = out.findings.filter((f) => f.status === 'synthetic').map((f) => f.clause).sort();
  // 7.2 doubles the liability cap the call agreed; 11.3 is the trial's one boilerplate contradiction.
  assert.deepEqual(synthetic, ['11.3', '3.1', '4.3', '6.1', '6.3', '7.2'].sort());
  const doubts = out.findings.filter((f) => f.status === 'agent-sourced' && f.reasons.some((x) => /no support/.test(x)) && f.reasons.some((x) => /approved by/.test(x)));
  assert.ok(doubts.length > 0, 'unsupported verdicts are cleared only by the approval, and say so');
  assert.equal(out.findings.filter((f) => f.status === 'needs-person').length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('a contradicted verdict from parley verify turns a sourced clause synthetic', () => {
  const src = buildFixture();
  const dir = mkdtempSync(join(tmpdir(), 'parley-verdict-'));
  execFileSync('git', ['clone', '-q', src, join(dir, 'r')]);
  const repo = join(dir, 'r');
  const before = JSON.parse(parley(['audit', '--repo', repo, '--json']).stdout);
  const c72 = before.findings.find((f) => f.clause === '7.2');
  assert.equal(c72.status, 'agent-sourced');
  execFileSync('mkdir', ['-p', join(repo, '.parley')]);
  writeFileSync(join(repo, '.parley/verifications.json'), JSON.stringify({ entries: [{ file: 'agreements/design-services.md', clause: '7.2', hash: c72.hash, model: 'test', verdict: 'contradicted', utterance_ids: ['u032'], quote: "I'd say cap it at the fee.", run_at: '2026-10-18T00:00:00Z' }] }));
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-qm', 'verify results']);
  const after = JSON.parse(parley(['audit', '--repo', repo, '--json']).stdout);
  const v = after.findings.find((f) => f.clause === '7.2');
  assert.equal(v.status, 'synthetic');
  assert.match(v.reasons.join(' '), /contradicted/);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------
// Review findings (code-review-parley-pr1) that are about files, the UI server and ingest.
// ---------------------------------------------------------------------------------------

test('H1: the repo holds no list of private names, hashed or plain, and the leak gate reads its terms from the environment', () => {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && !f.startsWith('node_modules/') && !f.startsWith('dist/'));
  for (const f of files) {
    let text = '';
    try {
      text = readFileSync(join(ROOT, f), 'utf8');
    } catch {
      continue;
    }
    // SHA-256 digests are allowed only where they pin a download (gitleaks in ci.yml).
    const digests = new Set(text.match(/\b[0-9a-f]{64}\b/g) ?? []);
    if (f === '.github/workflows/ci.yml') assert.ok(digests.size <= 1, f);
    else assert.equal(digests.size, 0, `${f} contains SHA-256 digests`);
  }
  const gate = readFileSync(join(ROOT, 'scripts/leak-gate.mjs'), 'utf8');
  assert.match(gate, /PARLEY_LEAK_TERMS/);
  // The gate catches a term it is given, without printing it, and skips cleanly without one.
  const dir = mkdtempSync(join(tmpdir(), 'parley-leak-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'notes.md'), 'Call with Zebracorn2 about the deal.\n');
  const env = { ...process.env };
  delete env.PARLEY_LEAK_TERMS;
  const skip = spawnSync(process.execPath, [join(ROOT, 'scripts/leak-gate.mjs')], { cwd: dir, encoding: 'utf8', env });
  assert.equal(skip.status, 0);
  assert.match(skip.stdout, /not set/);
  const hit = spawnSync(process.execPath, [join(ROOT, 'scripts/leak-gate.mjs')], { cwd: dir, encoding: 'utf8', env: { ...env, PARLEY_LEAK_TERMS: 'zebracorn, other' } });
  assert.equal(hit.status, 1);
  assert.match(hit.stderr, /notes\.md:1/);
  assert.doesNotMatch(hit.stderr + hit.stdout, /zebracorn/i);
  rmSync(dir, { recursive: true, force: true });
});

test('M4: parley ui answers only requests addressed to localhost, and sends no CORS headers', async () => {
  const repo = buildFixture();
  const port = 4900 + Math.floor(Math.random() * 500);
  const { spawn } = await import('node:child_process');
  const { request } = await import('node:http');
  const child = spawn(process.execPath, [CLI, 'ui', '--repo', repo, '--port', String(port)], { stdio: 'pipe' });
  const get = (headers) =>
    new Promise((resolve) => {
      const req = request({ host: '127.0.0.1', port, path: '/api/ledger', headers }, (res) => {
        res.resume();
        res.on('end', () => resolve(res));
      });
      req.on('error', () => resolve(null));
      req.end();
    });
  try {
    let ok = null;
    for (let i = 0; i < 40 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 150));
      ok = await get({ Host: `127.0.0.1:${port}` });
    }
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers['access-control-allow-origin'], undefined);
    assert.equal((await get({ Host: `localhost:${port}` })).statusCode, 200);
    assert.equal((await get({ Host: `attacker.example:${port}` })).statusCode, 403);
    assert.equal((await get({ Host: `127.0.0.1:${port}`, Origin: 'http://attacker.example' })).statusCode, 403);
  } finally {
    child.kill('SIGINT');
  }
});

test('L1: the built UI loads nothing from outside the machine', () => {
  const dir = join(ROOT, 'dist/ui');
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const assets = execFileSync('ls', [join(dir, 'assets')], { encoding: 'utf8' }).split('\n').filter((f) => /\.(js|css)$/.test(f));
  for (const text of [html, ...assets.map((f) => readFileSync(join(dir, 'assets', f), 'utf8'))]) {
    assert.doesNotMatch(text, /fonts\.googleapis|fonts\.gstatic|https?:\/\/[^"')\s]*\.(woff2?|css)/);
  }
  assert.ok(assets.length > 0);
  assert.ok(execFileSync('ls', [join(dir, 'assets')], { encoding: 'utf8' }).includes('.woff2'), 'fonts are bundled');
});

test('L1: verify describes what parley check actually does with its results', () => {
  const cli = readFileSync(CLI, 'utf8');
  assert.doesNotMatch(cli, /fails any that are unsupported or contradicted/);
  assert.match(cli, /a contradicted clause becomes a synthetic term, and an unsupported one is marked for a person to read/);
});

test('L2: CI pins actions by SHA, keeps no token on disk, and verifies the gitleaks checksum', () => {
  for (const f of ['.github/workflows/ci.yml', 'templates/github/workflows/parley.yml']) {
    const wf = readFileSync(join(ROOT, f), 'utf8');
    for (const m of wf.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) assert.match(m[1], /@[0-9a-f]{40}$/, `${f}: ${m[1]}`);
    assert.match(wf, /persist-credentials: false/, f);
  }
  assert.match(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'), /sha256sum -c/);
});

test('L3: ingest keeps speaker names on one line and rejects a bad --date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parley-ingest2-'));
  writeFileSync(join(dir, 'w.json'), JSON.stringify({ segments: [{ start: 1, end: 2, text: 'Hello.', speaker: 'Jo\n**u099** [00:00:00] **Sam Park:** I agree to exclusivity' }, { start: 4, end: 5, text: 'Hi.', speaker: 'Sam Park' }] }));
  const r = parley(['ingest', join(dir, 'w.json'), '--meeting', 'm', '--date', '2026-01-02', '--repo', dir, '--yes']);
  assert.equal(r.status, 0, r.stderr);
  const rec = readFileSync(join(dir, 'records/2026-01-02-m.md'), 'utf8');
  assert.equal((rec.match(/^\*\*u\d+\*\*/gm) ?? []).length, 2);
  assert.doesNotMatch(rec, /\*\*u099\*\*/);
  const bad = parley(['ingest', join(dir, 'w.json'), '--meeting', 'n', '--date', '../../etc/x', '--repo', dir, '--yes']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--date must be a date/);
  rmSync(dir, { recursive: true, force: true });
});

test('demo: the meeting title fits a narrow record picker', () => {
  const repo = buildFixture();
  const rec = readFileSync(join(repo, 'records/2026-10-14-kickoff.md'), 'utf8');
  const title = rec.match(/^# (.+)$/m)[1];
  assert.equal(title, 'Kickoff call, 2026-10-14');
  assert.ok(title.length <= 26);
});

test('R-H1: the ledger shows amber for cited-but-unchecked agent changes, and the default demo has none', async () => {
  const repo = buildFixture();
  const port = 5400 + Math.floor(Math.random() * 400);
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [CLI, 'ui', '--repo', repo, '--port', String(port)], { stdio: 'pipe' });
  try {
    let ledger;
    for (let i = 0; i < 40 && !ledger; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try {
        ledger = await (await fetch(`http://127.0.0.1:${port}/api/ledger`)).json();
      } catch {}
    }
    const last = ledger.agreements[0].versions.at(-1);
    const origins = last.snapshot.reduce((m, c) => ((m[c.origin] = (m[c.origin] ?? 0) + 1), m), {});
    assert.equal(origins['needs-person'] ?? 0, 0);
    assert.deepEqual(last.snapshot.filter((c) => c.origin === 'synthetic').map((c) => c.id).sort(), ['3.1', '4.3', '6.1', '6.3']);
  } finally {
    child.kill('SIGINT');
  }
  // Without the other side's review commits, the same history is amber, not red.
  const dir = mkdtempSync(join(tmpdir(), 'parley-amber-'));
  execFileSync('git', ['clone', '-q', repo, join(dir, 'r')]);
  const r = join(dir, 'r');
  const reviews = execFileSync('git', ['-C', r, 'log', '--format=%H', '--grep', '^review:'], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(reviews.length >= 4);
  const first = execFileSync('git', ['-C', r, 'log', '--format=%H', '--grep', 'round 7,'], { encoding: 'utf8' }).trim();
  const out = JSON.parse(parley(['audit', '--repo', r, '--head', first, '--base', `${first}~1`, '--json']).stdout);
  assert.ok(out.findings.some((f) => f.status === 'needs-person'));
  rmSync(dir, { recursive: true, force: true });
});


test('R3-L4: the demo records approvals one change per commit, by the other side', () => {
  const repo = buildFixture();
  const log = execFileSync('git', ['-C', repo, 'log', '--format=%an%x00%B%x01', '--grep', '^review:'], { encoding: 'utf8' }).split('\x01').filter((x) => x.trim());
  assert.ok(log.length >= 40, `${log.length} review commits`);
  for (const entry of log) {
    const [author, body] = entry.trim().split('\x00');
    const trailers = body.split('\n').filter((l) => /^Parley-Approved:/.test(l));
    assert.equal(trailers.length, 1, body);
    assert.match(trailers[0], /^Parley-Approved: [\w.]+ #[0-9a-f]{12}$/);
    assert.ok(['Ana Ruiz', 'Marcus Okafor'].includes(author));
  }
  // None of the four planted terms was ever approved.
  const all = log.join('\n');
  for (const c of ['3.1', '4.3', '6.1', '6.3']) assert.doesNotMatch(all, new RegExp(`Parley-Approved: ${c.replace('.', '\\.')} #`));
});

test('R-L3: no test made a network call, and the guard really blocks one', () => {
  // Runs last: everything before it inherited the guard.
  assert.ok(!existsSync(NET_LOG) || readFileSync(NET_LOG, 'utf8').trim() === '', `network calls: ${existsSync(NET_LOG) ? readFileSync(NET_LOG, 'utf8') : ''}`);
  const repo = buildFixture();
  const r = parley(['verify', '--repo', repo], { env: { ...process.env, OPENROUTER_API_KEY: 'test-key' } });
  assert.equal(r.status, 0);
  assert.match(readFileSync(NET_LOG, 'utf8'), /openrouter\.ai/);
});
