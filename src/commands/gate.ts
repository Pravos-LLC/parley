// parley gate: decides, before any check runs, whether this event may post a parley status.
// The workflow runs it from the default branch's own checker, with the default branch's config.
//
//   parley gate --config-ref origin/main --default-branch main --base <PR base> [--commenter <login>]
//
// Prints key=value lines for $GITHUB_OUTPUT:
//   setup=true|false      the default branch has a parley.config.yaml
//   protected=true|false  the PR's base is listed in protected_branches (default: the default branch)
//   party=true|false      the commenter is a login of a party (true when there is no commenter)
import { Git } from '../lib/git.js';
import { parseConfig, partyOfLogin } from '../lib/config.js';

export function gate(opts: { cwd?: string; configRef: string; defaultBranch: string; base: string; commenter?: string }) {
  const git = new Git(opts.cwd);
  const text = git.show(opts.configRef, 'parley.config.yaml');
  if (!text) return { setup: false, protected: false, party: false };
  const config = parseConfig(text);
  const branches = config.protectedBranches.length ? config.protectedBranches : [opts.defaultBranch];
  const isProtected = branches.includes(opts.base);
  const party = opts.commenter ? Boolean(partyOfLogin(config.parties, opts.commenter)) : true;
  return { setup: true, protected: isProtected, party };
}

export function gateCommand(args: string[]): number {
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const configRef = opt('--config-ref');
  const defaultBranch = opt('--default-branch');
  const base = opt('--base');
  if (!configRef || !defaultBranch || !base) {
    console.error('Usage: parley gate --config-ref <ref> --default-branch <name> --base <branch> [--commenter <login>] [--repo .]');
    return 2;
  }
  const r = gate({ cwd: opt('--repo'), configRef, defaultBranch, base, commenter: opt('--commenter') });
  console.log(`setup=${r.setup}\nprotected=${r.protected}\nparty=${r.party}`);
  return 0;
}
