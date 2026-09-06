import { loadClient } from '@/lib/db/load-client';
import { hasPermission } from '@/lib/security/permissions';
import { formatDate, formatDateTime } from '@/lib/engines/normalize';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, SeverityBadge, SourceTag, StatusBadge } from '@/components/ui/badges';
import { EvidenceDrawer } from '@/components/ui/evidence';
import { SignalReview } from '@/components/client360/signal-review';

const CATEGORIES = ['IDENTITY', 'CREDIT', 'EMPLOYMENT', 'CONTACT', 'BANKING', 'ADDRESS', 'MOBILE', 'DATA_CONSISTENCY', 'DATA_FRESHNESS', 'EXTERNAL', 'LEGAL', 'REGULATORY', 'SANCTIONS', 'ADVERSE_MEDIA'];

export default async function RiskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, role, db } = await loadClient(id, 'risk');
  const { run, signals, staff } = c360;
  const canReview = hasPermission(role, 'risk:review');
  const canEscalate = hasPermission(role, 'risk:escalate');
  const byName = Object.fromEntries(staff.map((s) => [s.user_id, s.full_name]));
  const { data: disputes } = await db.from('disputes').select('*').eq('client_id', id).order('raised_at', { ascending: false });
  const open = signals.filter((s) => !['DISMISSED', 'RESOLVED'].includes(s.status));
  const closed = signals.filter((s) => ['DISMISSED', 'RESOLVED'].includes(s.status));
  const counts = CATEGORIES.map((c) => ({ c, n: open.filter((s) => s.category === c).length })).filter((x) => x.n);

  return (
    <div className="space-y-4">
      <Panel title="Risk intelligence" right={<div className="flex gap-2">{counts.map((x) => <Badge key={x.c} tone="neutral">{x.c.replace('_', ' ')} {x.n}</Badge>)}</div>}>
        <p className="text-xs text-ink-400">Signals from the provider are shown verbatim (origin PROVIDER). Rules-engine signals are BENFILE interpretations. Contradictory inputs create Needs Review rather than an invented conclusion. Review states persist across re-verification.</p>
      </Panel>
      {open.length ? (
        open.map((s) => (
          <article key={s.id} className={`panel p-4 ${s.status === 'NEEDS_REVIEW' ? 'border-amber-400/30' : ''}`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={s.severity} />
                  <StatusBadge status={s.status} />
                  <Badge tone={s.origin === 'PROVIDER' ? 'good' : s.origin === 'EXTERNAL' ? 'info' : 'derived'}>{s.origin.replace('_', ' ')}</Badge>
                  <Badge tone="muted">{s.category.replace('_', ' ')}</Badge>
                  <SourceTag sourceKey={s.source_key} />
                </div>
                <h3 className="mt-2 text-base font-semibold text-ink-100">{s.title}</h3>
                <p className="mt-1 text-sm text-ink-300">{s.explanation}</p>
                {s.evidence.length ? (
                  <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                    {s.evidence.slice(0, 6).map((e, i) => (
                      <div key={i} className="flex gap-2">
                        <dt className="text-ink-400">{e.label}:</dt>
                        <dd className="mono text-ink-200">{e.value ?? '-'}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500">
                  <span>Rule {s.rule_key}</span>
                  <span>Detected {formatDate(s.detected_at)}</span>
                  <span>Updated {formatDateTime(s.updated_at)}</span>
                  {s.reviewer_id ? <span>Reviewer {byName[s.reviewer_id] ?? 'staff'} {formatDateTime(s.reviewed_at)}</span> : null}
                  {run ? <EvidenceDrawer runId={run.id} evidence={s.evidence} title={s.title} /> : null}
                </div>
                {s.reviewer_notes ? <p className="mt-2 rounded border border-gold-500/20 bg-gold-500/5 p-2 text-xs text-ink-200"><span className="text-gold-300">Analyst note:</span> {s.reviewer_notes}</p> : null}
              </div>
              {canReview ? <SignalReview id={s.id} canEscalate={canEscalate} /> : null}
            </div>
          </article>
        ))
      ) : (
        <Empty>No open risk signals.</Empty>
      )}
      {closed.length ? (
        <Panel title={`Closed signals (${closed.length})`}>
          <ul className="space-y-1 text-xs">
            {closed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 border-b border-white/[0.05] py-1.5">
                <StatusBadge status={s.status} /> <SeverityBadge severity={s.severity} /> <span className="text-ink-200">{s.title}</span>
                <span className="text-ink-500">{byName[s.reviewer_id ?? ''] ?? ''} {formatDateTime(s.reviewed_at)}</span>
                {s.reviewer_notes ? <span className="text-ink-400">- {s.reviewer_notes}</span> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <Panel title="Data disputes & corrections" right={<Badge tone="muted">{disputes?.length ?? 0}</Badge>}>
        {disputes?.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Flag</th>
                <th>Entity / field</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Raised</th>
              </tr>
            </thead>
            <tbody>
              {disputes.map((d) => (
                <tr key={d.id}>
                  <td><Badge tone="warn">{d.flag.replace('_', ' ')}</Badge></td>
                  <td className="mono text-xs">{d.entity_table}{d.field_key ? ` / ${d.field_key}` : ''}</td>
                  <td className="text-xs">{d.reason}{d.resolution ? <div className="text-emerald-300">Resolution: {d.resolution}</div> : null}</td>
                  <td><StatusBadge status={d.status} /></td>
                  <td className="text-xs">{byName[d.raised_by] ?? ''} {formatDate(d.raised_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-ink-400">No disputes raised. Use "Flag data" on any fact to mark it incorrect, outdated, wrong person, disputed, unverified or a source error.</p>
        )}
      </Panel>
    </div>
  );
}
