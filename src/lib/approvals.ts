// The comment grammar people use to approve, instruct and agree. Each form is a whole line on its
// own: nothing before the verb and nothing after the last hash, so "approve 3.2 #h if you drop the
// fee" is not an approval, and a quoted line ("> approve ...") is not either.

export interface ApprovalItem {
  /** Agreement file under agreements/, when the approver named one. */
  file?: string;
  clause: string;
  hash: string;
  contradicted: boolean;
}

const ITEM = /^(?:([\w./-]+\.(?:md|markdown))\s+)?([\w.-]+)\s+#([0-9a-f]{12})$/i;

/** "approve 3.2 #h1, 4.1 #h2" and "approve-contradicted 7.2 #h3". */
export function parseApprovals(text: string): ApprovalItem[] {
  const out: ApprovalItem[] = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = raw.trim().match(/^(approve|approve-contradicted)\s+(.+)$/i);
    if (!m || /^approve\s+(record|rules)\b/i.test(raw.trim())) continue;
    const items = m[2].split(',').map((x) => x.trim());
    const parsed = items.map((x) => x.match(ITEM));
    if (!parsed.length || parsed.some((p) => !p)) continue; // one malformed item voids the line
    for (const p of parsed) out.push({ file: p![1], clause: p![2], hash: p![3].toLowerCase(), contradicted: m[1].toLowerCase() === 'approve-contradicted' });
  }
  return out;
}

/** Does this list approve the clause at this hash (in this file)? */
export function approves(items: ApprovalItem[], file: string, clause: string, hash: string, contradicted: boolean): boolean {
  return items.some(
    (i) => i.contradicted === contradicted && i.clause === clause && i.hash === hash.slice(0, 12).toLowerCase() && (!i.file || file.endsWith(`/${i.file}`) || file === i.file),
  );
}

/** "approve record 2026-10-14-kickoff.md #<sha12 of the file at head>". */
export function approvesRecord(text: string, name: string, sha12: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^approve\\s+record\\s+${esc}\\s+#${sha12}$`, 'im').test(lines(text));
}

/** "approve rules <first 12 of the head commit>". */
export function approvesRules(text: string, sha12: string): boolean {
  return new RegExp(`^approve\\s+rules\\s+${sha12}$`, 'im').test(lines(text));
}

/** "agree MOU-02 #<row hash>" or "reopen MOU-01 #<row hash>". */
export function issueVerdict(text: string, verb: 'agree' | 'reopen', id: string, hash: string): boolean {
  return new RegExp(`^${verb}\\s+${id}\\s+#${hash}$`, 'im').test(lines(text));
}

/** "instruct 3.2: make the reviews Friday afternoons". */
export function instructs(text: string, clause: string): boolean {
  const esc = clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^instruct\\s+${esc}\\s*:\\s*\\S`, 'im').test(lines(text));
}

/** Normalize line endings and trim each line, so the anchors above mean "the whole line". */
const lines = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
