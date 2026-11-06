// parley init: scaffold the rules, templates, config and CI into a repo, and vendor the
// checker into .parley/parley.mjs so CI runs the base branch's own copy, offline.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL } from '../lib/config.js';

const here = dirname(fileURLToPath(import.meta.url));
/** templates/ sits next to dist/ in the package. */
export const templatesDir = () => [join(here, '..', 'templates'), join(here, '..', '..', 'templates')].find((d) => existsSync(d))!;

const RENAME: [RegExp, string][] = [
  [/^github\//, '.github/'],
  [/^agents\//, '.agents/'],
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export interface PartyInput {
  name: string;
  logins: string[];
  people: string[];
}

/** "Northlight Studio=ana-ruiz:Ana Ruiz,Tom Hale" → name, logins, people. */
export function parsePartyArg(v: string): PartyInput {
  const [name, rest = ''] = v.split('=');
  const [logins = '', people = ''] = rest.split(':');
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  return { name: name.trim(), logins: list(logins), people: list(people) };
}

export function renderTemplate(text: string, parties: PartyInput[], model = DEFAULT_MODEL): string {
  const yamlParties = parties
    .map((p) => {
      const id = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return [`  - id: ${id}`, `    name: ${p.name}`, `    logins: [${p.logins.join(', ')}]`, `    people: [${p.people.join(', ')}]`].join('\n');
    })
    .join('\n');
  return text
    .replace('{{PARTIES}}', yamlParties)
    .replace('{{MODEL}}', model)
    .replace('{{POSITION_COLUMNS}}', parties.map((p) => `${p.name} position`).join(' | '))
    .replace('{{POSITION_SEPARATORS}}', parties.map(() => '---|').join(''))
    .replace('{{POSITION_BLANKS}}', parties.map(() => '').join(' | '));
}

export function init(target: string, parties: PartyInput[], opts: { force?: boolean; checker?: string } = {}) {
  const src = templatesDir();
  const written: string[] = [];
  const skipped: string[] = [];
  for (const file of walk(src)) {
    let rel = relative(src, file);
    for (const [re, to] of RENAME) rel = rel.replace(re, to);
    const dest = join(target, rel);
    if (existsSync(dest) && !opts.force) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, renderTemplate(readFileSync(file, 'utf8'), parties));
    written.push(rel);
  }
  // Vendor the checker: this exact file is what CI runs from the base branch.
  const checker = opts.checker ?? [join(here, 'cli.mjs'), join(here, '..', 'dist', 'cli.mjs')].find((p) => existsSync(p));
  if (checker) {
    mkdirSync(join(target, '.parley'), { recursive: true });
    copyFileSync(checker, join(target, '.parley', 'parley.mjs'));
    written.push('.parley/parley.mjs');
  }
  return { written, skipped };
}

export function initCommand(args: string[]): number {
  const parties: PartyInput[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--party') parties.push(parsePartyArg(args[i + 1] ?? ''));
  if (parties.length === 0) {
    parties.push({ name: 'Party A', logins: ['party-a-login'], people: ['First Person'] }, { name: 'Party B', logins: ['party-b-login'], people: ['Second Person'] });
  }
  const i = args.indexOf('--repo');
  const target = i >= 0 ? args[i + 1] : process.cwd();
  const { written, skipped } = init(target, parties, { force: args.includes('--force') });
  for (const w of written) console.log(`  wrote   ${w}`);
  for (const s of skipped) console.log(`  kept    ${s} (exists; --force to overwrite)`);
  console.log(`
Next:
  1. Edit parley.config.yaml: the parties, their GitHub logins and the people who speak for them.
  2. Merge this setup in its own PR. From then on CI runs .parley/parley.mjs from the base branch.
  3. Ingest your first call:   parley ingest call.vtt --meeting kickoff --date 2026-01-15
  4. Draft the term sheet from it, citing utterances, and open the agreement PR with the template.`);
  return 0;
}
