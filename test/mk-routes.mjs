// Writes routes.json for test/mock-github.mjs from a list of PR comments.
//   node test/mk-routes.mjs <out.json> '<json array of {id, login, body, created, updated?, pr?}>' [verdict]
// With a verdict (supported|partial|contradicted|unsupported), it also answers the OpenRouter
// chat completion that parley verify sends.
import { writeFileSync } from 'node:fs';

const [out, spec, verdict, quote, ids] = process.argv.slice(2);
const list = JSON.parse(spec || '[]');
const REPO = 'acme/deal';
const comments = list.map((c) => ({
  id: c.id,
  body: c.body,
  user: { login: c.login },
  created_at: c.created,
  updated_at: c.updated ?? c.created,
  issue_url: `https://api.github.com/repos/${REPO}/issues/${c.pr ?? 7}`,
  html_url: `https://github.com/${REPO}/pull/${c.pr ?? 7}#issuecomment-${c.id}`,
}));
const routes = {
  [`/repos/${REPO}/issues/7/comments?per_page=100&page=1`]: comments.filter((c) => c.issue_url.endsWith('/issues/7')),
  [`/repos/${REPO}/issues/7/timeline?per_page=100`]: [],
  [`/repos/${REPO}/pulls/7`]: { number: 7, body: '', user: { login: 'ana-ruiz' }, base: { ref: 'main' }, head: { sha: '0' } },
};
for (const c of comments) routes[`/repos/${REPO}/issues/comments/${c.id}`] = c;
if (verdict) {
  routes['/openrouter/chat/completions'] = {
    choices: [{ message: { content: JSON.stringify({ verdict, utterance_ids: (ids || 'u001').split(','), quote: quote ?? 'We keep the difference on the studio rate, net of our costs.', confidence: 0.9 }) } }],
    usage: { cost: 0 },
  };
}
writeFileSync(out, JSON.stringify(routes, null, 2));
