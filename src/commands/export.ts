// parley export --agent-trace: the ledger as Agent Trace-shaped JSON (agent-trace.dev, v0.1 RFC),
// so other tools can read who wrote which lines of an agreement and what conversation backs them.

import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { buildLedger } from '../lib/ledger.js';
import { clauseMap } from '../lib/clauses.js';
import { Git } from '../lib/git.js';
import { agentId, authorKind } from '../lib/provenance.js';
import { VERSION } from '../version.js';

export function agentTrace(repo: string) {
  const ledger = buildLedger(repo);
  const git = new Git(repo);
  return {
    version: '0.1.0',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    vcs: { type: 'git', revision: ledger.head },
    tool: { name: 'parley', version: VERSION },
    files: ledger.agreements.map((a) => {
      const map = clauseMap(git.show(ledger.head, a.file));
      const rangeOf = (id: string) => {
        const first = map.indexOf(id);
        const last = map.lastIndexOf(id);
        return first < 0 ? null : { start_line: first + 1, end_line: last + 1 };
      };
      return {
        path: a.file,
        conversations: a.clauses.map((c) => {
          const kind = authorKind(ledger.config, c.author);
          const range = rangeOf(c.id);
          return {
            contributor: {
              type: kind === 'agent' ? 'ai' : kind === 'human' ? 'human' : 'unknown',
              ...(kind === 'agent' ? { agent_id: agentId(c.author) } : { name: c.author }),
            },
            ranges: range ? [{ ...range, content_hash: c.hash }] : [],
            url: c.cited[0] ? `${c.cited[0].file}#${c.cited[0].id}` : undefined,
            related: c.cited.slice(1).map((u) => ({ type: 'record', url: `${u.file}#${u.id}` })),
            metadata: { clause: c.id, parley_status: c.status, source: c.source, reasons: c.reasons },
          };
        }),
      };
    }),
  };
}

export function exportCommand(args: string[]): number {
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (!args.includes('--agent-trace')) {
    console.error('Usage: parley export --agent-trace [--out trace.json] [--repo .]');
    return 2;
  }
  const out = JSON.stringify(agentTrace(opt('--repo') ?? process.cwd()), null, 2) + '\n';
  const file = opt('--out');
  if (file) writeFileSync(file, out);
  else process.stdout.write(out);
  return 0;
}
