'use client';
import { useState } from 'react';
import { Badge, ConfidenceBadge, EvidenceBadge } from '@/components/ui/badges';

interface Answer {
  intent: string;
  answer: string;
  items: Array<{ label: string; detail: string; evidenceClass?: string; source?: string }>;
  sources: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

const SUGGESTED = [
  'Show all companies connected to this client',
  'Does the client have any current court proceedings?',
  'Show properties with active mortgages',
  "What is the client's verified mutual-fund exposure?",
  'List all active loans',
  'Show major changes in net worth',
  'Which assets are inherited?',
  'Show directorship history',
  'Show all vehicles reliably associated with the client',
  'Why did the risk score increase?',
  'Which parts of the net-worth estimate are uncertain?',
  'How should I approach this client?',
  'What should I discuss first?',
  'What are the known financial priorities?',
  'What products appear relevant?',
  'What should I not pitch?',
  'What questions should I ask?',
  'What objections have been raised previously?',
  'What changed since our last meeting?',
  'What should my next action be?',
];

export function AskPanel({ clientId }: { clientId: string }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Array<{ q: string; a: Answer | null; error?: string }>>([]);

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    setQ('');
    try {
      const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, question }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Failed');
      setHistory((h) => [{ q: question, a: j as Answer }, ...h]);
    } catch (e) {
      setHistory((h) => [{ q: question, a: null, error: (e as Error).message }, ...h]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about companies, court records, mortgages, loans, net worth, approach, priorities, next action..." />
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Working...' : 'Ask'}
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED.map((s) => (
          <button key={s} type="button" className="rounded border border-white/10 px-2 py-1 text-[11px] text-ink-300 hover:border-gold-500/40 hover:text-gold-300" onClick={() => void ask(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-ink-500">Answers are assembled from structured, authorised data only; nothing is generated freely. If a question cannot be mapped to data, the assistant says so.</p>
      <ul className="space-y-3">
        {history.map((h, i) => (
          <li key={i} className="panel p-4">
            <div className="text-xs text-ink-400">You asked</div>
            <div className="text-sm font-medium text-ink-100">{h.q}</div>
            {h.error ? <p className="mt-2 text-sm text-red-300">{h.error}</p> : null}
            {h.a ? (
              <div className="mt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="muted">intent: {h.a.intent.replace(/_/g, ' ')}</Badge>
                  <ConfidenceBadge level={h.a.confidence} />
                </div>
                <p className="mt-2 text-sm text-ink-100">{h.a.answer}</p>
                {h.a.items.length ? (
                  <ul className="mt-2 space-y-1">
                    {h.a.items.map((it, k) => (
                      <li key={k} className="flex flex-wrap items-start gap-2 border-b border-white/[0.05] py-1 text-xs">
                        <span className="text-ink-100">{it.label}</span>
                        <span className="flex-1 text-ink-300">{it.detail}</span>
                        {it.evidenceClass ? <EvidenceBadge kind={it.evidenceClass.toUpperCase().replace(/ /g, '_')} short /> : null}
                        {it.source ? <span className="text-ink-500">src {it.source}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {h.a.sources.length ? <div className="mt-2 text-[11px] text-ink-500">Sources: {h.a.sources.join(', ')}</div> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
