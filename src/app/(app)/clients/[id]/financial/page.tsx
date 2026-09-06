import { loadClient } from '@/lib/db/load-client';
import { formatDateTime } from '@/lib/engines/normalize';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, FreshnessPill, ProvenanceTag, SourceTag, StateBadge } from '@/components/ui/badges';
import { EvidenceDrawer } from '@/components/ui/evidence';

export default async function FinancialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360 } = await loadClient(id, 'financial');
  const { run } = c360;
  if (!run?.assessment) return <Empty>No verification run yet.</Empty>;
  const a = run.assessment;
  return (
    <div className="space-y-4">
      <Panel title="Financial health indicators" right={<span className="text-[11px] text-ink-400">Verified vs derived clearly labelled - nothing is fabricated</span>}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {a.health.map((h) => (
            <div key={h.key} className="rounded-lg border border-white/[0.06] bg-ink-900 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wider text-ink-400">{h.label}</span>
                <StateBadge state={h.state} />
              </div>
              <div className="mt-1 text-base font-semibold text-ink-100">{h.display}</div>
              <p className="mt-1 text-xs text-ink-300">{h.detail}</p>
              <div className="mt-2 flex items-center justify-between">
                <ProvenanceTag kind={h.assertion} short />
                {h.evidence.length ? <EvidenceDrawer runId={run.id} evidence={h.evidence} title={h.label} /> : null}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Not available / not verified" right={<Badge tone="muted">No source data</Badge>}>
          <p className="mb-3 text-xs text-ink-400">These values are commonly requested but no reliable source has supplied them. BENFILE does not estimate them from income or credit score.</p>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {['Net worth', 'Assets', 'Liabilities', 'Disposable income', 'Total debt', 'Investment capacity', 'Affordability', 'Cash flow'].map((k) => (
              <li key={k} className="flex items-center justify-between rounded border border-dashed border-white/10 px-3 py-2">
                <span className="text-ink-200">{k}</span>
                <span className="text-xs text-ink-400">Not Available / Not Verified</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Financial capacity" right={<Badge tone={a.capacity.status === 'AVAILABLE' ? 'good' : a.capacity.status === 'PARTIAL' ? 'warn' : 'muted'}>{a.capacity.status}</Badge>}>
          <p className="text-sm text-ink-100">{a.capacity.statement}</p>
          <table className="table mt-3">
            <thead>
              <tr>
                <th>Input</th>
                <th>Available</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {a.capacity.inputs.map((i) => (
                <tr key={i.key}>
                  <td>{i.label}</td>
                  <td>{i.available ? <Badge tone="good">Yes</Badge> : <Badge tone="muted">No</Badge>}</td>
                  <td className="text-ink-300">
                    {i.value ?? '-'} {i.available && i.assertion ? <ProvenanceTag kind={i.assertion} short /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel id="quality" title="Data quality & freshness" right={<FreshnessPill freshness={a.overall.freshness} />}>
        <p className="mb-3 text-xs text-ink-400">A financial profile is only as current as its oldest critical source. Sources older than 180 days raise a freshness signal.</p>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Availability</th>
                <th>Verification</th>
                <th>Retrieved</th>
                <th>Last updated</th>
                <th>Freshness</th>
                <th>Confidence</th>
                <th>Completeness</th>
              </tr>
            </thead>
            <tbody>
              {a.dataQuality.map((q) => (
                <tr key={q.sourceKey} className={q.available && q.freshness === 'STALE' ? 'bg-danger/5' : ''}>
                  <td>
                    <div className="font-medium">{q.label}</div>
                    <SourceTag sourceKey={q.sourceKey} tier={q.tier} />
                  </td>
                  <td>{q.available ? <Badge tone="good">Available</Badge> : <Badge tone="muted">Not available</Badge>}</td>
                  <td>
                    <Badge tone={q.verificationStatus === 'VERIFIED' ? 'good' : q.verificationStatus === 'PARTIAL' ? 'warn' : 'muted'}>{q.verificationStatus.replace('_', ' ')}</Badge>
                  </td>
                  <td className="text-xs">{formatDateTime(q.retrievedAt)}</td>
                  <td className="text-xs">{formatDateTime(q.lastUpdatedAt)}</td>
                  <td>{q.available ? <FreshnessPill freshness={q.freshness} ageDays={q.ageDays} /> : '-'}</td>
                  <td className="mono text-xs">{q.confidence === null ? '-' : `${Math.round(q.confidence * 100)}%`}</td>
                  <td className="mono text-xs">{q.completeness === null ? '-' : `${Math.round(q.completeness * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
