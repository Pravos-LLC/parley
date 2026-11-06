import { frontMatter, shortHash } from './markdown.js';

export interface Utterance {
  id: string;
  speaker: string;
  startMs: number;
  endMs: number | null;
  text: string;
  hash: string;
}

export interface MeetingRecord {
  file: string;
  meeting: string;
  title: string;
  date: string;
  source: string;
  participants: string[];
  utterances: Utterance[];
}

const UTTERANCE = /^\*\*(u\d{3,})\*\*\s+\[(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)(?:\s*[–-]\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?))?\]\s+\*\*(.+?):\*\*\s+(.*)$/;

export function parseTime(t: string): number {
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return NaN;
  const [, h, mm, ss, frac] = m;
  return ((Number(h ?? 0) * 60 + Number(mm)) * 60 + Number(ss)) * 1000 + Number((frac ?? '0').padEnd(3, '0'));
}

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function parseRecord(file: string, text: string): MeetingRecord {
  const fm = frontMatter(text);
  const utterances: Utterance[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = line.match(UTTERANCE);
    if (!m) continue;
    const [, id, start, end, speaker, body] = m;
    utterances.push({ id, speaker: speaker.trim(), startMs: parseTime(start), endMs: end ? parseTime(end) : null, text: body.trim(), hash: shortHash(`${speaker.trim()}|${body.trim()}`) });
  }
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fm.meeting ?? file;
  return {
    file,
    meeting: fm.meeting ?? '',
    title,
    date: fm.date ?? '',
    source: fm.source ?? '',
    participants: (fm.participants ?? '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean),
    utterances,
  };
}

export function formatRecord(r: Omit<MeetingRecord, 'file'> & { mediaHash?: string; note?: string }): string {
  const lines = [
    '---',
    'type: record',
    `meeting: ${r.meeting}`,
    `date: ${r.date}`,
    `source: ${r.source}`,
    `participants: [${r.participants.join(', ')}]`,
    ...(r.mediaHash ? [`source_sha256: ${r.mediaHash}`] : []),
    `utterances: ${r.utterances.length}`,
    '---',
    '',
    `# ${r.title}`,
    '',
    r.note ?? 'Machine transcript. This file is the record of what was said; it is never edited after it is merged. Cite an utterance as `records/<this file>#u012`.',
    '',
    ...r.utterances.map((u) => `**${u.id}** [${formatTime(u.startMs)}${u.endMs != null ? `–${formatTime(u.endMs)}` : ''}] **${u.speaker}:** ${u.text.replace(/\s+/g, ' ')}`),
    '',
  ];
  return lines.join('\n');
}

/** A Source reference like records/2026-10-14-kickoff.md#u012 (optionally several, comma separated). */
export const RECORD_REF = /\b(records\/[\w./-]+\.md)#(u\d{3,})\b/g;

export function recordRefs(source: string): { file: string; utterance: string }[] {
  return [...source.matchAll(RECORD_REF)].map((m) => ({ file: m[1], utterance: m[2] }));
}
