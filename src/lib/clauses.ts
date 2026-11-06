import type { Git } from './git.js';
import { shortHash, wordCount } from './markdown.js';

export const MARKER = /^\*\*(\d+(?:\.\d+)*)\*\*/;
export const HEADING = /^##\s+(\d+)\./;

/** Front matter is a closed block: "---" on the first line and a closing "---" (or "...") later. */
export type FrontMatterState = 'none' | 'closed' | 'open';
export function frontMatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---' || lines[i].trim() === '...') return i;
  return -1;
}
export function frontMatterState(text: string): FrontMatterState {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return 'none';
  return frontMatterEnd(lines) > 0 ? 'closed' : 'open';
}

export const DEFAULT_STATUSES = ['draft', 'proposed', 'agreed', 'signed', 'adopted'];

/**
 * A front-matter line that may change without a row: exactly "version: 2" (or 1.2.3), "date:
 * 2026-10-14" (a real date) or "status: <one of the configured values>", with nothing else on
 * the line. Anything more is a change to the front matter that needs a row.
 */
export function allowlistedFrontMatterLine(line: string, statuses: string[] = DEFAULT_STATUSES): boolean {
  const l = line.replace(/\s+$/, '');
  if (/^version: \d+(\.\d+)*$/.test(l)) return true;
  const d = l.match(/^date: (\d{4}-\d{2}-\d{2})$/);
  if (d) return !Number.isNaN(Date.parse(`${d[1]}T00:00:00Z`)) && new Date(`${d[1]}T00:00:00Z`).toISOString().startsWith(d[1]);
  const st = l.match(/^status: ([A-Za-z][\w-]*)$/);
  return Boolean(st && statuses.includes(st[1]));
}

const TABLE_ROW_ID = /^\|\s*\**(\d+(?:\.\d+)*)\**\s*\|/;

/**
 * Line index (0-based) to clause id: the nearest preceding **N.N** marker or "## N." heading.
 * Lines of a closed front-matter block map to "front-matter". An unclosed block is not front
 * matter at all. In documents with no **N.N** markers (term sheets), a table row whose first
 * cell is a number is that clause.
 */
export function clauseMap(text: string): string[] {
  const lines = text.split('\n');
  const fmEnd = frontMatterEnd(lines);
  const hasMarkers = lines.some((l) => MARKER.test(l));
  const map: string[] = [];
  let current = 'preamble';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (i <= fmEnd) {
      map.push('front-matter');
      continue;
    }
    const m = l.match(MARKER) || l.match(HEADING);
    if (m) current = m[1];
    else if (/^\*\*Signed for/i.test(l) || /^Signature/i.test(l) || /^##\s+Signatures/i.test(l)) current = 'signatures';
    const row = !hasMarkers ? l.match(TABLE_ROW_ID) : null;
    map.push(row ? row[1] : current);
  }
  return map;
}

export interface ClauseText {
  id: string;
  /** The heading or marker line plus the clause's sentences, as written. */
  text: string;
  /** Section title for "## N. Title" headings. */
  title?: string;
  words: number;
  hash: string;
}

/** Clauses in document order, with their text and a hash of that text. */
export function clauseTexts(text: string): ClauseText[] {
  const lines = text.split('\n');
  const map = clauseMap(text);
  const order: string[] = [];
  const byId = new Map<string, string[]>();
  const titles = new Map<string, string>();
  lines.forEach((l, i) => {
    const id = map[i];
    if (id === 'front-matter') return;
    if (!byId.has(id)) {
      byId.set(id, []);
      order.push(id);
    }
    const h = l.match(/^##\s+(\d+)\.\s*(.*)$/);
    if (h) titles.set(id, h[2].trim());
    byId.get(id)!.push(l);
  });
  return order.map((id) => {
    const body = byId.get(id)!.join('\n').trim();
    return { id, text: body, title: titles.get(id), words: wordCount(body.replace(/^\*\*[\d.]+\*\*\s*/gm, '').replace(/^#+\s.*$/gm, '')), hash: clauseHash(body) };
  }).filter((c) => c.text.length > 0);
}

/** Whitespace-insensitive hash of a clause's text. */
export const clauseHash = (text: string) => shortHash(text.replace(/\s+/g, ' ').trim());

export function clauseTextById(text: string, id: string): string {
  if (id === 'front-matter') {
    const lines = text.split('\n');
    const end = frontMatterEnd(lines);
    return end > 0 ? lines.slice(0, end + 1).join('\n') : '';
  }
  return clauseTexts(text).find((c) => c.id === id)?.text ?? '';
}

/**
 * Clause ids touched between two refs for one file. Whitespace-only lines do not count.
 * Any change inside front matter, or to its fences, touches the pseudo-clause "front-matter",
 * except a line that only sets an allowlisted key (version, date, status).
 */
export function touchedClauses(git: Git, from: string, to: string, file: string, statuses: string[] = DEFAULT_STATUSES): Set<string> {
  const oldMap = clauseMap(git.show(from, file));
  const newMap = clauseMap(git.show(to, file));
  const diff = git.diffU0(from, to, file);
  const touched = new Set<string>();
  const add = (id: string | undefined, content: string) => {
    const clause = id ?? 'end';
    if (clause === 'front-matter' && allowlistedFrontMatterLine(content, statuses)) return;
    touched.add(clause);
  };
  let oLine = 0;
  let nLine = 0;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) {
      oLine = Number(h[1]);
      nLine = Number(h[2]);
      inHunk = true;
      continue;
    }
    // File headers ("--- a/x", "+++ b/x") only come before the first hunk. Inside a hunk, a
    // removed "---" fence is the line "----" and must count.
    if (!inHunk || line.startsWith('\\')) continue;
    if (line.startsWith('-')) {
      if (line.slice(1).trim()) add(oldMap[oLine - 1], line.slice(1));
      oLine++;
    } else if (line.startsWith('+')) {
      if (line.slice(1).trim()) add(newMap[nLine - 1], line.slice(1));
      nLine++;
    }
  }
  return touched;
}

/** Clause labels that a change-table "Clause" cell covers: single ids, ranges and whole sections. */
export function coverage(labels: string[]) {
  const covered = new Set<string>();
  const lower: string[] = [];
  for (const clause of labels) {
    if (!clause) continue;
    lower.push(clause.toLowerCase());
    for (const r of clause.matchAll(/(\d+)\.(\d+)\s*(?:to|–|-)\s*(?:(\d+)\.)?(\d+)/g)) {
      for (let k = Number(r[2]); k <= Number(r[4]); k++) covered.add(`${r[1]}.${k}`);
    }
    for (const t of clause.matchAll(/\d+(?:\.\d+)*/g)) covered.add(t[0]);
  }
  return (id: string): boolean => {
    if (covered.has(id)) return true;
    const parts = id.split('.');
    for (let k = parts.length - 1; k > 0; k--) if (covered.has(parts.slice(0, k).join('.'))) return true;
    if (!/^\d/.test(id)) {
      return lower.some(
        (l) =>
          l.includes(id) ||
          (id === 'preamble' && /title|preamble|header|parties/.test(l)) ||
          (id === 'front-matter' && /front.?matter|metadata/.test(l)) ||
          (id === 'end' && /signature|end/.test(l)),
      );
    }
    return false;
  };
}

/** Does a change-table label cover exactly this clause id (for per-clause provenance lookup)? */
export function labelCovers(label: string, id: string): boolean {
  return coverage([label])(id);
}
