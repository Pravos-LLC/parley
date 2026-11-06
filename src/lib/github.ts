// Reading pull request comments from the GitHub API, for approvals and instructions.
// Every approval parley accepts is a comment on the pull request itself, by the right login,
// never edited, and (for approvals) written after the latest push.

export interface GhComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  issue_url: string;
  html_url?: string;
}

export interface PullRequestInfo {
  number: number;
  body: string;
  author: string;
  baseRef: string;
  headSha: string;
}

export class GitHub {
  readonly token: string;
  readonly repo: string;
  readonly api: string;
  /** Running inside GitHub Actions: anything that cannot be verified fails. */
  readonly ci: boolean;
  private cache = new Map<string, unknown>();

  constructor(env: NodeJS.ProcessEnv) {
    this.token = env.GITHUB_TOKEN ?? '';
    this.repo = env.GITHUB_REPOSITORY ?? '';
    this.api = (env.PARLEY_GITHUB_API ?? 'https://api.github.com').replace(/\/$/, '');
    this.ci = Boolean(env.GITHUB_ACTIONS);
  }

  get available(): boolean {
    return Boolean(this.token && this.repo);
  }

  async get<T>(path: string, accept = 'application/vnd.github+json'): Promise<T | null> {
    if (!this.available) return null;
    if (this.cache.has(path)) return this.cache.get(path) as T;
    const res = await fetch(`${this.api}${path}`, { headers: { Authorization: `Bearer ${this.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' } });
    const value = res.ok ? ((await res.json()) as T) : null;
    this.cache.set(path, value);
    return value;
  }

  async pullRequest(n: number): Promise<PullRequestInfo | null> {
    const pr = await this.get<{ number: number; body: string | null; user: { login: string }; base: { ref: string }; head: { sha: string } }>(`/repos/${this.repo}/pulls/${n}`);
    if (!pr) return null;
    return { number: pr.number, body: pr.body ?? '', author: pr.user.login, baseRef: pr.base.ref, headSha: pr.head.sha };
  }

  async comments(n: number): Promise<GhComment[]> {
    const out: GhComment[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.get<GhComment[]>(`/repos/${this.repo}/issues/${n}/comments?per_page=100&page=${page}`);
      if (!batch || !batch.length) break;
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }

  async comment(id: string): Promise<GhComment | null> {
    return this.get<GhComment>(`/repos/${this.repo}/issues/comments/${id}`);
  }

  /** Times the PR head was force-pushed, from the issue timeline. */
  async forcePushTimes(n: number): Promise<string[]> {
    const events = await this.get<{ event: string; created_at?: string }[]>(`/repos/${this.repo}/issues/${n}/timeline?per_page=100`);
    return (events ?? []).filter((e) => e.event === 'head_ref_force_pushed' && e.created_at).map((e) => e.created_at!);
  }
}

export interface CommentRules {
  pr: number;
  /** Logins allowed to write it (lowercase compare). */
  logins: string[];
  /** If set, the comment must be created after this time. */
  after?: string;
}

/** Why a comment does not count, or null if it does. */
export function commentProblem(c: GhComment, rules: CommentRules): string | null {
  if (!new RegExp(`/issues/${rules.pr}$`).test(c.issue_url)) return 'it is not on this pull request';
  if (!rules.logins.some((l) => l.toLowerCase() === c.user.login.toLowerCase())) return `it was written by ${c.user.login}, not ${rules.logins.join(' or ') || '(no login configured)'}`;
  if (c.created_at !== c.updated_at) return 'it was edited after it was posted';
  if (rules.after && !(Date.parse(c.created_at) > Date.parse(rules.after))) return 'it was posted before the latest push';
  return null;
}
