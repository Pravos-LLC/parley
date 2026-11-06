import { parse } from 'yaml';

export interface Party {
  id: string;
  name: string;
  /** GitHub logins that speak for this party. */
  logins: string[];
  /** People who may ask for, author or approve changes for this party. */
  people: string[];
  /** Extra words that name this party in PR lines (for example a short name). */
  aliases: string[];
  /** A person's own GitHub login, when the config gives one (people: [{ name, login }]). */
  personLogins: Record<string, string>;
  /** Agent ids that draft for this party (agents: [northlight-drafter]). */
  agents: string[];
}

export interface ParleyConfig {
  version: number;
  parties: Party[];
  materialTerms: string[];
  paths: { agreements: string; records: string; issues: string };
  provenance: { required: boolean; agentSources: string };
  /** Allowed values for the front-matter "status" key. */
  frontMatterStatus: string[];
  /** Status values that need every party's approval to set (front_matter.terminal_status). */
  terminalStatus: string[];
  /** Base branches whose PRs get a parley/<branch> commit status (empty: the default branch). */
  protectedBranches: string[];
  verify: { model: string; minConfidence: number };
}

export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';

export const DEFAULT_MATERIAL_TERMS = [
  'liability',
  'indemnity',
  'insurance',
  'intellectual property',
  'payment',
  'exclusivity',
  'non-circumvention',
  'data protection',
  'termination',
];

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : v == null ? [] : [String(v)]);

export function parseConfig(text: string): ParleyConfig {
  const raw = (text.trim() ? parse(text) : {}) ?? {};
  const parties: Party[] = (Array.isArray(raw.parties) ? raw.parties : []).map((p: Record<string, unknown>, i: number) => {
    const name = String(p.name ?? p.id ?? `Party ${i + 1}`);
    const rawPeople = Array.isArray(p.people) ? p.people : p.people == null ? [] : [p.people];
    const people: string[] = [];
    const personLogins: Record<string, string> = {};
    for (const person of rawPeople) {
      if (person && typeof person === 'object') {
        const o = person as Record<string, unknown>;
        const n = String(o.name ?? '').trim();
        if (!n) continue;
        people.push(n);
        if (o.login) personLogins[n] = String(o.login);
      } else if (person != null) people.push(String(person));
    }
    const logins = asList(p.logins ?? p.login);
    for (const l of Object.values(personLogins)) if (!logins.some((x) => x.toLowerCase() === l.toLowerCase())) logins.push(l);
    return {
      id: String(p.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
      name,
      logins,
      people,
      aliases: asList(p.aliases),
      personLogins,
      agents: asList(p.agents).map((a) => a.replace(/^agent:/i, '')),
    };
  });
  return {
    version: Number(raw.version ?? 1),
    parties,
    materialTerms: raw.material_terms ? asList(raw.material_terms) : DEFAULT_MATERIAL_TERMS,
    paths: {
      agreements: String(raw.paths?.agreements ?? 'agreements'),
      records: String(raw.paths?.records ?? 'records'),
      issues: String(raw.paths?.issues ?? 'agreements/issues'),
    },
    provenance: { required: raw.provenance?.required !== false, agentSources: String(raw.provenance?.agent_sources ?? 'verify-or-approve') },
    frontMatterStatus: raw.front_matter?.status ? asList(raw.front_matter.status) : ['draft', 'proposed', 'agreed', 'signed', 'adopted'],
    terminalStatus: raw.front_matter?.terminal_status ? asList(raw.front_matter.terminal_status) : ['signed'],
    protectedBranches: asList(raw.protected_branches),
    verify: {
      model: String(raw.verify?.model ?? DEFAULT_MODEL),
      minConfidence: Number(raw.verify?.min_confidence ?? 0.5),
    },
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words that name a party: its id, its name, its aliases and each person's name parts. */
export function partyWords(p: Party): string[] {
  const words = new Set<string>();
  const add = (w: string) => {
    const t = w.trim().toLowerCase();
    if (t.length >= 2) words.add(t);
  };
  add(p.id);
  add(p.name);
  for (const a of p.aliases) add(a);
  for (const person of p.people) {
    add(person);
    for (const part of person.split(/\s+/)) add(part);
  }
  // The first word of a multi-word party name ("Northlight" for "Northlight Studio").
  const first = p.name.split(/\s+/)[0];
  if (first && first.length >= 3) add(first);
  return [...words];
}

export function partyPattern(p: Party): RegExp {
  const words = partyWords(p).map(escapeRe).sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${words.join('|') || '(?!)'})\\b`, 'i');
}

export function anyPartyPattern(parties: Party[]): RegExp {
  const words = parties.flatMap(partyWords).map(escapeRe).sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${words.join('|') || '(?!)'})\\b`, 'i');
}

export const AGENTISH = /\b(agents?|agent:[\w.-]+|claude|codex|gpt|opencode|copilot|cursor|gemini|bots?|llm|ai)\b/i;

/** Which party a person's name belongs to, matched on full name or a unique name part. */
export function partyOfPerson(parties: Party[], name: string): Party | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  for (const p of parties) if (p.people.some((x) => x.toLowerCase() === n)) return p;
  const hits = parties.filter((p) => p.people.some((x) => x.toLowerCase().split(/\s+/).includes(n)));
  return hits.length === 1 ? hits[0] : null;
}

export function partyOfLogin(parties: Party[], login: string): Party | null {
  return parties.find((p) => p.logins.some((l) => l.toLowerCase() === login.toLowerCase())) ?? null;
}

/** Logins that speak for a person: their own login if configured, otherwise their party's. */
export function loginsForPerson(parties: Party[], name: string): string[] {
  const party = partyOfPerson(parties, name);
  if (!party) return [];
  const full = party.people.find((x) => x.toLowerCase() === name.trim().toLowerCase()) ?? party.people.find((x) => x.toLowerCase().split(/\s+/).includes(name.trim().toLowerCase()));
  const own = full ? party.personLogins[full] : undefined;
  return own ? [own] : party.logins;
}

/** Is this path an agreement text (checked clause by clause)? Issues lists, call sheets, READMEs and templates are not. */
export function isAgreementFile(config: ParleyConfig, file: string): boolean {
  const A = config.paths.agreements.replace(/\/$/, '');
  const I = config.paths.issues.replace(/\/$/, '');
  if (!file.startsWith(`${A}/`)) return false;
  if (!/\.(md|markdown)$/i.test(file)) return false;
  if (/(^|\/)(README|TEMPLATE)\.(md|markdown)$/i.test(file)) return false;
  if (file.startsWith(`${I}/`) || file.startsWith(`${A}/call-sheets/`)) return false;
  return true;
}

export function isIssuesList(config: ParleyConfig, file: string): boolean {
  const I = config.paths.issues.replace(/\/$/, '');
  return file.startsWith(`${I}/`) && /\.md$/i.test(file) && !/(^|\/)(README|TEMPLATE)\.md$/i.test(file);
}

/** The party an agent drafts for, if the config says. */
export function partyOfAgent(parties: Party[], author: string): Party | null {
  const id = author.trim().replace(/^agent:/i, '').toLowerCase();
  return parties.find((p) => p.agents.some((a) => a.toLowerCase() === id)) ?? null;
}
