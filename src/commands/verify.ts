// parley verify: ask an open-weight model whether what the transcript says supports each
// agent-written clause. It can only add doubt: a missing Source is a synthetic term with or
// without this step.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildLedger } from '../lib/ledger.js';
import type { Utterance } from '../lib/records.js';
import { formatTime } from '../lib/records.js';
import { authorKind, type Verdict, type VerificationEntry } from '../lib/provenance.js';

const STOP = new Set(
  'a an the and or but if of to in on for with by at from as is are was were be been it this that these those we you they i our your their shall will may must not no any each all such other than then so do does did can could would should has have had its into per upon within without'.split(' '),
);
const tokens = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2 && !STOP.has(t));

/** BM25 over utterances. Good enough to put the right lines in front of the model. */
export function retrieve(query: string, pool: (Utterance & { file: string })[], k = 6) {
  const docs = pool.map((u) => tokens(u.text));
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const q = [...new Set(tokens(query))];
  const N = docs.length;
  const scored = pool.map((u, i) => {
    const d = docs[i];
    let score = 0;
    for (const t of q) {
      const f = d.filter((x) => x === t).length;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.length / (avg || 1))));
    }
    return { u, score };
  });
  const top = scored.sort((a, b) => b.score - a.score).slice(0, k).filter((x) => x.score > 0).map((x) => x.u);
  // The answer to a line is usually the next line, so bring each hit's neighbors along.
  const keep = new Set<string>();
  for (const u of top) {
    const i = pool.indexOf(u);
    for (const j of [i - 1, i, i + 1]) if (pool[j] && pool[j].file === u.file) keep.add(`${pool[j].file}#${pool[j].id}`);
  }
  return pool.filter((u) => keep.has(`${u.file}#${u.id}`));
}

export interface VerifyResult {
  verdict: Verdict;
  utterance_ids: string[];
  quote: string;
  confidence: number;
  latencyMs: number;
  costUsd: number | null;
  raw?: string;
}

const SCHEMA = {
  name: 'clause_support',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'utterance_ids', 'quote', 'confidence'],
    properties: {
      verdict: { type: 'string', enum: ['supported', 'partial', 'contradicted', 'unsupported'] },
      utterance_ids: { type: 'array', items: { type: 'string' } },
      quote: { type: 'string' },
      confidence: { type: 'number' },
    },
  },
};

export function buildPrompt(clause: string, lines: (Utterance & { file: string })[]) {
  const transcript = lines.map((u) => `${u.id} [${formatTime(u.startMs)}] ${u.speaker}: ${u.text}`).join('\n');
  return [
    {
      role: 'system',
      content:
        'You check whether a clause in a draft agreement reflects what the people negotiating actually said in their meeting. ' +
        'Judge only against the transcript lines given. Verdicts: "supported" (the people agreed to this substance), ' +
        '"partial" (some of it was agreed, but the clause adds or changes something material), ' +
        '"contradicted" (the people agreed something different or the opposite), ' +
        '"unsupported" (nothing in the lines covers it). Standard wording around an agreed point is fine; new obligations, rights, ' +
        'exclusivity, ownership, renewals, penalties or removed protections are material. ' +
        'Return the ids of the lines you relied on and quote the single most relevant line exactly. Confidence is 0 to 1.',
    },
    {
      role: 'user',
      content: `Clause:\n${clause}\n\nTranscript lines:\n${transcript || '(none found)'}\n\nAnswer with JSON only: {"verdict": "supported|partial|contradicted|unsupported", "utterance_ids": ["u012"], "quote": "...", "confidence": 0.9}`,
    },
  ];
}

export async function verifyClause(model: string, clause: string, lines: (Utterance & { file: string })[], apiKey: string): Promise<VerifyResult> {
  const started = Date.now();
  let format: Record<string, unknown> = { type: 'json_schema', json_schema: SCHEMA };
  const call = (reasoning: Record<string, unknown> | null) =>
    fetch(`${(process.env.PARLEY_OPENROUTER_API ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'parley verify', 'HTTP-Referer': 'https://github.com/Pravos-LLC/parley' },
      body: JSON.stringify({
        model,
        messages: buildPrompt(clause, lines),
        response_format: format,
        temperature: 0,
        max_tokens: 2000,
        usage: { include: true },
        ...(reasoning ? { reasoning } : {}),
      }),
    });
  // A plain completion does this job; switch reasoning off where the model allows it.
  let res = await call({ enabled: false });
  if (res.status === 400) {
    const text = await res.text();
    if (!/reason/i.test(text)) throw new Error(`OpenRouter 400: ${text.slice(0, 300)}`);
    res = await call({ effort: 'low' });
  }
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  let j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number } };
  let content = j.choices?.[0]?.message?.content ?? '';
  if (!/\{[\s\S]*\}/.test(content)) {
    // Some providers return nothing under a strict JSON schema; ask for a plain JSON object instead.
    format = { type: 'json_object' };
    res = await call(null);
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    j = (await res.json()) as typeof j;
    content = j.choices?.[0]?.message?.content ?? '';
  }
  const latencyMs = Date.now() - started;
  const match = content.match(/\{[\s\S]*\}/);
  let parsed: Partial<VerifyResult> = {};
  try {
    parsed = JSON.parse(match ? match[0] : content);
  } catch {
    throw new Error(`Model returned non-JSON: ${content.slice(0, 200)}`);
  }
  const verdict = (['supported', 'partial', 'contradicted', 'unsupported'] as const).includes(parsed.verdict as Verdict) ? (parsed.verdict as Verdict) : 'unsupported';
  return {
    verdict,
    utterance_ids: Array.isArray(parsed.utterance_ids) ? parsed.utterance_ids.map(String) : [],
    quote: String(parsed.quote ?? ''),
    confidence: Number(parsed.confidence ?? 0),
    latencyMs,
    costUsd: j.usage?.cost ?? null,
    raw: content,
  };
}

export async function verifyCommand(args: string[]): Promise<number> {
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const repo = opt('--repo') ?? process.cwd();
  const ledger = buildLedger(repo);
  const model = opt('--model') ?? ledger.config.verify.model;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log('OPENROUTER_API_KEY is not set, so parley verify is skipped. The structural rule still applies: an agent-written change with no Source a human gave is a synthetic term.');
    return 0;
  }
  const pool = ledger.records.flatMap((r) => r.utterances.map((u) => ({ ...u, file: r.file })));
  const path = opt('--out') ?? join(repo, '.parley', 'verifications.json');
  const existing: { entries: VerificationEntry[] } = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { entries: [] };
  let checked = 0;
  for (const a of ledger.agreements) {
    for (const c of a.clauses) {
      if (authorKind(ledger.config, c.author) !== 'agent' || c.words === 0) continue;
      if (existing.entries.some((e) => e.file === a.file && e.clause === c.id && e.hash === c.hash && e.model === model)) continue;
      const lines = [...c.cited, ...retrieve(c.text, pool)].filter((u, i, arr) => arr.findIndex((x) => x.file === u.file && x.id === u.id) === i);
      try {
        const r = await verifyClause(model, c.text, lines, apiKey);
        existing.entries.push({ file: a.file, clause: c.id, hash: c.hash, model, verdict: r.verdict, utterance_ids: r.utterance_ids, quote: r.quote, confidence: r.confidence, latency_ms: r.latencyMs, cost_usd: r.costUsd, run_at: new Date().toISOString() });
        checked++;
        console.log(`${a.file} ${c.id}: ${r.verdict}${r.quote ? ` ("${r.quote.slice(0, 90)}")` : ''}`);
      } catch (e) {
        console.error(`${a.file} ${c.id}: ${(e as Error).message}`);
      }
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(existing, null, 2) + '\n');
  console.log(`\nVerified ${checked} agent-written clause(s) with ${model}. Results in ${path}. parley audit and parley ui read them: a contradicted clause becomes a synthetic term, and an unsupported one is marked for a person to read. In CI, parley check ignores this file and runs verify itself when OPENROUTER_API_KEY is set.`);
  return 0;
}
