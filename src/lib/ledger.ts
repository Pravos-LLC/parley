// The ledger: every agreement's history, clause by clause, with who wrote each change and
// what in the record of the meetings supports it. Built from git history and Parley-* trailers.

import { Git } from './git.js';
import { isAgreementFile, parseConfig, partyOfAgent, partyOfPerson, type ParleyConfig } from './config.js';
import { approves, parseApprovals } from './approvals.js';
import { clauseTexts, touchedClauses, type ClauseText } from './clauses.js';
import {
  classify,
  settle,
  parseTrailers,
  recordAddedByAgent,
  trailerProvenance,
  type ChangeStatus,
  type CitedUtterance,
  type Provenance,
  type VerificationEntry,
} from './provenance.js';
import { parseRecord, type MeetingRecord } from './records.js';
import { frontMatter } from './markdown.js';

export type Origin = 'person' | 'agent' | 'needs-person' | 'synthetic';

export const originOf = (s: ChangeStatus): Origin => (s === 'human' ? 'person' : s === 'agent-sourced' || s === 'approved-synthetic' ? 'agent' : s === 'needs-person' ? 'needs-person' : 'synthetic');

export interface ClauseEvent {
  version: number;
  sha: string;
  date: string;
  kind: 'added' | 'changed' | 'removed';
  status: ChangeStatus;
  author: string;
  source: string;
  reasons: string[];
  cited: CitedUtterance[];
  before?: string;
  after?: string;
}

export interface LedgerClause extends ClauseText {
  status: ChangeStatus;
  origin: Origin;
  author: string;
  source: string;
  reasons: string[];
  cited: CitedUtterance[];
  lastVersion: number;
  history: ClauseEvent[];
}

export interface LedgerVersion {
  n: number;
  sha: string;
  date: string;
  subject: string;
  by: string;
  words: number;
  byOrigin: Record<Origin, number>;
  synthetic: number;
  /** The agreement as it stood at this version, clause by clause. */
  snapshot: {
    id: string;
    title?: string;
    text: string;
    status: ChangeStatus;
    origin: Origin;
    words: number;
    changed: boolean;
    author: string;
    source: string;
    reasons: string[];
    cited: CitedUtterance[];
    since: number;
    verification: (VerificationEntry & { said?: CitedUtterance[] }) | null;
  }[];
  /** Clauses removed in this version. */
  removedHere: { id: string; status: ChangeStatus; author: string; before?: string }[];
}

export interface LedgerAgreement {
  file: string;
  title: string;
  versions: LedgerVersion[];
  clauses: LedgerClause[];
  removed: (ClauseEvent & { id: string })[];
}

export interface Ledger {
  repo: string;
  head: string;
  config: ParleyConfig;
  agreements: LedgerAgreement[];
  records: (MeetingRecord & { addedBy: string; agentWritten: boolean })[];
}

export function buildLedger(cwd: string, head = 'HEAD'): Ledger {
  const git = new Git(cwd);
  const headSha = git.revParse(head);
  const config = parseConfig(git.show(headSha, 'parley.config.yaml'));
  const A = config.paths.agreements.replace(/\/$/, '');
  const R = config.paths.records.replace(/\/$/, '');
  const files = git.lsTree(headSha, A).filter((f) => isAgreementFile(config, f));

  let verifications: VerificationEntry[] = [];
  try {
    const raw = git.show(headSha, '.parley/verifications.json');
    verifications = raw ? (JSON.parse(raw).entries ?? []) : [];
  } catch {
    verifications = [];
  }

  // Approvals recorded in history: Parley-Approved trailers on commits by a person in the config.
  const approvals = git
    .commits(null, headSha)
    .map((sha) => git.commitMeta(sha))
    .flatMap((m) => {
      const party = partyOfPerson(config.parties, m.author);
      if (!party) return [];
      const items = m.body
        .split('\n')
        .map((l) => l.match(/^Parley-Approved(-Contradicted)?:\s*(.+)$/i))
        .filter(Boolean)
        .flatMap((x) => parseApprovals(`${x![1] ? 'approve-contradicted' : 'approve'} ${x![2]}`));
      return items.length ? [{ items, by: m.author, party }] : [];
    });

  const agreements: LedgerAgreement[] = files.map((file) => {
    const shas = git.commits(null, headSha, [file]);
    const state = new Map<string, LedgerClause>();
    const removed: (ClauseEvent & { id: string })[] = [];
    const versions: LedgerVersion[] = [];
    let n = 0;
    for (const sha of shas) {
      const meta = git.commitMeta(sha);
      const text = git.show(sha, file);
      if (!text) continue;
      n++;
      const trailers = parseTrailers(meta.body);
      const parentText = meta.parent ? git.show(meta.parent, file) : '';
      const clauses = clauseTexts(text);
      const before = new Map(clauseTexts(parentText).map((c) => [c.id, c]));
      const touched = parentText ? touchedClauses(git, meta.parent!, sha, file) : new Set(clauses.map((c) => c.id));
      const evidenceRef = meta.parent ?? sha;

      for (const id of touched) {
        if (id === 'front-matter') continue; // metadata, not a clause in the ledger view
        const now = clauses.find((c) => c.id === id);
        let prov: Provenance | null = trailerProvenance(trailers, id);
        if (!prov && partyOfPerson(config.parties, meta.author)) prov = { author: meta.author, source: '', via: 'trailer' };
        const hash = now?.hash ?? '';
        const verification = verifications.filter((v) => v.file === file && v.clause === id && v.hash === hash).pop() ?? null;
        const raw = classify({ git, config, evidenceRef, clause: now ? { id, text: now.text } : undefined, recordProblem: (f) => recordAddedByAgent(git, config, evidenceRef, f) }, prov);
        const approver = (contradicted: boolean) => {
          const agentParty = prov ? partyOfAgent(config.parties, prov.author) : null;
          return approvals.find((a) => (!agentParty || a.party.id !== agentParty.id) && approves(a.items, file, id, hash, contradicted))?.by ?? null;
        };
        const c = settle(raw, { verification, approvedBy: approver(false), approvedContradictedBy: approver(true) });
        const event: ClauseEvent = {
          version: n,
          sha,
          date: meta.date,
          kind: !now ? 'removed' : before.has(id) ? 'changed' : 'added',
          status: c.status,
          author: prov?.author ?? meta.author,
          source: prov?.source ?? '',
          reasons: c.reasons,
          cited: c.cited,
          before: before.get(id)?.text,
          after: now?.text,
        };
        if (!now) {
          const prev = state.get(id);
          state.delete(id);
          removed.push({ ...event, id, before: prev?.text ?? event.before });
          continue;
        }
        const prev = state.get(id);
        state.set(id, {
          ...now,
          status: c.status,
          origin: originOf(c.status),
          author: event.author,
          source: event.source,
          reasons: c.reasons,
          cited: c.cited,
          lastVersion: n,
          history: [...(prev?.history ?? []), event],
        });
      }
      // Clauses not touched keep their state but take the current text.
      for (const c of clauses) {
        const s = state.get(c.id);
        if (s && !touched.has(c.id)) state.set(c.id, { ...s, ...c });
      }
      const ordered = clauses.map((c) => state.get(c.id)).filter(Boolean) as LedgerClause[];
      const byOrigin: Record<Origin, number> = { person: 0, agent: 0, 'needs-person': 0, synthetic: 0 };
      for (const c of ordered) byOrigin[c.origin] += c.words;
      const by = trailers.author ?? trailers.changes[0]?.author ?? meta.author;
      versions.push({
        n,
        sha,
        date: meta.date,
        subject: meta.subject,
        by,
        words: ordered.reduce((s, c) => s + c.words, 0),
        byOrigin,
        synthetic: ordered.filter((c) => c.status === 'synthetic').length + removed.filter((r) => r.version === n && r.status === 'synthetic').length,
        snapshot: ordered.map((c) => {
          const v = verifications.filter((x) => x.file === file && x.clause === c.id && x.hash === c.hash).pop() ?? null;
          // The utterances the model pointed at, from records people made (never agent notes).
          const said = v
            ? v.utterance_ids.flatMap((uid) => {
                for (const rf of git.lsTree(sha, R).filter((f) => f.endsWith('.md'))) {
                  if (recordAddedByAgent(git, config, sha, rf)) continue;
                  const u = parseRecord(rf, git.show(sha, rf)).utterances.find((x) => x.id === uid);
                  if (u) return [{ ...u, file: rf }];
                }
                return [];
              })
            : [];
          // Put the line the model quoted first.
          const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
          const q = norm(v?.quote ?? '');
          const score = (u: CitedUtterance) => (q && (norm(u.text).includes(q) || q.includes(norm(u.text))) ? 0 : 1);
          said.sort((a, b) => score(a) - score(b));
          return { id: c.id, title: c.title, text: c.text, status: c.status, origin: c.origin, words: c.words, changed: touched.has(c.id), author: c.author, source: c.source, reasons: c.reasons, cited: c.cited, since: c.lastVersion, verification: v ? { ...v, said } : null };
        }),
        removedHere: removed.filter((r) => r.version === n).map((r) => ({ id: r.id, status: r.status, author: r.author, before: r.before })),
      });
    }
    const finalText = git.show(headSha, file);
    const fm = frontMatter(finalText);
    const title = fm.title ?? finalText.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file;
    const order = clauseTexts(finalText).map((c) => c.id);
    return {
      file,
      title,
      versions,
      clauses: order.map((id) => state.get(id)).filter(Boolean) as LedgerClause[],
      // A clause removed and later re-added is not "removed".
      removed: removed.filter((r) => !state.has(r.id)),
    };
  });

  const records = git
    .lsTree(headSha, R)
    .filter((f) => f.endsWith('.md') && !/\/(README|TEMPLATE)\.md$/.test(f))
    .map((f) => {
      const problem = recordAddedByAgent(git, config, headSha, f);
      let addedBy = '';
      try {
        const sha = git.run('log', '--diff-filter=A', '--format=%H', headSha, '--', f).trim().split('\n').pop() ?? '';
        if (sha) addedBy = parseTrailers(git.commitMeta(sha).body).author ?? git.commitMeta(sha).author;
      } catch {
        addedBy = '';
      }
      return { ...parseRecord(f, git.show(headSha, f)), addedBy, agentWritten: problem !== null };
    })
    .filter((r) => r.utterances.length > 0);

  return { repo: cwd, head: headSha, config, agreements, records };
}
