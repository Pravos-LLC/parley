import { AGENTISH, type ParleyConfig, partyOfPerson } from './config.js';
import type { Git } from './git.js';
import { parseRecord, recordRefs, type Utterance } from './records.js';
import { labelCovers } from './clauses.js';

export type AuthorKind = 'human' | 'agent' | 'unknown';

export interface Provenance {
  author: string;
  source: string;
  /** Where this provenance was declared. */
  via: 'table' | 'trailer';
}

export function authorKind(config: ParleyConfig, author: string): AuthorKind {
  const a = author.trim();
  if (!a) return 'unknown';
  if (/^agent:[\w.-]+/i.test(a) || AGENTISH.test(a)) return 'agent';
  if (partyOfPerson(config.parties, a)) return 'human';
  return 'unknown';
}

export const agentId = (author: string) => author.trim().match(/^agent:([\w.-]+)/i)?.[1] ?? author.trim();

/** Trailers on one commit: commit-level Parley-Author / Parley-Source, and per-clause Parley-Change lines. */
export interface CommitTrailers {
  author?: string;
  source?: string;
  model?: string;
  changes: { clause: string; author: string; source: string }[];
}

export function parseTrailers(message: string): CommitTrailers {
  const out: CommitTrailers = { changes: [] };
  for (const line of message.split('\n')) {
    const m = line.match(/^Parley-(Author|Source|Model|Change):\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const v = m[2].trim();
    if (key === 'author') out.author = v;
    else if (key === 'source') out.source = v;
    else if (key === 'model') out.model = v;
    else {
      const [clause, author, ...src] = v.split('|').map((s) => s.trim());
      out.changes.push({ clause: clause ?? '', author: author ?? '', source: src.join('|').trim() });
    }
  }
  return out;
}

/** Provenance for one clause from a commit's trailers, if declared. */
export function trailerProvenance(t: CommitTrailers, clause: string): Provenance | null {
  const specific = t.changes.find((c) => labelCovers(c.clause, clause));
  if (specific) return { author: specific.author, source: specific.source, via: 'trailer' };
  if (t.author) return { author: t.author, source: t.source ?? '', via: 'trailer' };
  return null;
}

export type ChangeStatus = 'human' | 'agent-sourced' | 'synthetic' | 'approved-synthetic' | 'unknown-author';

export interface CitedUtterance extends Utterance {
  file: string;
}

export interface Classification {
  status: ChangeStatus;
  kind: AuthorKind;
  reasons: string[];
  cited: CitedUtterance[];
}

export type Verdict = 'supported' | 'partial' | 'contradicted' | 'unsupported';

export interface VerificationEntry {
  file: string;
  clause: string;
  hash: string;
  model: string;
  verdict: Verdict;
  utterance_ids: string[];
  quote: string;
  confidence?: number;
  latency_ms?: number;
  cost_usd?: number | null;
  run_at: string;
}

export interface SyntheticApproval {
  clause: string;
  hash: string;
  person: string;
  evidence: string;
}

export interface ClassifyContext {
  git: Git;
  config: ParleyConfig;
  /** Records must already exist at this ref to count as evidence (the base branch tip in a PR, or the change's parent in an audit). */
  evidenceRef: string;
  verification?: VerificationEntry | null;
  /** The clause id and its text at head, for instruction checks. */
  clause?: { id: string; text: string };
  /**
   * For an instruction that links a PR comment: null when verified, otherwise the reason.
   * Supplied by the checker after it has fetched the comment (CI) or decided it cannot (local).
   */
  instructionCommentProblem?: (source: string) => string | null;
  /** Returns a reason when a record cannot count as evidence (for example, an agent added it). */
  recordProblem?: (file: string) => string | null;
}

const recordCache = new Map<string, ReturnType<typeof parseRecord>>();
export function loadRecord(git: Git, ref: string, file: string) {
  const key = `${ref}:${file}`;
  if (!recordCache.has(key)) recordCache.set(key, parseRecord(file, git.show(ref, file)));
  return recordCache.get(key)!;
}

export function classify(ctx: ClassifyContext, prov: Provenance | null): Classification {
  const reasons: string[] = [];
  const cited: CitedUtterance[] = [];
  if (!prov || !prov.author.trim()) {
    return { status: 'unknown-author', kind: 'unknown', reasons: ['no Author is declared for this change'], cited };
  }
  const kind = authorKind(ctx.config, prov.author);
  if (kind === 'unknown') {
    return { status: 'unknown-author', kind, reasons: [`Author "${prov.author}" is neither a person named in parley.config.yaml nor agent:<id>`], cited };
  }
  const instruction = /^instruction\b/i.test(prov.source.trim());
  // Resolve cited utterances. A record counts only if it existed before the change.
  const resolved: CitedUtterance[] = [];
  for (const ref of recordRefs(prov.source)) {
    if (!ctx.git.exists(ctx.evidenceRef, ref.file)) {
      reasons.push(`${ref.file} did not exist before this change, so it cannot be its evidence`);
      continue;
    }
    const problem = ctx.recordProblem?.(ref.file);
    if (problem) {
      reasons.push(problem);
      continue;
    }
    const rec = loadRecord(ctx.git, ctx.evidenceRef, ref.file);
    const u = rec.utterances.find((x) => x.id === ref.utterance);
    if (!u) reasons.push(`${ref.file}#${ref.utterance} does not exist`);
    else resolved.push({ ...u, file: ref.file });
  }
  if (kind === 'human') return { status: 'human', kind, reasons, cited: resolved };

  // Agent-authored: needs a source a person gave.
  let sourced = false;
  if (!prov.source.trim()) {
    reasons.push('agent-authored change with no Source');
  } else if (instruction) {
    // "instruction by <Name>, <evidence>": the evidence must be that person's own words.
    const who = prov.source.replace(/^instruction\s*(by|from)?\s*:?\s*/i, '').split(/[,(]/)[0].trim();
    const person = partyOfPerson(ctx.config.parties, who);
    const url = prov.source.match(/https:\/\/github\.com\/\S+#issuecomment-\d+/)?.[0];
    if (!person) {
      reasons.push(`instruction source does not name a person in parley.config.yaml ("${who}")`);
    } else if (resolved.length) {
      // A records/ utterance spoken by that person, naming the clause or its key words.
      const bySpeaker = resolved.filter((u) => sameName(u.speaker, who, ctx.config));
      const onPoint = bySpeaker.filter((u) => mentionsClause(u.text, ctx.clause));
      if (!bySpeaker.length) reasons.push(`the cited utterance was not spoken by ${who}`);
      else if (!onPoint.length) reasons.push(`what ${who} said in the cited utterance does not name clause ${ctx.clause?.id ?? ''} or its key words`);
      else {
        sourced = true;
        cited.push(...onPoint);
      }
    } else if (url) {
      const problem = ctx.instructionCommentProblem ? ctx.instructionCommentProblem(prov.source) : 'the instruction comment was not verified';
      if (problem) reasons.push(problem);
      else sourced = true;
    } else {
      reasons.push(`instruction source has no evidence: cite an utterance by ${who} (records/<file>.md#u012) or link ${who}'s comment on this pull request`);
    }
  } else if (recordRefs(prov.source).length === 0) {
    reasons.push(`Source "${prov.source}" is not a records/ utterance or a linked instruction from a person`);
  } else if (resolved.length) {
    sourced = true;
    cited.push(...resolved);
  }

  // A contradicted verdict fails the change. "unsupported" on a sourced change is a doubt for a
  // person to read, not a failure: in the model trial it mostly marks boilerplate (docs/models.md).
  const v = ctx.verification;
  if (sourced && v && v.verdict === 'contradicted') {
    sourced = false;
    reasons.push(`parley verify (${v.model}) found it contradicted by the transcript${v.quote ? `: "${v.quote}"` : ''}`);
  } else if (sourced && v && v.verdict === 'unsupported') {
    reasons.push(`doubt: parley verify (${v.model}) found no support for it in the transcript; a person should read it`);
  }
  if (sourced) return { status: 'agent-sourced', kind, reasons, cited };
  return { status: 'synthetic', kind, reasons, cited };
}

/** A record added by an agent-authored commit is not evidence: agents do not write the record of what people said. */
export function recordAddedByAgent(git: Git, config: ParleyConfig, ref: string, file: string): string | null {
  let sha = '';
  try {
    sha = git.run('log', '--diff-filter=A', '--format=%H', ref, '--', file).trim().split('\n').pop() ?? '';
  } catch {
    return null;
  }
  if (!sha) return null;
  const t = parseTrailers(git.commitMeta(sha).body);
  if (t.author && authorKind(config, t.author) === 'agent') return `${file} was added by ${t.author}; agents do not write records, so it is not evidence`;
  return null;
}

const STOP = new Set('the and for with that this shall will may must not any each all such other than then from into upon under over their there these those about after before being which while where when what have has had are was were been also only more most some very just like your yours ours them they'.split(' '));
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z][a-z'-]{4,}/g) ?? []).filter((w) => !STOP.has(w)));

/** Does an utterance name the clause id, or share at least two key words (five letters or more) with it? */
export function mentionsClause(text: string, clause?: { id: string; text: string }): boolean {
  if (!clause) return false;
  const esc = clause.id.replace(/\./g, '\\.');
  if (/^\d/.test(clause.id) && new RegExp(`(^|[^\\d.])${esc}([^\\d]|$)`).test(text)) return true;
  const a = words(clause.text.replace(/\*\*[\d.]+\*\*/g, ''));
  let shared = 0;
  for (const w of words(text)) if (a.has(w)) shared++;
  return shared >= 2;
}

function sameName(speaker: string, who: string, config: ParleyConfig): boolean {
  const s = speaker.trim().toLowerCase();
  const w = who.trim().toLowerCase();
  if (s === w) return true;
  const ps = partyOfPerson(config.parties, speaker);
  const pw = partyOfPerson(config.parties, who);
  if (!ps || !pw || ps.id !== pw.id) return false;
  // Same party: match a full name to a unique first or last name.
  return s.split(/\s+/).includes(w) || w.split(/\s+/).includes(s);
}
