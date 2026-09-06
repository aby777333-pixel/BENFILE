import type { AnalysisSection } from '@/lib/wealth/behavior-engine';
import { Badge, ConfidenceBadge, EvidenceBadge } from '@/components/ui/badges';

export function EvidenceList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[11px] text-ink-400">
      {items.map((e, i) => (
        <li key={i} className="flex gap-1"><span className="text-gold-500">-</span> <span>{e}</span></li>
      ))}
    </ul>
  );
}

/** One analysis section: value, confidence, evidence class, basis ("View calculation"), evidence ("View evidence"), missing. */
export function SectionCard({ s, extra }: { s: AnalysisSection; extra?: string }) {
  const r = s.result;
  return (
    <section className="panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="panel-title">{s.label}</div>
          <div className="mt-1 text-base font-semibold text-ink-100">{r.value}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ConfidenceBadge level={r.confidence} />
          <EvidenceBadge kind={r.evidenceClass} />
        </div>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-gold-300">View calculation</summary>
        <p className="mt-1 text-ink-300">{r.basis}</p>
        {extra ? <p className="mt-1 text-ink-500">{extra}</p> : null}
      </details>
      {r.evidence.length ? (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-gold-300">View evidence ({r.evidence.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {r.evidence.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 text-ink-300"><span className="text-ink-100">{e.label}</span>{e.value ? <span className="mono">{e.value}</span> : null}<span className="text-ink-500">source {e.source}</span></li>
            ))}
          </ul>
        </details>
      ) : null}
      {r.missing?.length ? <div className="mt-2 flex flex-wrap gap-1">{r.missing.map((m) => <Badge key={m} tone="muted">missing: {m}</Badge>)}</div> : null}
    </section>
  );
}
