import { useEffect, useMemo, useRef, useState } from 'react';
import type { Ledger, LedgerAgreement, LedgerVersion, Origin } from '../../src/lib/ledger.ts';
import type { CitedUtterance } from '../../src/lib/provenance.ts';

type Snap = LedgerVersion['snapshot'][number];
type Filter = 'all' | Origin;

const ORIGIN_LABEL: Record<Origin, string> = { person: 'Written by a person', agent: 'Agent, citing what was said', synthetic: 'Synthetic: nobody asked for this' };
const SHORT: Record<Origin, string> = { person: 'Person', agent: 'Agent, sourced', synthetic: 'Synthetic' };

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const n = (x: number) => x.toLocaleString('en-US');
const params = () => new URLSearchParams(location.search);
const who = (author: string) => (author.startsWith('agent:') ? author.slice(6) : author);
const stripMarkers = (t: string) =>
  t
    .split('\n')
    .filter((l) => !/^\*\*[\d.]+\*\*\s*$/.test(l) && !/^##\s/.test(l))
    .join(' ')
    .replace(/\*\*[\d.]+\*\*\s*/g, '')
    .trim();

export function App() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState('');
  const [ai, setAi] = useState(0);
  const [version, setVersion] = useState<number | null>(params().has('v') ? Number(params().get('v')) : null);
  const [filter, setFilter] = useState<Filter>((params().get('filter') as Filter) ?? 'all');
  const [pinned, setPinned] = useState<string | null>(params().get('clause'));
  const [hover, setHover] = useState<string | null>(null);
  const [focusUtterance, setFocusUtterance] = useState<string | null>(null);
  const scrolledOnce = useRef(false);

  useEffect(() => {
    fetch('./api/ledger')
      .then((r) => r.json())
      .then((j) => (j.error ? setError(j.error) : setLedger(j)))
      .catch((e) => setError(String(e)));
  }, []);

  const agreement: LedgerAgreement | undefined = ledger?.agreements[ai];
  const vIndex = agreement ? Math.min(Math.max((version ?? agreement.versions.length) - 1, 0), agreement.versions.length - 1) : 0;
  const current = agreement?.versions[vIndex];
  const active = (pinned ?? hover) && current ? current.snapshot.find((c) => c.id === (pinned ?? hover)) ?? null : null;

  // Bring a pinned clause into view (also when it arrives from the URL).
  useEffect(() => {
    if (!pinned || !ledger) return;
    const first = !scrolledOnce.current;
    scrolledOnce.current = true;
    // Jump on first load (a shared or filmed link); glide after a click.
    setTimeout(() => document.getElementById(`clause-${pinned}`)?.scrollIntoView({ behavior: first ? 'auto' : 'smooth', block: 'center' }), first ? 60 : 0);
    const c = current?.snapshot.find((x) => x.id === pinned);
    const u = c?.cited[0] ?? c?.verification?.said?.[0];
    if (u) setFocusUtterance(`${u.file}#${u.id}`);
  }, [pinned, ledger, vIndex]);

  // Keep the URL in step so a state can be shared or filmed.
  useEffect(() => {
    if (!agreement) return;
    const p = new URLSearchParams();
    if (version != null && version !== agreement.versions.length) p.set('v', String(version));
    if (filter !== 'all') p.set('filter', filter);
    if (pinned) p.set('clause', pinned);
    history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}`);
  }, [version, filter, pinned, agreement]);

  if (error) return <div className="empty">Could not read the ledger: {error}</div>;
  if (!ledger) return <div className="empty">Reading the ledger…</div>;
  if (!agreement || !current) return <div className="empty">No agreements yet. Add one under agreements/ and commit it.</div>;

  const first = agreement.versions[0];
  const counts = current.snapshot.reduce<Record<Origin, number>>((m, c) => (/\./.test(c.id) ? ((m[c.origin] += 1), m) : m), { person: 0, agent: 0, synthetic: 0 });
  const citedIds = new Set([...(active?.cited ?? []), ...(active?.verification?.said ?? [])].map((u) => `${u.file}#${u.id}`));

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden>
            <i className="g" />
            <i className="p" />
            <i className="r" />
          </span>
          parley
        </div>
        {ledger.agreements.length > 1 ? (
          <select className="picker" value={ai} onChange={(e) => (setAi(Number(e.target.value)), setVersion(null), setPinned(null))}>
            {ledger.agreements.map((a, i) => (
              <option key={a.file} value={i}>
                {a.title}
              </option>
            ))}
          </select>
        ) : (
          <div className="doc-title">{agreement.title}</div>
        )}
        <div className="parties">{ledger.config.parties.map((p) => p.name).join('  ·  ')}</div>
      </header>

      <main className="layout">
        <section className="left">
          <Summary agreement={agreement} current={current} first={first} counts={counts} />
          <Rounds agreement={agreement} vIndex={vIndex} onPick={(v) => (setVersion(v), setPinned(null))} />
          <div className="filters" role="tablist">
            {(['all', 'person', 'agent', 'synthetic'] as Filter[]).map((f) => (
              <button key={f} className={`chip ${f} ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
                {f !== 'all' && <i className={`dot ${f}`} />}
                {f === 'all' ? 'All clauses' : SHORT[f]}
                <b>{f === 'all' ? current.snapshot.filter((c) => /\./.test(c.id)).length : current.snapshot.filter((c) => c.origin === f && /\./.test(c.id)).length}</b>
              </button>
            ))}
          </div>
          <Clauses
            snap={current.snapshot}
            removed={current.removedHere}
            version={current.n}
            filter={filter}
            pinned={pinned}
            onHover={setHover}
            onPin={(id) => setPinned((p) => (p === id ? null : id))}
            onCite={(u) => setFocusUtterance(`${u.file}#${u.id}`)}
          />
        </section>

        <aside className="right">
          <Transcript ledger={ledger} highlighted={citedIds} focus={focusUtterance} active={active} />
        </aside>
      </main>
    </div>
  );
}

function Summary({ agreement, current, first, counts }: { agreement: LedgerAgreement; current: LedgerVersion; first: LedgerVersion; counts: Record<Origin, number> }) {
  const growth = first.words ? current.words / first.words : 1;
  return (
    <div className="summary">
      <div className="stat big">
        <span className="label">Length</span>
        <span className="value">
          {n(first.words)} <em>→</em> {n(current.words)}
          <small> words</small>
        </span>
        <span className="sub">{growth >= 1.5 ? `${growth.toFixed(1)}× the draft agreed on the call` : `version ${current.n} of ${agreement.versions.length}`}</span>
      </div>
      <div className="stat">
        <span className="label">Synthetic terms</span>
        <span className={`value ${current.synthetic ? 'red' : ''}`}>{current.synthetic}</span>
        <span className="sub">{current.synthetic ? 'agent-written, never discussed' : 'every change traces to a person'}</span>
      </div>
      <Chart versions={agreement.versions} upto={current.n} />
      <div className="legend">
        {(['person', 'agent', 'synthetic'] as Origin[]).map((o) => (
          <span key={o}>
            <i className={`dot ${o}`} /> {ORIGIN_LABEL[o]} <b>{n(current.byOrigin[o])}</b>
            <span className="muted"> words · {counts[o]} clauses</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Chart({ versions, upto }: { versions: LedgerVersion[]; upto: number }) {
  const max = Math.max(...versions.map((v) => v.words), 1);
  const W = 100 / versions.length;
  return (
    <div className="chart" aria-label="Words by origin per version">
      {versions.map((v) => {
        const h = (x: number) => `${(x / max) * 100}%`;
        return (
          <div key={v.n} className={`bar ${v.n > upto ? 'future' : ''} ${v.n === upto ? 'now' : ''}`} style={{ width: `${W}%` }}>
            <div className="stack">
              <span className="seg synthetic" style={{ height: h(v.byOrigin.synthetic) }} />
              <span className="seg agent" style={{ height: h(v.byOrigin.agent) }} />
              <span className="seg person" style={{ height: h(v.byOrigin.person) }} />
            </div>
            <span className="tick">v{v.n}</span>
          </div>
        );
      })}
    </div>
  );
}

function Rounds({ agreement, vIndex, onPick }: { agreement: LedgerAgreement; vIndex: number; onPick: (v: number) => void }) {
  return (
    <div className="rounds">
      {agreement.versions.map((v, i) => (
        <button key={v.sha} className={`round ${i === vIndex ? 'on' : ''} ${v.synthetic && i <= vIndex ? 'has-syn' : ''}`} onClick={() => onPick(v.n)} title={v.subject}>
          <span className="rn">v{v.n}</span>
          <span className="rb">{who(v.by)}</span>
          <span className="rw">{n(v.words)}w</span>
        </button>
      ))}
    </div>
  );
}

function Clauses(props: {
  snap: Snap[];
  removed: LedgerVersion['removedHere'];
  version: number;
  filter: Filter;
  pinned: string | null;
  onHover: (id: string | null) => void;
  onPin: (id: string) => void;
  onCite: (u: CitedUtterance) => void;
}) {
  const { snap, filter, pinned } = props;
  const sections = useMemo(() => {
    const out: { head: Snap | null; items: Snap[] }[] = [];
    for (const c of snap) {
      if (c.id === 'preamble') continue;
      if (!c.id.includes('.')) out.push({ head: c, items: [] });
      else (out[out.length - 1] ?? (out.push({ head: null, items: [] }), out[0])).items.push(c);
    }
    return out;
  }, [snap]);
  return (
    <div className="clauses">
      {sections.map((s, si) => {
        const items = s.items.filter((c) => filter === 'all' || c.origin === filter);
        if (!items.length) return null;
        return (
          <div key={s.head?.id ?? si} className="section">
            {s.head && (
              <h3>
                <span className="num">{s.head.id}</span> {s.head.title}
              </h3>
            )}
            {items.map((c) => (
              <ClauseCard key={c.id} c={c} version={props.version} open={pinned === c.id} onHover={props.onHover} onPin={props.onPin} onCite={props.onCite} />
            ))}
          </div>
        );
      })}
      {props.removed.length > 0 && filter !== 'person' && (
        <div className="section">
          <h3>Removed in v{props.version}</h3>
          {props.removed.map((r) => (
            <div key={r.id} className={`clause removed ${r.status === 'synthetic' ? 'synthetic' : 'agent'}`}>
              <div className="rail" />
              <div className="body">
                <div className="meta">
                  <span className="num">{r.id}</span> removed by {who(r.author)}
                </div>
                <p className="text struck">{stripMarkers(r.before ?? '')}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClauseCard({ c, version, open, onHover, onPin, onCite }: { c: Snap; version: number; open: boolean; onHover: (id: string | null) => void; onPin: (id: string) => void; onCite: (u: CitedUtterance) => void }) {
  const isAgent = c.author.startsWith('agent:') || c.origin !== 'person';
  return (
    <div
      className={`clause ${c.origin} ${open ? 'open' : ''} ${c.changed && c.since === version ? 'fresh' : ''}`}
      onMouseEnter={() => onHover(c.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPin(c.id)}
      id={`clause-${c.id}`}
    >
      <div className="rail" />
      <div className="body">
        <div className="meta">
          <span className="num">{c.id}</span>
          <span className={`who ${c.origin}`}>{isAgent ? <AgentIcon /> : <PersonIcon />}{who(c.author)}</span>
          {c.origin === 'synthetic' && <span className="flag">Synthetic term</span>}
          {c.origin !== 'synthetic' && c.verification?.verdict === 'unsupported' && <span className="doubt" title="parley verify found no support in the transcript. A person should read it.">Read this</span>}
          {c.since > 1 && <span className="since">v{c.since}</span>}
        </div>
        <p className="text">{stripMarkers(c.text)}</p>
        {(open || c.origin === 'synthetic') && (
          <div className="why">
            {c.cited.length > 0 ? (
              c.cited.map((u) => (
                <button key={`${u.file}#${u.id}`} className="quote" onClick={(e) => (e.stopPropagation(), onCite(u))}>
                  <span className="qm">“</span>
                  {u.text}
                  <span className="qby">
                    {u.speaker} · {fmtTime(u.startMs)} · {u.id}
                  </span>
                </button>
              ))
            ) : null}
            {c.origin === 'synthetic' && c.reasons.some((r) => !/^parley verify/.test(r)) && (
              <ul className="reasons">
                {c.reasons.filter((r) => !/^parley verify/.test(r)).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            {c.verification && c.verification.verdict === 'contradicted' && (
              <div className="verdict">
                <span className="vlabel">
                  What was actually said <em>{c.verification.verdict}</em>
                </span>
                {(c.verification.said ?? []).every((u) => c.cited.some((x) => x.file === u.file && x.id === u.id)) && c.cited.length > 0 && (
                  <p className="vquote">It cites the right lines, but they say something different.</p>
                )}
                {(c.verification.said ?? []).filter((u) => !c.cited.some((x) => x.file === u.file && x.id === u.id)).slice(0, 2).map((u) => (
                  <button key={u.id} className="quote said" onClick={(e) => (e.stopPropagation(), onCite(u))}>
                    <span className="qm">“</span>
                    {u.text}
                    <span className="qby">
                      {u.speaker} · {fmtTime(u.startMs)} · {u.id}
                    </span>
                  </button>
                ))}
                {!c.verification.said?.length && c.verification.quote && <p className="vquote">“{c.verification.quote}”</p>}
                <span className="vmodel">checked by parley verify · {c.verification.model}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Transcript({ ledger, highlighted, focus, active }: { ledger: Ledger; highlighted: Set<string>; focus: string | null; active: Snap | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ri, setRi] = useState(0);
  useEffect(() => {
    if (!focus) return;
    const idx = ledger.records.findIndex((r) => focus.startsWith(`${r.file}#`));
    if (idx >= 0 && idx !== ri) setRi(idx);
    requestAnimationFrame(() => {
      const el = ref.current?.querySelector(`[data-key="${CSS.escape(focus)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [focus]);
  const record = ledger.records[ri];
  if (!record) return <div className="transcript empty-t">No meeting records yet. Run parley ingest.</div>;
  return (
    <div className="transcript">
      <div className="t-head">
        <span className="label">The record</span>
        {ledger.records.length > 1 ? (
          // A native select cannot ellipsize its label, so an invisible select sits over a label that can.
          <label className="t-pick" title={record.title}>
            <span className="t-pick-label">
              {record.agentWritten ? '⚠ ' : ''}
              {record.title}
            </span>
            <span className="t-pick-caret" aria-hidden>
              ▾
            </span>
            <select value={ri} aria-label="Meeting record" onChange={(e) => setRi(Number(e.target.value))}>
              {ledger.records.map((r, i) => (
                <option key={r.file} value={i}>
                  {r.agentWritten ? '⚠ ' : ''}
                  {r.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="t-title" title={record.title}>
            {record.title}
          </span>
        )}
        <span className="muted">{record.participants.join(', ')}</span>
      </div>
      {record.agentWritten && (
        <div className="nothing">Written by {record.addedBy}. An agent's notes are not a record of what anyone said, so nothing can cite them.</div>
      )}
      {active && active.origin === 'synthetic' && active.cited.length === 0 && (
        <div className="nothing">
          Clause {active.id}: {active.verification?.verdict === 'contradicted' ? 'nothing in the record supports it, and what was said points the other way.' : 'nothing in the record supports it.'}
        </div>
      )}
      <div className="lines" ref={ref}>
        {record.utterances.map((u) => {
          const key = `${record.file}#${u.id}`;
          return (
            <div key={key} data-key={key} className={`line ${highlighted.has(key) ? 'hit' : ''} ${focus === key ? 'focus' : ''}`}>
              <span className="ts">{fmtTime(u.startMs)}</span>
              <span className="sp">{u.speaker}</span>
              <span className="tx">{u.text}</span>
              <span className="uid">{u.id}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PersonIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
    <circle cx="8" cy="5.2" r="2.8" fill="currentColor" />
    <path d="M2.5 14c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" fill="currentColor" />
  </svg>
);
const AgentIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
    <rect x="2.5" y="4" width="11" height="9" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="6" cy="8.5" r="1.1" fill="currentColor" />
    <circle cx="10" cy="8.5" r="1.1" fill="currentColor" />
    <path d="M8 1.8V4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
