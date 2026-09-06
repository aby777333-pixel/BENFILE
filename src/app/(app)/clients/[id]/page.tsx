import Link from 'next/link';
import { AlertTriangle, CircleHelp } from 'lucide-react';
import { loadClient } from '@/lib/db/load-client';
import { generateSummary } from '@/lib/ai/summary';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, ProvenanceTag, SeverityBadge, StateBadge } from '@/components/ui/badges';
import { EvidenceDrawer } from '@/components/ui/evidence';
import { Gauge } from '@/components/charts/gauge';
import { ScoreBreakdown } from '@/components/client360/score-breakdown';
import { hasPermission } from '@/lib/security/permissions';

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, role } = await loadClient(id, 'overview');
  const { run, signals } = c360;
  if (!run || !run.assessment) {
    return (
      <Empty>
        No verification run yet.{' '}
        <Link href={`/clients/new?clientId=${id}`} className="text-gold-300">
          Ingest a provider response
        </Link>{' '}
        to build the profile.
      </Empty>
    );
  }
  const a = run.assessment;
  const p = run.canonical;
  const canFinancial = hasPermission(role, 'financial:read');
  const ai = await generateSummary(p, a);
  const tone = { good: 'text-emerald-300', neutral: 'text-ink-100', warn: 'text-amber-300', bad: 'text-red-300', muted: 'text-ink-400' } as const;
  const liveSignals = signals.filter((s) => !['DISMISSED', 'RESOLVED'].includes(s.status));
  const review = liveSignals.filter((s) => s.requires_review && s.status !== 'REVIEWED');
  const hideFinancial = new Set(['income', 'credit', 'banking']);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <Panel title="Executive financial profile" right={<span className="text-[11px] text-ink-400">Each line is traceable to evidence</span>}>
          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {a.summary
              .filter((l) => canFinancial || !hideFinancial.has(l.key))
              .map((l) => (
                <div key={l.key} className="flex items-start justify-between gap-3 border-b border-white/[0.05] pb-2">
                  <div className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wider text-ink-400">{l.label}</dt>
                    <dd className={`truncate text-sm font-medium ${tone[l.tone]}`}>{l.value}</dd>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <ProvenanceTag kind={l.assertion} short />
                    {l.evidence.length ? <EvidenceDrawer runId={run.id} evidence={l.evidence} title={l.label} /> : null}
                  </div>
                </div>
              ))}
          </dl>
        </Panel>

        <Panel title="AI-assisted narrative" right={<Badge tone={ai.mode === 'MODEL' ? 'info' : 'muted'}>{ai.mode === 'MODEL' ? `Model: ${ai.model}` : 'Deterministic'}</Badge>}>
          <ul className="space-y-2">
            {ai.sentences.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink-100">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" />
                <span>
                  {s.text}{' '}
                  <span className="text-[10.5px] text-ink-500" title="Evidence keys">
                    [{s.evidence.join(', ')}]
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-500">{ai.disclaimer}</p>
        </Panel>

        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Requires human review" right={review.length ? <Badge tone="warn">{review.length}</Badge> : <Badge tone="good">Clear</Badge>}>
            {review.length ? (
              <ul className="space-y-2">
                {review.slice(0, 6).map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-sm">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SeverityBadge severity={s.severity} />
                        <span className="text-ink-100">{s.title}</span>
                      </div>
                      <div className="text-xs text-ink-400">{s.category.replace('_', ' ')} - {s.origin.replace('_', ' ')}</div>
                    </div>
                  </li>
                ))}
                {review.length > 6 ? (
                  <li>
                    <Link href={`/clients/${id}/risk`} className="text-xs text-gold-300">
                      View all {review.length} in Risk
                    </Link>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="text-sm text-ink-300">No open items require review.</p>
            )}
          </Panel>
          <Panel title="Missing / not verified" right={<Badge tone="muted">{a.overall.missing.length}</Badge>}>
            {a.overall.missing.length ? (
              <ul className="space-y-1.5">
                {a.overall.missing.map((m) => (
                  <li key={m} className="flex items-center gap-2 text-sm text-ink-300">
                    <CircleHelp size={13} className="text-ink-500" /> {m}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-300">All expected sources returned data.</p>
            )}
            <p className="mt-3 text-[11px] text-ink-500">Missing information is not treated as negative information.</p>
          </Panel>
        </div>

        <Panel title="Financial health snapshot" right={<Link href={`/clients/${id}/financial`} className="text-[11px] text-gold-300">Open module</Link>}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {a.health
              .filter((h) => canFinancial || !hideFinancial.has(h.key))
              .map((h) => (
                <div key={h.key} className="rounded-lg border border-white/[0.06] bg-ink-900 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wider text-ink-400">{h.label}</span>
                    <StateBadge state={h.state} />
                  </div>
                  <div className="mt-1 truncate text-sm font-medium text-ink-100">{h.display}</div>
                  <div className="mt-1">
                    <ProvenanceTag kind={h.assertion} short />
                  </div>
                </div>
              ))}
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="Profile score (explainable)">
          <div className="flex justify-center">
            <Gauge value={a.score.total} min={0} max={100} label="Profile score" sublabel={`coverage ${Math.round(a.score.coverage * 100)}%`} bands={[{ upTo: 40, color: '#E05252' }, { upTo: 60, color: '#E8B23A' }, { upTo: 80, color: '#4C8DFF' }, { upTo: 100, color: '#2FBF71' }]} />
          </div>
          <ScoreBreakdown score={a.score} runId={run.id} />
        </Panel>
        <Panel title="Data quality">
          <ul className="space-y-1.5 text-xs">
            {a.dataQuality.map((q) => (
              <li key={q.sourceKey} className="flex items-center justify-between gap-2">
                <span className="truncate text-ink-200">{q.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {q.available ? <Badge tone={q.freshness === 'STALE' ? 'bad' : q.freshness === 'AGING' ? 'warn' : 'good'}>{q.freshness}</Badge> : <Badge tone="muted">Not available</Badge>}
                </span>
              </li>
            ))}
          </ul>
          <Link href={`/clients/${id}/financial#quality`} className="mt-3 block text-[11px] text-gold-300">
            Full data-quality panel
          </Link>
        </Panel>
        <Panel title="Financial capacity">
          <Badge tone={a.capacity.status === 'AVAILABLE' ? 'good' : a.capacity.status === 'PARTIAL' ? 'warn' : 'muted'}>{a.capacity.status}</Badge>
          <p className="mt-2 text-sm text-ink-200">{a.capacity.statement}</p>
        </Panel>
        {run.warnings.length ? (
          <Panel title="Adapter notes">
            <ul className="space-y-1 text-xs text-ink-300">
              {run.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
