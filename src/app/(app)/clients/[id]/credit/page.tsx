import { loadClient } from '@/lib/db/load-client';
import { formatDate, formatINR } from '@/lib/engines/normalize';
import { Panel, Empty, Kv, NotAvailable } from '@/components/ui/panel';
import { Badge, ProvenanceTag, SourceTag } from '@/components/ui/badges';
import { EvidenceDrawer } from '@/components/ui/evidence';
import { CREDIT_BANDS, Gauge } from '@/components/charts/gauge';
import { DisputeButton } from '@/components/client360/dispute-button';

const INTERPRET: Record<string, string> = {
  EXCELLENT: 'Score in the excellent band. Lenders typically treat this as a low-risk bureau profile.',
  VERY_GOOD: 'Score in the very good band. Generally favourable bureau standing.',
  GOOD: 'Score in the good band. Acceptable bureau standing; review obligations when available.',
  FAIR: 'Score in the fair band. Review repayment history and enquiries before relying on it.',
  POOR: 'Score in the lower band. Repayment history and delinquencies should be reviewed.',
  NO_HISTORY: 'No credit history reported. Absence of history is not negative information.',
  NOT_AVAILABLE: 'No bureau score was returned in this run.',
};

export default async function CreditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360 } = await loadClient(id, 'credit');
  const { run } = c360;
  if (!run?.assessment) return <Empty>No verification run yet.</Empty>;
  const c = run.canonical.credit;
  const s = c?.summary;
  const n = (v: number | null | undefined) => (v === null || v === undefined ? <NotAvailable /> : <span className="mono">{v}</span>);
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel title="Credit score" right={c ? <SourceTag sourceKey={c.provenance.sourceKey} tier={c.provenance.tier} label={`Source: ${c.bureau ?? 'Bureau'} via provider`} /> : null}>
        <div className="flex justify-center">
          <Gauge value={c?.score ?? null} min={300} max={900} label="Credit score" sublabel={c ? c.band.replace('_', ' ') : 'Not available'} bands={CREDIT_BANDS} size={220} />
        </div>
        <Kv
          rows={[
            ['Band', c ? <Badge key="b" tone={c.score && c.score >= 750 ? 'good' : c.score && c.score >= 650 ? 'info' : c.score ? 'warn' : 'muted'}>{c.band.replace('_', ' ')}</Badge> : null],
            ['Bureau', c?.bureau],
            ['Score date', c?.scoreDate ? formatDate(c.scoreDate) : null],
            ['Retrieved', c?.provenance.retrievedAt ? formatDate(c.provenance.retrievedAt) : null],
            ['Identifiers', c && Object.keys(c.identifiers).length ? <ul key="i" className="mono text-xs">{Object.entries(c.identifiers).map(([k, v]) => <li key={k}>{k}: {v ?? '-'}</li>)}</ul> : null],
          ]}
        />
        <p className="mt-3 text-xs text-ink-300">
          <span className="font-medium text-ink-100">Interpretation </span>
          <ProvenanceTag kind="DERIVED" short /> {INTERPRET[c?.band ?? 'NOT_AVAILABLE']}
        </p>
        <div className="mt-3 flex items-center gap-3">
          {c ? <EvidenceDrawer runId={run.id} evidence={[{ label: 'Credit record', sourceKey: 'CREDIT', path: c.provenance.evidencePath, value: String(c.score) }]} title="Credit bureau record" /> : null}
          <DisputeButton clientId={id} entityTable="credit_profiles" fieldKey="score" />
        </div>
      </Panel>
      <div className="space-y-4 xl:col-span-2">
        <Panel title="Credit obligations" right={<Badge tone="muted">Schema ready for bureau expansion</Badge>}>
          <p className="mb-3 text-xs text-ink-400">Displayed only when a bureau adapter supplies them. Nothing here is estimated.</p>
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <Kv rows={[['Active loans', n(s?.activeLoans)], ['Secured loans', n(s?.securedLoans)], ['Unsecured loans', n(s?.unsecuredLoans)], ['Credit cards', n(s?.creditCards)]]} />
            <Kv rows={[['Outstanding balance', s?.totalOutstanding !== null && s?.totalOutstanding !== undefined ? formatINR(s.totalOutstanding) : <NotAvailable />], ['Utilisation', s?.utilization !== null && s?.utilization !== undefined ? `${Math.round(s.utilization * 100)}%` : <NotAvailable />], ['Enquiries (12m)', n(s?.enquiriesLast12m)], ['Delinquencies', n(s?.delinquencies)]]} />
          </div>
        </Panel>
        <Panel title="Accounts">
          {c?.accounts.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Lender</th>
                  <th>Status</th>
                  <th>Sanctioned</th>
                  <th>Outstanding</th>
                  <th>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {c.accounts.map((acc, i) => (
                  <tr key={i}>
                    <td>{acc.accountType}</td>
                    <td>{acc.lender ?? '-'}</td>
                    <td>{acc.status ?? '-'}</td>
                    <td>{formatINR(acc.sanctioned)}</td>
                    <td>{formatINR(acc.outstanding)}</td>
                    <td>{formatINR(acc.overdue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No account-level data returned. Repayment history, enquiries, defaults, settlements and write-offs will appear here when a bureau report is connected.</Empty>
          )}
        </Panel>
        <Panel title="Credit events (enquiries, delinquencies, defaults, settlements, write-offs)">
          {c?.events.length ? (
            <ul className="space-y-1 text-sm">
              {c.events.map((e, i) => (
                <li key={i} className="flex justify-between border-b border-white/[0.05] py-1">
                  <span>
                    <Badge tone={e.kind === 'ENQUIRY' ? 'info' : 'warn'}>{e.kind}</Badge> {e.lender ?? ''} {e.detail ?? ''}
                  </span>
                  <span className="text-xs text-ink-400">{formatDate(e.date)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No credit events returned.</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
