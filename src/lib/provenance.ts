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

/**
 * human: a person wrote it. agent-sourced: an agent wrote it and something cleared it (a verify
 * verdict, the other party's approval, or the person's own instruction comment). needs-person:
 * an agent wrote it citing what was said, but nothing has cleared it yet. synthetic: no source,
 * a bad source, or contradicted by the record. approved-synthetic: synthetic, approved by the
 * other party.
 */
export type ChangeStatus = 'human' | 'agent-sourced' | 'needs-person' | 'synthetic' | 'approved-synthetic' | 'unknown-author';

export interface CitedUtterance extends Utterance {
  file: string;
}

export interface Classification {
  status: ChangeStatus;
  kind: AuthorKind;
  reasons: string[];
  cited: CitedUtterance[];
  clearedBy?: 'verify' | 'approval' | 'instruction';
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

export interface ClassifyContext {
  git: Git;
  config: ParleyConfig;
  /** Records must already exist at this ref to count as evidence (the base branch tip in a PR, or the change's parent in an audit). */
  evidenceRef: string;
  /** The clause id and its text at head. */
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

  // Agent-authored. A cited utterance only says where the change comes from; it does not clear
  // it (status needs-person until verify or the other party clears it, see settle()). Only the
  // person's own instruction comment on the PR clears it outright.
  let status: ChangeStatus = 'synthetic';
  let clearedBy: Classification['clearedBy'];
  if (!prov.source.trim()) {
    reasons.push('agent-authored change with no Source');
  } else if (instruction) {
    const who = prov.source.replace(/^instruction\s*(by|from)?\s*:?\s*/i, '').split(/[,(]/)[0].trim();
    const person = partyOfPerson(ctx.config.parties, who);
    const url = prov.source.match(/https:\/\/github\.com\/\S+#issuecomment-\d+/)?.[0];
    if (!person) {
      reasons.push(`instruction source does not name a person in parley.config.yaml ("${who}")`);
    } else if (url) {
      const problem = ctx.instructionCommentProblem ? ctx.instructionCommentProblem(prov.source) : 'unverifiable: the instruction comment can only be checked in CI';
      if (problem && /^(unverifiable|source-only):/.test(problem)) {
        // A real instruction that does not confirm this exact text (or cannot be fetched here)
        // is a source like an utterance: verify or the other party still has to clear it.
        reasons.push(problem.replace(/^(unverifiable|source-only):\s*/, ''));
        status = 'needs-person';
      } else if (problem) reasons.push(problem);
      else {
        status = 'agent-sourced';
        clearedBy = 'instruction';
      }
    } else if (resolved.length) {
      const bySpeaker = resolved.filter((u) => sameName(u.speaker, who, ctx.config));
      if (!bySpeaker.length) reasons.push(`the cited utterance was not spoken by ${who}`);
      else {
        status = 'needs-person';
        cited.push(...bySpeaker);
      }
    } else if (!recordRefs(prov.source).length) {
      reasons.push(`instruction source has no evidence: link ${who}'s "instruct <clause>: ..." comment on this pull request, or cite an utterance by ${who} (records/<file>.md#u012)`);
    }
  } else if (recordRefs(prov.source).length === 0) {
    reasons.push(`Source "${prov.source}" is not a records/ utterance or an instruction from a person`);
  } else if (resolved.length) {
    status = 'needs-person';
    cited.push(...resolved);
  }
  return { status, kind, reasons, cited, clearedBy };
}

export interface Clearance {
  verification?: VerificationEntry | null;
  /** Who approved this clause at its current hash ("approve <clause> #<hash>"), if anyone. */
  approvedBy?: string | null;
  /** Who approved it despite a contradicted verdict ("approve-contradicted <clause> #<hash>"). */
  approvedContradictedBy?: string | null;
}

/**
 * Decide whether an agent-written change is cleared. A citation is cleared by a verify verdict
 * of supported or partial, or by the other party's hash-bound approval. A contradicted verdict
 * makes it synthetic, cleared only by "approve-contradicted". A synthetic term is cleared only by
 * an approval.
 */
export function settle(c: Classification, cl: Clearance): Classification {
  const reasons = [...c.reasons];
  const v = cl.verification;
  if (c.status === 'needs-person') {
    if (v && v.verdict === 'contradicted') {
      reasons.push(`parley verify (${v.model}) found it contradicted by the transcript${v.quote ? `: "${v.quote}"` : ''}`);
      if (cl.approvedContradictedBy) return { ...c, status: 'approved-synthetic', reasons: [...reasons, `approved despite the contradiction by ${cl.approvedContradictedBy}`] };
      return { ...c, status: 'synthetic', reasons };
    }
    // Only "supported" clears. "partial" means the clause adds or changes something material.
    if (v && v.verdict === 'supported') return { ...c, status: 'agent-sourced', clearedBy: 'verify', reasons: [...reasons, `parley verify (${v.model}): supported`] };
    if (cl.approvedBy || cl.approvedContradictedBy) {
      if (v && (v.verdict === 'unsupported' || v.verdict === 'partial')) reasons.push(`parley verify (${v.model}) found ${v.verdict === 'partial' ? 'only partial' : 'no'} support for it in the transcript`);
      return { ...c, status: 'agent-sourced', clearedBy: 'approval', reasons: [...reasons, `approved by ${cl.approvedBy ?? cl.approvedContradictedBy}`] };
    }
    if (v && v.verdict === 'unsupported') reasons.push(`parley verify (${v.model}) found no support for it in the transcript`);
    else if (v && v.verdict === 'partial') reasons.push(`parley verify (${v.model}) found it only partly supported: it adds or changes something, so a person has to look`);
    else if (!v) reasons.push('cites what was said, but nothing has checked that it says this: needs parley verify or the other party\'s approval');
    return { ...c, reasons };
  }
  if (c.status === 'synthetic' && (cl.approvedBy || cl.approvedContradictedBy)) {
    return { ...c, status: 'approved-synthetic', reasons: [...reasons, `approved by ${cl.approvedBy ?? cl.approvedContradictedBy}`] };
  }
  return c;
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
