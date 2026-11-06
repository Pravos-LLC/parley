// parley ingest: turn a meeting transcript into records/<date>-<slug>.md, the conversation of record.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { formatRecord, parseTime, type Utterance } from '../lib/records.js';
import { parseConfig } from '../lib/config.js';
import { sha256, shortHash } from '../lib/markdown.js';

interface RawUtterance {
  speaker: string;
  startMs: number;
  endMs: number | null;
  text: string;
}

export type TranscriptFormat = 'vtt' | 'whisperx' | 'fireflies' | 'plain';

export function detectFormat(file: string, text: string): TranscriptFormat {
  if (/^WEBVTT/.test(text.trimStart()) || file.endsWith('.vtt')) return 'vtt';
  const t = text.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t);
      if (Array.isArray(j?.segments)) return 'whisperx';
      if (Array.isArray(j?.sentences) || Array.isArray(j?.data?.transcript?.sentences) || (Array.isArray(j) && j[0]?.speaker_name !== undefined)) return 'fireflies';
    } catch {
      /* fall through */
    }
  }
  return 'plain';
}

function parseVtt(text: string): RawUtterance[] {
  const out: RawUtterance[] = [];
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->').map((s) => s.trim().split(/\s+/)[0]);
    let body = lines.slice(ti + 1).join(' ');
    let speaker = '';
    const v = body.match(/^<v\s+([^>]+)>([\s\S]*?)(<\/v>)?$/);
    if (v) {
      speaker = v[1].trim();
      body = v[2];
    } else {
      const s = body.match(/^([^:]{1,60}):\s+(.*)$/);
      if (s) {
        speaker = s[1].trim();
        body = s[2];
      }
    }
    body = body.replace(/<[^>]+>/g, '').trim();
    if (!body) continue;
    out.push({ speaker: speaker || 'Unknown', startMs: parseTime(a), endMs: parseTime(b), text: body });
  }
  return out;
}

function parseWhisperX(text: string): RawUtterance[] {
  const j = JSON.parse(text);
  return (j.segments as { start: number; end: number; text: string; speaker?: string }[]).map((s) => ({
    speaker: s.speaker ?? 'Unknown',
    startMs: Math.round(s.start * 1000),
    endMs: Math.round(s.end * 1000),
    text: String(s.text ?? '').trim(),
  }));
}

function parseFireflies(text: string): RawUtterance[] {
  const j = JSON.parse(text);
  const sentences = (Array.isArray(j) ? j : (j.sentences ?? j.data?.transcript?.sentences)) as {
    speaker_name?: string;
    speaker_id?: string | number;
    start_time?: number;
    end_time?: number;
    text?: string;
    raw_text?: string;
  }[];
  return sentences.map((s) => ({
    speaker: s.speaker_name ?? (s.speaker_id != null ? `Speaker ${s.speaker_id}` : 'Unknown'),
    // Fireflies reports seconds.
    startMs: Math.round(Number(s.start_time ?? 0) * 1000),
    endMs: s.end_time != null ? Math.round(Number(s.end_time) * 1000) : null,
    text: String(s.text ?? s.raw_text ?? '').trim(),
  }));
}

function parsePlain(text: string): RawUtterance[] {
  const out: RawUtterance[] = [];
  let clock = 0;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = line.match(/^\s*(?:\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\]?\s+)?([^:\[\]]{1,60}):\s+(.+)$/);
    if (!m) {
      if (line.trim() && out.length) out[out.length - 1].text += ` ${line.trim()}`;
      continue;
    }
    const t = m[1] ? parseTime(m[1].split(':').length === 2 ? `00:${m[1]}` : m[1]) : clock;
    clock = t + 5000;
    out.push({ speaker: m[2].trim(), startMs: t, endMs: null, text: m[3].trim() });
  }
  return out;
}

export function parseTranscript(file: string, text: string, format?: TranscriptFormat): RawUtterance[] {
  const f = format ?? detectFormat(file, text);
  const raw = f === 'vtt' ? parseVtt(text) : f === 'whisperx' ? parseWhisperX(text) : f === 'fireflies' ? parseFireflies(text) : parsePlain(text);
  // Merge consecutive cues from the same speaker (Zoom splits sentences across cues).
  const merged: RawUtterance[] = [];
  for (const u of raw.filter((x) => x.text)) {
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker === u.speaker && u.startMs - (prev.endMs ?? prev.startMs) < 1500) {
      prev.text = `${prev.text} ${u.text}`;
      prev.endMs = u.endMs ?? prev.endMs;
    } else merged.push({ ...u });
  }
  return merged;
}

/** Speaker names go into "**Name:**" lines, so they are one line of plain text: no control characters or markup. */
export function cleanSpeaker(name: string): string {
  const s = name.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/[*\[\]`|:]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s || 'Unknown';
}

export function toUtterances(raw: RawUtterance[], map: Map<string, string>): Utterance[] {
  return raw.map((u, i) => {
    const speaker = cleanSpeaker(map.get(u.speaker) ?? u.speaker);
    const text = u.text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { id: `u${String(i + 1).padStart(3, '0')}`, speaker, startMs: u.startMs, endMs: u.endMs, text, hash: shortHash(`${speaker}|${text}`) };
  });
}

export async function ingestCommand(args: string[]): Promise<number> {
  const valued = new Set(['--meeting', '--date', '--title', '--map', '--format', '--repo']);
  const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && valued.has(args[i - 1])));
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (!file) {
    console.error('Usage: parley ingest <transcript> --meeting <slug> [--date YYYY-MM-DD] [--title "..."] [--map "Speaker 1=Ana Ruiz"] [--format vtt|whisperx|fireflies|plain] [--repo .]');
    return 2;
  }
  const repo = opt('--repo') ?? process.cwd();
  const text = readFileSync(file, 'utf8');
  const format = (opt('--format') as TranscriptFormat | undefined) ?? detectFormat(file, text);
  const raw = parseTranscript(file, text, format);
  if (!raw.length) {
    console.error(`No utterances found in ${file} (read as ${format}).`);
    return 1;
  }
  const slug = (opt('--meeting') ?? basename(file).replace(/\.[^.]+$/, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const date = opt('--date') ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    console.error(`--date must be a date like 2026-10-14, not "${date}".`);
    return 2;
  }
  const config = existsSync(join(repo, 'parley.config.yaml')) ? parseConfig(readFileSync(join(repo, 'parley.config.yaml'), 'utf8')) : null;
  const known = new Set(config?.parties.flatMap((p) => p.people) ?? []);

  // Speaker labels in machine transcripts are unreliable; a person confirms who is who.
  const map = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--map') continue;
    for (const pair of (args[i + 1] ?? '').split(';')) {
      const [from, to] = pair.split('=').map((s) => s.trim());
      if (from && to) map.set(from, to);
    }
  }
  const speakers = [...new Set(raw.map((u) => u.speaker))];
  const unmapped = speakers.filter((s) => !map.has(s) && !known.has(s));
  if (unmapped.length && process.stdin.isTTY && !args.includes('--yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log(`Confirm who is who. People in parley.config.yaml: ${[...known].join(', ') || '(none)'}`);
    for (const s of unmapped) {
      const sample = raw.find((u) => u.speaker === s)?.text.slice(0, 80) ?? '';
      const answer = (await rl.question(`  "${s}" (says: "${sample}…") is: `)).trim();
      if (answer) map.set(s, answer);
    }
    rl.close();
  } else if (unmapped.length) {
    console.log(`Speaker labels kept as transcribed (not in parley.config.yaml): ${unmapped.join(', ')}. Use --map "Label=Person" to confirm them.`);
  }

  const utterances = toUtterances(raw, map);
  const participants = [...new Set(utterances.map((u) => u.speaker))];
  const out = formatRecord({
    meeting: slug,
    title: (opt('--title') ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() || `${slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())}, ${date}`,
    date,
    source: format,
    participants,
    utterances,
    mediaHash: sha256(text),
  });
  const dir = join(repo, config?.paths.records ?? 'records');
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${date}-${slug}.md`);
  if (existsSync(target) && !args.includes('--force')) {
    console.error(`${target} already exists. Records are never edited; use a different --meeting slug.`);
    return 1;
  }
  writeFileSync(target, out);
  console.log(`Wrote ${target}: ${utterances.length} utterances from ${participants.length} speakers (${format}).`);
  console.log('Commit it in its own PR, before any agreement change cites it.');
  return 0;
}
