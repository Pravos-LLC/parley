// parley check: an agreement PR discloses every clause it changes, says who wrote each
// change, and carries no synthetic terms (agent-written terms nobody discussed).
//
// What it checks, in CI and locally:
//
// The base branch decides. Configuration, NEGOTIATION.md adoption, issues-list existence and
// merged records are read from the base branch tip (the PR's base ref), and the PR must be up to
// date with that tip, so a PR cannot pick older, weaker rules by branching from an old commit.
// The GitHub workflow runs the base tip's own copy of this checker.
//
// Every PR:
//   - merged records are never edited; new records need a participant's sign-off (below);
//   - a PR that changes rules, checks or config (.parley/, .github/, parley.config.yaml,
//     NEGOTIATION.md, AGENTS.md, agent instruction files) needs a comment from every party on
//     this PR: "approve rules <first 12 characters of the head commit>". It may not also change an
//     agreement or issues list.
//
// Agreement texts (every *.md under agreements/, including term sheets and subfolders, except
// issues lists, call sheets, README.md and TEMPLATE.md):
//   - every clause touched has a row in the change table (first column "Clause"), and the body
//     has a "Discussed live:" line. Front matter is a pseudo-clause: any change inside it needs a
//     row, unless the line only sets version, date or status. Unclosed front matter fails;
//   - provenance (unless provenance.required is false): each touched clause names an Author
//     (a person in parley.config.yaml, or agent:<id>) in the table and/or Parley-* trailers. If
//     the table and the trailers disagree about who wrote it, the check fails. An agent-written
//     change needs a Source a person gave: a records/ utterance merged on the base branch, or an
//     instruction (that person's own utterance naming the clause or its key words, or that
//     person's unedited comment on this PR naming the clause). Otherwise it is a synthetic term;
//   - a synthetic term passes only with a comment on this PR from a login of a party other than
//     the PR author's: "approve <clause> #<current clause hash>", posted after the latest push and
//     never edited. A changed clause has a new hash, so approvals expire;
//   - with OPENROUTER_API_KEY set, CI runs parley verify on agent-written changes; a clause the
//     transcript contradicts is a synthetic term. Verification results in the PR head are ignored;
//   - a clause that mentions a material term cannot merge while "Discussed live" is "Not yet".
//
// Once NEGOTIATION.md is adopted on the base branch, for agreements with an issues list:
//   - every row states an Interest and a Why, names a person or party in "Asked for by" (never an
//     agent or AI tool) and cites an Issue ID on the issues list (or n/a with a Why);
//   - the PR's "Round:" equals the issues list's round, which may not go down; at round 3 or more,
//     "Discussed live" must link a records/ note already on the base branch;
//   - issues lists change only from a party's GitHub login; no issue is deleted; each party edits
//     only its own position column; the header is fixed; one table of unique PREFIX-NN ids;
//     marking an issue agreed or changing an agreed row needs every other party's linked approval.

import { readFileSync } from 'node:fs';
import { Git } from '../lib/git.js';
import {
  type ParleyConfig,
  type Party,
  AGENTISH,
  anyPartyPattern,
  isAgreementFile,
  isIssuesList,
  loginsForPerson,
  parseConfig,
  partyOfAgent,
  partyOfLogin,
  partyOfPerson,
  partyPattern,
} from '../lib/config.js';
import { colIndex, frontMatter, frontMatterNumber, parseTable, stripMarkup, type Table } from '../lib/markdown.js';
import { clauseHash, clauseTextById, coverage, frontMatterState, labelCovers, touchedClauses } from '../lib/clauses.js';
import {
  authorKind,
  classify,
  settle,
  parseTrailers,
  recordAddedByAgent,
  trailerProvenance,
  type Classification,
  type Provenance,
  type VerificationEntry,
} from '../lib/provenance.js';
import { commentProblem, GitHub, type GhComment } from '../lib/github.js';
import { approves, approvesRecord, approvesRules, instructs, issueVerdict, parseApprovals, type ApprovalItem } from '../lib/approvals.js';
import { sha256, shortHash } from '../lib/markdown.js';
import { parseRecord } from '../lib/records.js';
import { retrieve, verifyClause } from './verify.js';

export interface CheckOptions {
  cwd?: string;
  base: string;
  head?: string;
  /** PR body. Null means audit mode: no PR, provenance and disclosure from commit trailers only. */
  body: string | null;
  author?: string;
  /** Pull request number, for reading approvals and instructions from its comments. */
  pr?: number;
  /** Run parley verify on agent-written changes when OPENROUTER_API_KEY is set (CI). */
  verify?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface Finding {
  file: string;
  clause: string;
  author: string;
  source: string;
  status: Classification['status'];
  reasons: string[];
  commit?: string;
  hash: string;
}

export interface CheckResult {
  ok: boolean;
  log: string[];
  /** One line per clause that passed provenance (printed with --verbose). */
  detail: string[];
  errors: string[];
  findings: Finding[];
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

const TOOLING =
  /^(scripts\/|\.github\/|\.agents\/|\.claude\/|\.codex\/|\.cursor\/|\.opencode\/|\.gemini\/|\.windsurf\/|\.aider[^/]*|\.parley\/|NEGOTIATION\.md$|AGENTS\.md$|CLAUDE\.md$|GEMINI\.md$|\.cursorrules$|opencode\.json$|\.mcp\.json$|parley\.config\.ya?ml$)/;

export function negotiationStatus(text: string): string {
  if (!text) return 'absent';
  const v = frontMatter(text).status ?? '';
  return v === 'proposed' || v === 'adopted' ? v : `invalid (${v || 'missing'})`;
}

function issuesRows(text: string) {
  const t = parseTable(text, /^id$/i);
  const rows = new Map<string, string[]>();
  const bad: string[] = [];
  if (!t) return { header: [] as string[], rows, bad };
  const allRows = text.split('\n').filter((l) => /^\s*\|/.test(l)).length;
  if (allRows !== t.rows.length + 2) bad.push('the file has table rows outside the issues table; keep one table');
  for (const cells of t.rows) {
    const id = stripMarkup(cells[0] ?? '');
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(id)) bad.push(`row with ID "${id || '(blank)'}" does not use the ID format PREFIX-NN`);
    else if (rows.has(id)) bad.push(`${id} appears more than once`);
    else rows.set(id, cells);
  }
  return { header: t.header, rows, bad };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function runCheck(opts: CheckOptions): Promise<CheckResult> {
  const git = new Git(opts.cwd);
  const env = opts.env ?? process.env;
  const gh = new GitHub(env);
  const head = opts.head ?? 'HEAD';
  const audit = opts.body === null;
  const author = (opts.author ?? '').trim();
  const log: string[] = [];
  const detail: string[] = [];
  const errors: string[] = [];
  const findings: Finding[] = [];
  const say = (m: string) => log.push(m);
  const fail = (m: string) => errors.push(m);
  const done = () => ({ ok: errors.length === 0, log, detail, errors, findings });

  // In CI, anything we cannot verify fails. Locally, approvals cannot be fetched.
  const ci = gh.ci;
  const pr = opts.pr;
  const canVerify = !audit && gh.available && pr != null;
  if (!audit && ci && !canVerify) fail('Running in CI without GITHUB_TOKEN, GITHUB_REPOSITORY and --pr, so approvals and instructions cannot be verified.');
  let body = (opts.body ?? '').replace(/\r\n/g, '\n');
  if (canVerify && !body.trim()) {
    const info = await gh.pullRequest(pr!);
    if (info) body = info.body.replace(/\r\n/g, '\n');
  }

  const headSha = git.revParse(head);
  const baseTip = git.revParse(opts.base);
  const mergeBase = git.mergeBase(baseTip, headSha);
  const changedFiles = git.changedFiles(mergeBase, headSha);

  // The PR must be judged by today's base: config, adoption and records at the base tip.
  if (!audit && mergeBase !== baseTip) {
    const behind = git.run('rev-list', '--count', `${mergeBase}..${baseTip}`).trim();
    fail(`This PR is ${behind} commit(s) behind ${opts.base}. Update it (merge or rebase on ${opts.base}) so it is checked against the current rules, parties and records.`);
  }
  const ruleRef = audit ? mergeBase : baseTip;
  const baseConfigText = git.show(ruleRef, 'parley.config.yaml');
  const bootstrap = !baseConfigText;
  const config: ParleyConfig = parseConfig(baseConfigText || git.show(headSha, 'parley.config.yaml'));
  if (bootstrap) say('parley.config.yaml is not on the base branch yet; using the PR\'s copy (first setup).');
  const A = config.paths.agreements.replace(/\/$/, '');
  const I = config.paths.issues.replace(/\/$/, '');
  const R = config.paths.records.replace(/\/$/, '');
  const changed = changedFiles.filter((f) => isAgreementFile(config, f));
  const issuesChanged = changedFiles.filter((f) => isIssuesList(config, f));
  const issuesPath = (agreement: string) => `${I}/${agreement.slice(A.length + 1)}`;
  const authorParty = author ? partyOfLogin(config.parties, author) : null;
  const otherParties = config.parties.filter((p) => p.id !== authorParty?.id);

  // ---- Comments on this PR (CI) ----
  let comments: GhComment[] = [];
  let pushedAt = '';
  if (canVerify) {
    comments = await gh.comments(pr!);
    const times = [git.run('log', '-1', '--format=%cI', headSha).trim(), ...(await gh.forcePushTimes(pr!))];
    pushedAt = times.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? '';
  }
  /** Valid comments on this PR from these logins (on this PR, unedited, optionally after the latest push) whose body passes. */
  const commentsFrom = (logins: string[], test: (body: string) => boolean, afterPush: boolean) =>
    comments.filter((c) => !commentProblem(c, { pr: pr!, logins, after: afterPush ? pushedAt : undefined }) && test(c.body));
  if (config.provenance.agentSources !== 'verify-or-approve') fail(`parley.config.yaml: provenance.agent_sources must be "verify-or-approve", not "${config.provenance.agentSources}".`);
  const shortHead = headSha.slice(0, 12);

  // ---- records/ are immutable once merged; new records need a participant's sign-off ----
  const newRecords: string[] = [];
  for (const f of changedFiles) {
    if (!f.startsWith(`${R}/`) || /(^|\/)README\.md$/.test(f)) continue;
    if (git.exists(mergeBase, f) || git.exists(baseTip, f)) {
      if (git.show(baseTip, f) !== git.show(headSha, f)) fail(`${f} is a merged record and this PR changes it. Records are never edited; add a new record instead.`);
    } else if (git.exists(headSha, f) && f.endsWith('.md')) newRecords.push(f);
  }
  if (!audit && !bootstrap) {
    for (const f of newRecords) {
      const text = git.show(headSha, f);
      const rec = parseRecord(f, text);
      const name = f.split('/').pop()!;
      const sha12 = sha256(text).slice(0, 12);
      const speakers = [...new Set(rec.utterances.map((u) => u.speaker))];
      // Everyone who speaks outside the PR author's party must sign off on these exact words.
      const outside = speakers.filter((sp) => !authorParty || partyOfPerson(config.parties, sp)?.id !== authorParty.id);
      if (!outside.length) {
        // Only the author's own party speaks: a participant may post it with the media hash.
        const media = /^[0-9a-f]{64}$/i.test(frontMatter(text).source_sha256 ?? '');
        if (authorParty && media) continue;
        fail(`${f}: a record in which only ${authorParty?.name ?? 'the author'} speaks needs the transcript's source_sha256 in its front matter, and must come from a login of that party.`);
        continue;
      }
      const unknown = outside.filter((sp) => !partyOfPerson(config.parties, sp));
      if (unknown.length) {
        fail(`${f}: ${unknown.join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not a person in parley.config.yaml, so nobody can sign off for them. Map speaker labels to people at ingest.`);
        continue;
      }
      const parties = [...new Map(outside.map((sp) => [partyOfPerson(config.parties, sp)!.id, partyOfPerson(config.parties, sp)!])).values()];
      if (!canVerify) {
        if (ci) fail(`${f}: its sign-off cannot be verified in this run.`);
        else say(`(local run: ${f} needs "approve record ${name} #${sha12}" from ${parties.map((p) => p.name).join(' and ')} on the PR; CI checks.)`);
        continue;
      }
      const missing = parties.filter((p) => commentsFrom(p.logins, (b) => approvesRecord(b, name, sha12), true).length === 0);
      if (missing.length) fail(`${f} puts words in the mouth of ${missing.map((p) => p.name).join(' and ')}. Each needs to comment on this PR, after the latest push: "approve record ${name} #${sha12}" (the first 12 characters of the file's SHA-256, which changes if the file does).`);
    }
  }

  // ---- NEGOTIATION.md status (from the base tip) ----
  const baseStatus = negotiationStatus(git.show(ruleRef, 'NEGOTIATION.md'));
  const headStatus = negotiationStatus(git.show(headSha, 'NEGOTIATION.md'));
  say(`NEGOTIATION.md status: ${baseStatus} on the base branch, ${headStatus} at head.`);
  for (const s of [baseStatus, headStatus]) if (s.startsWith('invalid')) fail(`NEGOTIATION.md status must be "proposed" or "adopted"; found ${s}.`);
  const statusFlip = baseStatus !== 'absent' && baseStatus !== headStatus && (baseStatus === 'adopted' || headStatus === 'adopted');
  const withoutStatus = (t: string) => t.replace(/\r\n/g, '\n').replace(/^status:.*$/m, '');
  if (statusFlip && withoutStatus(git.show(ruleRef, 'NEGOTIATION.md')) !== withoutStatus(git.show(headSha, 'NEGOTIATION.md'))) {
    fail('A PR that changes NEGOTIATION.md status to or from "adopted" must not change any other text in NEGOTIATION.md.');
  }
  if (statusFlip && changedFiles.some((f) => f !== 'NEGOTIATION.md')) {
    fail(`A PR that changes NEGOTIATION.md status to or from "adopted" must change nothing else. It also changes: ${changedFiles.filter((f) => f !== 'NEGOTIATION.md').join(', ')}.`);
  }
  const adopted = baseStatus === 'adopted';

  // ---- Rules, checks and config ----
  const tooling = changedFiles.filter((f) => TOOLING.test(f));
  if (!audit && tooling.length) {
    if (changed.length || issuesChanged.length) {
      fail(`A PR that changes an agreement or an issues list must not also change the rules, the checks or the config. Split out: ${tooling.join(', ')}.`);
    }
    if (!bootstrap) {
      if (canVerify) {
        const missing = config.parties.filter((p) => commentsFrom(p.logins, (b) => approvesRules(b, shortHead), true).length === 0);
        if (missing.length) fail(`This PR changes the rules, checks or config (${tooling.join(', ')}). Every party approves that: ${missing.map((p) => p.name).join(' and ')} still need to comment "approve rules ${shortHead}" on this PR.`);
      } else if (!ci) {
        say(`(local run: changes to ${tooling.join(', ')} need "approve rules ${shortHead}" from every party on the PR; CI checks.)`);
      }
    }
  }

  if (changed.length === 0 && issuesChanged.length === 0) {
    say('No agreement texts or issues lists changed.');
    return done();
  }

  // ---- Body lines ----
  const bodyNoComments = body.replace(/<!--[\s\S]*?-->/g, '');
  const lineValue = (label: string) => {
    const m = bodyNoComments.match(new RegExp(`^\\s*(?:\\*\\*)?${label}:(?:\\*\\*)?[ \\t]*(.*)$`, 'im'));
    return (m?.[1] ?? '').trim();
  };
  const lineValues = (label: string) =>
    [...bodyNoComments.matchAll(new RegExp(`^\\s*(?:\\*\\*)?${label}:(?:\\*\\*)?[ \\t]*(.*)$`, 'gim'))].map((m) => m[1].trim());
  const discussedValue = lineValue('Discussed live');

  // ---- Linked comments (issues-list approvals, instructions) ----
  /** Who wrote a linked comment on this PR, or why it does not count. Null locally (cannot check). */
  const linkedComment = async (url: string, logins: string[], test: (body: string) => boolean): Promise<string | null> => {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)#issuecomment-(\d+)/);
    if (!m) return 'the link is not a GitHub comment';
    if (!canVerify) return ci ? 'it cannot be verified in this run' : null;
    if (`${m[1]}/${m[2]}`.toLowerCase() !== gh.repo.toLowerCase()) return 'it is in another repository';
    const c = await gh.comment(m[4]);
    if (!c) return 'the comment was not found';
    const problem = commentProblem(c, { pr: pr!, logins });
    if (problem) return problem;
    if (!test(c.body)) return 'the comment does not say it in the expected form';
    return '';
  };
  // ---- Disclosure: every touched clause has a row in the change table ----
  const table: Table | null = audit ? null : parseTable(body, /^clause$/i);
  const multi = changed.length > 1;
  const rel = (f: string) => f.slice(A.length + 1);
  const rowsByFile = new Map<string, { clause: string; cells: string[] }[]>(changed.map((f) => [f, []]));
  for (const cells of table?.rows ?? []) {
    let clause = cells[0] ?? '';
    let file: string | null = changed[0];
    if (multi) {
      const m = clause.match(/^`?([\w./-]+\.(?:md|markdown))`?\s+(.*)$/);
      file = m ? `${A}/${m[1].replace(new RegExp(`^${esc(A)}/`), '')}` : null;
      if (!file || !rowsByFile.has(file)) {
        fail(`Change-table row "${clause}": this PR changes more than one agreement, so each row's Clause must start with the file's path under ${A}/ (for example "${rel(changed[0])} 2.2").`);
        continue;
      }
      clause = m![2];
    }
    rowsByFile.get(file)?.push({ clause, cells });
  }

  // Commits in the PR, with their trailers.
  const commits = git.commits(mergeBase, headSha).map((sha) => {
    const meta = git.commitMeta(sha);
    return { ...meta, trailers: parseTrailers(meta.body) };
  });

  // Verify results: CI never trusts the PR's own file. Locally (audit), your repo's file is used.
  let verifications: VerificationEntry[] = [];
  try {
    const raw = git.show(audit ? headSha : baseTip, '.parley/verifications.json');
    verifications = raw ? (JSON.parse(raw).entries ?? []) : [];
  } catch {
    say('.parley/verifications.json is not valid JSON; ignoring it.');
  }
  const verifyKey = env.OPENROUTER_API_KEY;
  const runVerify = !audit && opts.verify !== false && Boolean(verifyKey);
  const pool = runVerify
    ? git
        .lsTree(baseTip, R)
        .filter((f) => f.endsWith('.md') && !recordAddedByAgent(git, config, baseTip, f))
        .flatMap((f) => parseRecord(f, git.show(baseTip, f)).utterances.map((u) => ({ ...u, file: f })))
    : [];

  const authorCol = table ? colIndex(table.header, 'author') : -1;
  const sourceCol = table ? colIndex(table.header, 'source') : -1;

  // Approvals of agent-written changes. In a PR: comments on this PR by a login of a party other
  // than the PR author's, posted after the latest push, never edited. In an audit of history:
  // Parley-Approved trailers on commits by a person of a party other than the agent's.
  const approvalSources: { items: ApprovalItem[]; by: string; party: Party | null }[] = [];
  if (!audit && canVerify) {
    for (const p of otherParties) for (const c of commentsFrom(p.logins, () => true, true)) approvalSources.push({ items: parseApprovals(c.body), by: c.user.login, party: p });
  } else if (audit) {
    for (const c of commits) {
      const person = partyOfPerson(config.parties, c.author);
      if (!person) continue;
      const items = c.body
        .split('\n')
        .map((l) => l.match(/^Parley-Approved(-Contradicted)?:\s*(.+)$/i))
        .filter(Boolean)
        .flatMap((m) => parseApprovals(`${m![1] ? 'approve-contradicted' : 'approve'} ${m![2]}`));
      if (items.length) approvalSources.push({ items, by: c.author, party: person });
    }
  }
  const approverFor = (file: string, id: string, hash: string, contradicted: boolean, changeAuthor: string): string | null => {
    const agentParty = partyOfAgent(config.parties, changeAuthor);
    for (const src of approvalSources) {
      if (audit && agentParty && src.party?.id === agentParty.id) continue; // an agent's own side cannot clear it in history
      if (approves(src.items, file, id, hash, contradicted)) return src.by;
    }
    return null;
  };
  const approverNames = (changeAuthor: string) => {
    if (audit) {
      const ap = partyOfAgent(config.parties, changeAuthor);
      return config.parties.filter((p) => p.id !== ap?.id).map((p) => p.name).join(' or ') || 'the other party';
    }
    return otherParties.map((p) => p.name).join(' or ') || 'the other party';
  };
  const needApproval: { file: string; id: string; hash: string; contradicted: boolean }[] = [];

  for (const file of changed) {
    const headText = git.show(headSha, file);
    if (frontMatterState(headText) === 'open') {
      fail(`${file}: the front matter opens with "---" on the first line but is never closed. Close it with a "---" line, or remove the opening line.`);
    }
    const touched = touchedClauses(git, mergeBase, headSha, file, config.frontMatterStatus);
    say(`\n${file}: clauses touched: ${[...touched].sort(natural).join(', ') || 'none'}`);

    // Trailer provenance per clause, from the commits that touched it.
    const trailerProv = new Map<string, { prov: Provenance; commit: string }[]>();
    for (const c of commits) {
      if (!c.parent) continue;
      if (!git.changedFiles(c.parent, c.sha).includes(file)) continue;
      for (const id of touchedClauses(git, c.parent, c.sha, file, config.frontMatterStatus)) {
        const p = trailerProvenance(c.trailers, id);
        if (!p) continue;
        if (!trailerProv.has(id)) trailerProv.set(id, []);
        trailerProv.get(id)!.push({ prov: p, commit: c.sha });
      }
    }

    if (!audit) {
      const isCovered = coverage(rowsByFile.get(file)!.map((r) => r.clause));
      const missing = [...touched].filter((id) => !isCovered(id)).sort(natural);
      if (missing.length) fail(`Undisclosed changes in ${file}. These clauses changed but have no row in the PR change table:\n  ${missing.join('\n  ')}\nAdd a row for each, or revert the change.`);
    } else {
      const missing = [...touched].filter((id) => !trailerProv.has(id)).sort(natural);
      if (missing.length && config.provenance.required) fail(`Undisclosed changes in ${file}. These clauses changed but no commit declares who changed them (Parley-Author or Parley-Change trailers):\n  ${missing.join('\n  ')}`);
    }

    // Material terms are discussed live first.
    if (!audit && /^(not yet|no|none|tbd|-)?$/i.test(discussedValue.split(/[;.]/)[0].trim())) {
      const material = [...touched].filter((id) => {
        const t = `${clauseTextById(headText, id)}\n${clauseTextById(git.show(mergeBase, file), id)}`.toLowerCase();
        return config.materialTerms.some((term) => t.includes(term.toLowerCase()));
      });
      if (material.length) fail(`${file}: clauses ${material.join(', ')} touch a material term (${config.materialTerms.join(', ')}). Discuss them live and record it on the "Discussed live:" line before merge.`);
    }

    // ---- Provenance ----
    if (!config.provenance.required) continue;
    for (const id of [...touched].sort(natural)) {
      const provs: { prov: Provenance; commit?: string }[] = [];
      const row = rowsByFile.get(file)?.find((r) => labelCovers(r.clause, id));
      const tableProv: Provenance | null =
        row && authorCol >= 0 && stripMarkup(row.cells[authorCol] ?? '') ? { author: stripMarkup(row.cells[authorCol] ?? ''), source: (row.cells[sourceCol] ?? '').replace(/`/g, '').trim(), via: 'table' } : null;
      const trailers = trailerProv.get(id) ?? [];
      if (tableProv) provs.push({ prov: tableProv });
      provs.push(...trailers);
      const clauseText = clauseTextById(headText, id);
      const hash = clauseHash(clauseText);
      if (provs.length === 0) {
        fail(`${file} ${id}: no provenance. Add Author and Source columns to the change table, or Parley-Author / Parley-Change trailers to the commit.`);
        findings.push({ file, clause: id, author: '', source: '', status: 'unknown-author', reasons: ['no provenance declared'], hash });
        continue;
      }
      // The table and the commits must tell the same story about who wrote it.
      if (tableProv) {
        const norm = (a: string) => a.trim().toLowerCase();
        for (const t of trailers) {
          const kt = authorKind(config, t.prov.author);
          const kb = authorKind(config, tableProv.author);
          if (kt !== kb || (kt === 'agent' && norm(t.prov.author) !== norm(tableProv.author))) {
            fail(`${file} ${id}: the change table says ${tableProv.author} wrote it, but commit ${t.commit.slice(0, 7)} says ${t.prov.author}. Make them agree.`);
          }
        }
      }

      // Instruction comments ("instruct <clause>: ...") are fetched before classification.
      const instructionProblems = new Map<string, string | null>();
      for (const { prov } of provs) {
        const url = prov.source.match(/https:\/\/github\.com\/\S+#issuecomment-\d+/)?.[0];
        if (!/^instruction\b/i.test(prov.source) || !url) continue;
        const who = prov.source.replace(/^instruction\s*(by|from)?\s*:?\s*/i, '').split(/[,(]/)[0].trim();
        const logins = loginsForPerson(config.parties, who);
        const problem = await linkedComment(url, logins, (b) => instructs(b, id));
        if (problem === null) instructionProblems.set(prov.source, `unverifiable: ${who}'s instruction comment can only be checked in CI`);
        else instructionProblems.set(prov.source, problem ? `the instruction comment does not count: ${problem}` : null);
      }

      const rank = { 'unknown-author': 5, synthetic: 4, 'needs-person': 3, 'approved-synthetic': 2, 'agent-sourced': 1, human: 0 } as const;
      const classified = provs.map(({ prov, commit }) => {
        // In a PR, evidence must be merged on the base branch. In an audit, it must predate the change.
        const evidenceRef = audit && commit ? (commits.find((x) => x.sha === commit)?.parent ?? mergeBase) : baseTip;
        const c = classify(
          {
            git,
            config,
            evidenceRef,
            clause: { id, text: clauseText },
            instructionCommentProblem: (src) => (instructionProblems.has(src) ? instructionProblems.get(src)! : 'the instruction comment was not verified'),
            recordProblem: (f) => recordAddedByAgent(git, config, evidenceRef, f),
          },
          prov,
        );
        return { c, prov, commit };
      });
      // Verify: in CI, computed now on this head (stored results can only add a contradiction).
      // In an audit, the results saved in your checkout.
      const stored = verifications.filter((v) => v.file === file && v.clause === id && v.hash === hash).sort((a, b) => a.run_at.localeCompare(b.run_at)).pop() ?? null;
      let verification: VerificationEntry | null = audit ? stored : stored?.verdict === 'contradicted' ? stored : null;
      const cited = classified.find((x) => x.c.status === 'needs-person');
      if (runVerify && cited && !verification) {
        try {
          const lines = [...cited.c.cited, ...retrieve(clauseText, pool)].filter((u, i, arr) => arr.findIndex((x) => x.file === u.file && x.id === u.id) === i);
          const r = await verifyClause(config.verify.model, clauseText, lines, verifyKey!);
          verification = { file, clause: id, hash, model: config.verify.model, verdict: r.verdict, utterance_ids: r.utterance_ids, quote: r.quote, run_at: new Date().toISOString() };
        } catch (e) {
          say(`${file} ${id}: parley verify could not run (${(e as Error).message}); the change needs the other party's approval.`);
        }
      }
      let worst: { c: Classification; prov: Provenance; commit?: string } | null = null;
      for (const x of classified) {
        // A PR is judged at its head. An audit judges each change at the commit that made it, the
        // way that change's own PR was judged, so later edits do not void earlier approvals.
        const at = audit && x.commit ? clauseHash(clauseTextById(git.show(x.commit, file), id)) : hash;
        const v = at === hash ? verification : (verifications.filter((e) => e.file === file && e.clause === id && e.hash === at).pop() ?? null);
        const approvedBy = approverFor(file, id, at, false, x.prov.author);
        const approvedContradictedBy = approverFor(file, id, at, true, x.prov.author);
        const c = settle(x.c, { verification: v, approvedBy, approvedContradictedBy });
        if (!worst || rank[c.status] > rank[worst.c.status]) worst = { c, prov: x.prov, commit: x.commit };
      }
      const w = worst! as { c: Classification; prov: Provenance; commit?: string };
      const status = w.c.status;
      const reasons = w.c.reasons;
      findings.push({ file, clause: id, author: w.prov.author, source: w.prov.source, status, reasons, commit: w.commit, hash });
      const contradicted = verification?.verdict === 'contradicted';
      if (status === 'synthetic') {
        needApproval.push({ file, id, hash, contradicted });
        fail(`SYNTHETIC TERM  ${file} ${id}  by ${w.prov.author}\n  ${reasons.join('\n  ')}\n  Nobody on either side asked for this. Remove it, cite what was said, or have ${approverNames(w.prov.author)} approve it (below).`);
      } else if (status === 'needs-person') {
        needApproval.push({ file, id, hash, contradicted: false });
        fail(`NEEDS A PERSON  ${file} ${id}  by ${w.prov.author}\n  ${reasons.join('\n  ')}\n  ${runVerify ? 'parley verify did not clear it.' : 'parley verify did not run (no OPENROUTER_API_KEY), so a person has to.'} Have ${approverNames(w.prov.author)} approve it (below).`);
      } else if (status === 'unknown-author') {
        fail(`${file} ${id}: ${reasons.join('; ')}.`);
      } else {
        detail.push(`${file} ${id}: ${status}${w.c.clearedBy ? ` (cleared by ${w.c.clearedBy})` : ''} (${w.prov.author}${w.c.cited.length ? `, ${w.c.cited.map((u) => `${u.file}#${u.id}`).join(', ')}` : ''})`);
      }
    }
  }
  if (needApproval.length) {
    const plain = needApproval.filter((n) => !n.contradicted).map((n) => `${multi ? `${rel(n.file)} ` : ''}${n.id} #${n.hash}`);
    const contra = needApproval.filter((n) => n.contradicted).map((n) => `${multi ? `${rel(n.file)} ` : ''}${n.id} #${n.hash}`);
    const how = audit
      ? 'In history, record the approval as a commit by a person of the other party with the trailer'
      : 'To approve, a person of another party comments on this pull request, after the latest push, with a line of its own, nothing after it';
    fail(`\n${how}:${plain.length ? `\n  ${audit ? 'Parley-Approved: ' : 'approve '}${plain.join(', ')}` : ''}${contra.length ? `\n  ${audit ? 'Parley-Approved-Contradicted: ' : 'approve-contradicted '}${contra.join(', ')}` : ''}`);
  }
  if (!audit && changed.length && !table) fail('\nNo change table found. The PR body needs a table whose first column header is "Clause".');
  if (!audit && changed.length && !discussedValue) fail('\nMissing "Discussed live:" line. Say when the parties discussed these changes, or "Not yet".');

  // ---- NEGOTIATION.md checks ----
  if (audit) return done();
  const ANY_PARTY = anyPartyPattern(config.parties);
  const partyNames = config.parties.map((p) => p.name).join(', ');

  if (!adopted) {
    // Before adoption, issues lists still follow the basic disclosure rule: every issue row this
    // PR adds, removes or changes is named in the change table.
    for (const ip of issuesChanged) {
      const before = issuesRows(git.show(baseTip, ip)).rows;
      const after = issuesRows(git.show(headSha, ip)).rows;
      const touchedIds = [...new Set([...before.keys(), ...after.keys()])].filter((k) => (before.get(k) ?? []).join('|') !== (after.get(k) ?? []).join('|'));
      const named = (table?.rows ?? []).map((r) => r[0] ?? '');
      const missing = touchedIds.filter((k) => !named.some((n) => new RegExp(`\\b${esc(k)}\\b`).test(n)));
      if (!table) fail(`${ip} changed, but the PR body has no change table. Add a row for each issue it changes (${touchedIds.join(', ') || 'none found'}).`);
      else if (missing.length) fail(`Undisclosed changes in ${ip}. These issues changed but have no row in the change table:\n  ${missing.join('\n  ')}`);
    }
    if (!errors.length) say('\nNEGOTIATION.md is not adopted on the base branch; only the disclosure and provenance checks apply.');
    return done();
  }
  const roundValue = lineValue('Round');
  const bodyRound = /^\d+\b/.test(roundValue) ? Number(roundValue.match(/^\d+/)![0]) : NaN;

  for (const file of changed) {
    const ip = issuesPath(file);
    const atBase = git.exists(baseTip, ip);
    const atHead = git.exists(headSha, ip);
    if (atBase && !atHead) {
      fail(`\n${file}: its issues list ${ip} is deleted in this PR. Issues lists are not deleted.`);
      continue;
    }
    if (!atHead) {
      say(`\n${file}: no issues list, so only the disclosure and provenance checks apply.`);
      continue;
    }
    const problems: string[] = [];
    const known = issuesRows(git.show(headSha, ip)).rows;
    const header = table?.header ?? [];
    const [ci2, wi, ai, ii] = ['interest', 'why', 'asked for by', 'issue'].map((n) => colIndex(header, n));
    if (!table || [ci2, wi, ai, ii].some((i) => i < 0)) {
      problems.push('The change table needs Interest, Why, Asked for by and Issue columns (see the agreement PR template).');
    } else {
      const naRows: string[] = [];
      for (const { clause, cells } of rowsByFile.get(file)!) {
        const label = clause || '(blank clause)';
        const issue = stripMarkup(cells[ii] ?? '');
        const asker = cells[ai] ?? '';
        if (!cells[wi]) problems.push(`${label}: Why is empty.`);
        if (!ANY_PARTY.test(asker) || AGENTISH.test(asker)) problems.push(`${label}: "Asked for by" must name a person or party (${partyNames}), not "${asker || 'blank'}".`);
        if (/^n\/?a$/i.test(issue)) {
          naRows.push(label);
          continue;
        }
        if (!cells[ci2]) problems.push(`${label}: Interest is empty.`);
        const ids = issue.match(/[A-Z][A-Z0-9]*-\d+/g) ?? [];
        if (!ids.length) problems.push(`${label}: Issue must cite an issues-list ID, or "n/a" for renumbering and version metadata.`);
        for (const iid of ids) if (!known.has(iid)) problems.push(`${label}: issue ${iid} is not on ${ip}.`);
      }
      if (naRows.length) say(`${file}: rows marked n/a (no issue cited), for the reviewer to confirm: ${naRows.join(', ')}`);
    }
    const listRound = frontMatterNumber(git.show(headSha, ip), 'round');
    const baseRound = frontMatterNumber(git.show(baseTip, ip), 'round');
    if (!Number.isFinite(bodyRound)) problems.push('Missing "**Round:** N" line in the PR body.');
    else if (bodyRound !== listRound) problems.push(`Round ${bodyRound} in the PR body does not match round ${Number.isFinite(listRound) ? listRound : '(missing)'} in ${ip}.`);
    if (Number.isFinite(baseRound) && Number.isFinite(listRound) && listRound < baseRound) problems.push(`${ip}: round went down from ${baseRound} to ${listRound}.`);
    if (Number.isFinite(listRound) && listRound >= 3) {
      // The call note must already be merged: a note added in this PR does not count.
      const rec = discussedValue.match(new RegExp(`${esc(R)}/[\\w./-]+\\.md`));
      if (!rec || !git.exists(baseTip, rec[0])) problems.push(`Round ${listRound}: open issues go to a call after one written round each. "Discussed live" must link the call's ${R}/ note, already merged on the base branch.`);
    }
    if (problems.length) fail(`\n${file}: NEGOTIATION.md checks failed:\n  ${problems.join('\n  ')}`);
    else say(`${file}: NEGOTIATION.md checks passed.`);
  }

  // Issues-list edits.
  const isAgreed = (v?: string) => /^agreed\b/i.test(stripMarkup(v ?? ''));
  /** Row hash: the first 12 characters of the SHA-256 of the row's cells at head. */
  const rowHash = (cells: string[]) => shortHash(cells.map((c) => c.trim()).join('|'));
  /** The first party (other than the author's) that has not commented "<verb> <id> #<row hash>". Null when all have. */
  const missingVerdict = (verb: 'agree' | 'reopen', iid: string, cells: string[], others: Party[]): Party | null => {
    const h = rowHash(cells);
    if (!canVerify) return others[0] ?? null;
    for (const o of others) if (!commentsFrom(o.logins, (b) => issueVerdict(b, verb, iid, h), true).length) return o;
    return null;
  };
  for (const ip of issuesChanged) {
    const problems: string[] = [];
    if (!git.exists(headSha, ip)) {
      fail(`\n${ip} is deleted. Issues lists are not deleted.`);
      continue;
    }
    if (!authorParty) {
      fail(`\n${ip}: once NEGOTIATION.md is adopted, issues lists are changed only by a PR from a party's GitHub login (${config.parties.flatMap((p) => p.logins).join(', ')}), so it is clear whose positions are whose. PR author: "${author || 'unknown'}".`);
      continue;
    }
    const others = otherParties;
    const before = issuesRows(git.show(baseTip, ip));
    const after = issuesRows(git.show(headSha, ip));
    for (const b of after.bad) problems.push(b);
    if (before.rows.size && before.header.join('|') !== after.header.join('|')) {
      problems.push('The issues table header changed. Keep the columns as they are; propose header changes in a PR of their own.');
    }
    const h = after.header;
    const col = new Map(config.parties.map((p) => [p.id, colIndex(h, `${p.name.toLowerCase()} position`)]));
    const si = colIndex(h, 'status');
    if ([...col.values()].some((i) => i < 0) || si < 0) {
      problems.push(`The issues table needs a "<party> position" column for each party (${config.parties.map((p) => `"${p.name} position"`).join(', ')}) and a "Status" column (see ${I}/TEMPLATE.md).`);
    } else {
      for (const [iid, old] of before.rows) {
        const now = after.rows.get(iid);
        if (!now) {
          problems.push(`${iid} was deleted. Mark it "parked" instead.`);
          continue;
        }
        for (const o of others) {
          const k = col.get(o.id)!;
          if ((old[k] ?? '') !== (now[k] ?? '')) problems.push(`${iid}: the ${o.name} position was edited by ${author}. Each party edits only its own position column.`);
        }
        const changedRow = old.join('|') !== now.join('|');
        if (isAgreed(old[si]) && changedRow) {
          const missing = missingVerdict('reopen', iid, now, others);
          if (missing) problems.push(`${iid} is agreed and this PR changes it. ${missing.name} must comment on this PR, after the latest push: "reopen ${iid} #${rowHash(now)}"${canVerify ? '' : ' (verified in CI)'}.`);
        }
        if (!isAgreed(old[si]) && isAgreed(now[si])) {
          const missing = missingVerdict('agree', iid, now, others);
          if (missing) problems.push(`${iid} is being marked agreed. ${missing.name} must comment on this PR, after the latest push: "agree ${iid} #${rowHash(now)}"${canVerify ? '' : ' (verified in CI)'}.`);
        }
      }
      for (const [iid, now] of after.rows) {
        if (before.rows.has(iid)) continue;
        for (const o of others) {
          const v = (now[col.get(o.id)!] ?? '').trim();
          if (v && v !== '-') problems.push(`${iid}: a new issue may state only its author's position; leave the ${o.name} position for them.`);
        }
        if (isAgreed(now[si])) {
          const missing = missingVerdict('agree', iid, now, others);
          if (missing) problems.push(`${iid} is new and already agreed. ${missing.name} must comment on this PR, after the latest push: "agree ${iid} #${rowHash(now)}"${canVerify ? '' : ' (verified in CI)'}.`);
        }
      }
    }
    if (problems.length) fail(`\n${ip}: issues-list checks failed:\n  ${problems.join('\n  ')}`);
    else say(`${ip}: issues-list checks passed.`);
  }

  return done();
}

export async function checkCommand(args: string[], audit = false): Promise<number> {
  const opt = (name: string, fallback?: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const json = args.includes('--json');
  const cwd = opt('--repo', process.cwd())!;
  const git = new Git(cwd);
  const head = opt('--head', 'HEAD')!;
  let base = opt('--base');
  if (!base) base = audit ? git.rootCommit(head) : 'origin/main';
  const bodyFile = opt('--body-file');
  const body = audit ? null : bodyFile ? readFileSync(bodyFile, 'utf8') : (process.env.PR_BODY ?? '');
  const prArg = opt('--pr') ?? process.env.PR_NUMBER;
  const pr = prArg && /^\d+$/.test(prArg) ? Number(prArg) : undefined;
  let author = opt('--author') ?? process.env.PR_AUTHOR ?? '';
  if (!audit && pr != null && !author) {
    const info = await new GitHub(process.env).pullRequest(pr);
    if (info) author = info.author;
  }
  const result = await runCheck({ cwd, base, head, body, author, pr, verify: !args.includes('--no-verify') });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    for (const l of result.log) console.log(l);
    if (args.includes('--verbose')) for (const l of result.detail) console.log(l);
    const counts = result.findings.reduce<Record<string, number>>((m, f) => ((m[f.status] = (m[f.status] ?? 0) + 1), m), {});
    if (result.findings.length) {
      console.log(`\nProvenance: ${counts.human ?? 0} by people, ${counts['agent-sourced'] ?? 0} by agents and cleared, ${counts['needs-person'] ?? 0} by agents and waiting for a person, ${counts['approved-synthetic'] ?? 0} synthetic but approved by the other party, ${counts.synthetic ?? 0} synthetic${counts['unknown-author'] ? `, ${counts['unknown-author']} with no known author` : ''}.${args.includes('--verbose') ? '' : ' (--verbose lists every clause.)'}`);
    }
    for (const e of result.errors) console.error(e);
    const synth = result.findings.filter((f) => f.status === 'synthetic');
    if (result.ok) console.log(audit ? '\nEvery change is disclosed and traced to a person or to what was said.' : '\nEvery changed clause is disclosed, and every agent change traces to a person or to what was said.');
    else console.error(`\n${result.errors.length} problem(s)${synth.length ? `, ${synth.length} synthetic term(s)` : ''}.`);
  }
  return result.ok ? 0 : 1;
}
