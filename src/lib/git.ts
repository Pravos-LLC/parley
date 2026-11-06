import { execFileSync } from 'node:child_process';

/** A git reader. Results are cached for the life of the instance, so make a new one per run. */
export class Git {
  private cache = new Map<string, string>();
  constructor(readonly cwd: string = process.cwd()) {}

  private memo(key: string, fn: () => string): string {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const v = fn();
    this.cache.set(key, v);
    return v;
  }

  run(...args: string[]): string {
    return this.memo(`run\0${args.join('\0')}`, () => execFileSync('git', args, { cwd: this.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  }

  /** File contents at a ref, or '' if the file does not exist there. */
  show(ref: string, file: string): string {
    return this.memo(`show\0${ref}\0${file}`, () => {
      try {
        return execFileSync('git', ['show', `${ref}:${file}`], { cwd: this.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
      } catch {
        return '';
      }
    });
  }

  exists(ref: string, file: string): boolean {
    return (
      this.memo(`exists\0${ref}\0${file}`, () => {
        try {
          execFileSync('git', ['cat-file', '-e', `${ref}:${file}`], { cwd: this.cwd, stdio: 'ignore' });
          return '1';
        } catch {
          return '0';
        }
      }) === '1'
    );
  }

  mergeBase(a: string, b: string): string {
    return this.run('merge-base', a, b).trim();
  }

  revParse(ref: string): string {
    return this.run('rev-parse', ref).trim();
  }

  changedFiles(from: string, to: string): string[] {
    return this.run('diff', '--name-only', '--no-renames', from, to).split('\n').filter(Boolean);
  }

  diffU0(from: string, to: string, file: string): string {
    return this.run('diff', '-U0', from, to, '--', file);
  }

  /** Commits in (from, to], oldest first. */
  commits(from: string | null, to: string, paths: string[] = []): string[] {
    const range = from ? `${from}..${to}` : to;
    const out = this.run('log', '--reverse', '--format=%H', range, ...(paths.length ? ['--', ...paths] : []));
    return out.split('\n').filter(Boolean);
  }

  commitMeta(sha: string): { sha: string; author: string; date: string; subject: string; body: string; parent: string | null } {
    const raw = this.run('show', '-s', '--format=%H%x00%an%x00%aI%x00%s%x00%P%x00%B', sha);
    const [h, an, ad, s, p, ...rest] = raw.split('\u0000');
    const parent = (p ?? '').trim().split(' ')[0] || null;
    return { sha: h, author: an, date: ad, subject: s, body: rest.join('\u0000'), parent };
  }

  rootCommit(ref = 'HEAD'): string {
    return this.run('rev-list', '--max-parents=0', ref).trim().split('\n')[0];
  }

  lsTree(ref: string, dir: string): string[] {
    try {
      return this.run('ls-tree', '-r', '--name-only', ref, '--', dir).split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
}
