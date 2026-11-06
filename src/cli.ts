import { checkCommand } from './commands/check.js';
import { ingestCommand } from './commands/ingest.js';
import { verifyCommand } from './commands/verify.js';
import { uiCommand } from './commands/ui.js';
import { initCommand } from './commands/init.js';
import { exportCommand } from './commands/export.js';
import { gateCommand } from './commands/gate.js';
import { VERSION } from './version.js';

const HELP = `parley ${VERSION}: the meeting is the record; every clause says who wrote it.

Usage:
  parley init [--party "Name=login1,login2:Person One,Person Two"]...   scaffold rules, templates, config and CI
  parley ingest <transcript> --meeting <slug> [--date YYYY-MM-DD] [--map "Speaker 1=Ana Ruiz"]
                                                       add a meeting to records/ (VTT, WhisperX, Fireflies, plain)
  parley check --base origin/main [--head HEAD] --body-file pr.md [--author <login>]
                                                       check a PR: disclosure, provenance, synthetic terms (CI)
  parley audit [--base <ref>] [--head HEAD]            check history from commit trailers alone (no PR)
  parley verify [--model <openrouter id>]              ask an open-weight model whether the transcript supports
                                                       each agent-written clause (needs OPENROUTER_API_KEY)
  parley ui [--port 4317]                              open the ledger: provenance rail, transcript, word counts
  parley export --agent-trace [--out trace.json]       Agent Trace-shaped JSON of who wrote what
  parley gate --config-ref <ref> --default-branch <b> --base <b> [--commenter <login>]
                                                       (CI) may this event post a parley/<base> status?

All commands take --repo <path> (default: current directory).
`;

const [cmd, ...args] = process.argv.slice(2);
const run = async (): Promise<number> => {
  switch (cmd) {
    case 'check':
      return checkCommand(args, false);
    case 'audit':
      return checkCommand(args, true);
    case 'ingest':
      return ingestCommand(args);
    case 'verify':
      return verifyCommand(args);
    case 'ui':
      return uiCommand(args);
    case 'init':
      return initCommand(args);
    case 'export':
      return exportCommand(args);
    case 'gate':
      return gateCommand(args);
    case '--version':
    case '-v':
      console.log(VERSION);
      return 0;
    default:
      console.log(HELP);
      return cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h' ? 2 : 0;
  }
};
run().then(
  (code) => {
    if (cmd !== 'ui') process.exit(code);
  },
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
