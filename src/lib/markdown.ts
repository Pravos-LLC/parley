import { createHash } from 'node:crypto';

export function splitRow(row: string): string[] {
  const t = row.trim().replace(/\\\|/g, '\u0000');
  let cells = t.split('|').slice(1);
  if (t.endsWith('|')) cells = cells.slice(0, -1);
  return cells.map((c) => c.replace(/\u0000/g, '|').trim());
}

export const isSeparator = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
export const stripMarkup = (s: string) => s.replace(/[`*_]/g, '').trim();

export interface Table {
  header: string[];
  rows: string[][];
}

/** The first table whose first header cell matches, stopping at the first non-table line. */
export function parseTable(text: string, firstHeader: RegExp): Table | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const head = splitRow(lines[i]);
    if (!firstHeader.test(stripMarkup(head[0] ?? ''))) continue;
    const rows: string[][] = [];
    for (let j = i + 1; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const cells = splitRow(lines[j]);
      if (isSeparator(cells) || cells.every((c) => !c)) continue;
      rows.push(cells);
    }
    return { header: head.map((h) => stripMarkup(h).toLowerCase()), rows };
  }
  return null;
}

export const colIndex = (header: string[], name: string) => header.findIndex((h) => h.startsWith(name));

export function frontMatter(text: string): Record<string, string> {
  const fm = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  const out: Record<string, string> = {};
  if (!fm) return out;
  for (const line of fm[1].split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

export function frontMatterNumber(text: string, key: string): number {
  const v = frontMatter(text)[key];
  return v != null && /^\d+/.test(v) ? Number(v.match(/^\d+/)![0]) : NaN;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const shortHash = (s: string) => sha256(s).slice(0, 12);

export const wordCount = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;
