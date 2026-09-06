import { loadClient } from '@/lib/db/load-client';
import { loadIntelligence } from '@/lib/wealth/load-context';
import { cr } from '@/lib/wealth/wealth-engine';
import { hasPermission } from '@/lib/security/permissions';
import { formatDate } from '@/lib/engines/normalize';
import { Panel, Empty, NotAvailable } from '@/components/ui/panel';
import { Badge, EvidenceBadge, ConfidenceBadge, SourceTag, StatusBadge } from '@/components/ui/badges';
import { ActionForm } from '@/components/ui/action-form';
import { Timeline } from '@/components/ui/timeline';
import { RelationshipGraph, type GraphEdge } from '@/components/charts/relationship-graph';
import { AddAssetForm, AddLiabilityForm, AddWealthEventForm, AddFamilyLinkForm } from '@/components/wealth/asset-forms';
import { updateAssetStatus } from '@/lib/actions-wealth';
import { RELIABLE_EVIDENCE, type AssetRow, type Confidence, type LiabilityRow, type ValuationBasis } from '@/lib/wealth/types';

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const inr = (v: number | null | undefined) => (v === null || v === undefined ? <NotAvailable label="Not available" /> : <span className="mono">INR {cr(v)}</span>);
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const CONF_NUM: Record<Confidence, number> = { VERIFIED: 100, HIGH: 85, MEDIUM: 60, LOW: 35, INSUFFICIENT: 10 };
const BASIS_TONE: Record<ValuationBasis, 'good' | 'info' | 'derived' | 'declared' | 'muted' | 'neutral'> = { REGISTERED_TRANSACTION: 'good', OFFICIAL_GUIDELINE: 'info', ESTIMATED_MARKET: 'derived', STATEMENT: 'good', NAV: 'good', INSURED_VALUE: 'neutral', DECLARED: 'declared', NOT_VALUED: 'muted' };
const GUARANTOR = ['GUARANTOR', 'DIRECTOR_GUARANTOR'];

function ValueCell({ a }: { a: AssetRow }) {
  const low = num(a.value_low);
  const mid = num(a.value_mid);
  const high = num(a.value_high);
  if (low === null && mid === null && high === null) return <NotAvailable label="Not valued" />;
  return (
    <div className="space-y-0.5">
      <div className="mono text-xs">{low !== null && high !== null && low !== high ? `${cr(low)} - ${cr(high)}` : cr(mid ?? low ?? high ?? 0)}{mid !== null && low !== null && high !== null && low !== high ? <span className="text-ink-400"> (mid {cr(mid)})</span> : null}</div>
      <Badge tone={BASIS_TONE[a.valuation_basis] ?? 'muted'}>{a.valuation_basis.replace(/_/g, ' ')}</Badge>
      <div className="text-[11px] text-ink-400">{a.valuation_date ? formatDate(a.valuation_date) : 'Undated'}{a.pricing_source ? ` - ${a.pricing_source}` : ''}{a.valuation_method ? ` - ${a.valuation_method}` : ''}</div>
    </div>
  );
}
function Ownership({ a }: { a: AssetRow }) {
  return (
    <div className="space-y-0.5 text-xs">
      <Badge tone={a.ownership_scope === 'FAMILY_LINKED' ? 'declared' : 'neutral'}>{a.ownership_scope.replace(/_/g, ' ')}{num(a.ownership_pct) !== null ? ` ${num(a.ownership_pct)}%` : ''}</Badge>
      <div className="flex gap-1">{a.is_inherited ? <Badge tone="gold">Inherited</Badge> : null}{a.encumbered ? <Badge tone="warn">Encumbered</Badge> : a.encumbered === false ? <Badge tone="good">Unencumbered</Badge> : <Badge tone="muted">Charge unknown</Badge>}</div>
    </div>
  );
}
function StatusActions({ a, canWrite }: { a: AssetRow; canWrite: boolean }) {
  return (
    <div className="space-y-1">
      <StatusBadge status={a.status} />
      {canWrite ? (
        <div className="flex flex-wrap gap-1">
          {(['ACTIVE', 'DISPOSED', 'DISPUTED', 'REJECTED'] as const).filter((s) => s !== a.status).map((s) => (
            <ActionForm key={s} action={updateAssetStatus} confirm={s === 'REJECTED' ? 'Reject this asset record?' : undefined}>
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="status" value={s} />
              <button className="btn btn-sm px-1.5 py-0.5 text-[10px]" type="submit">{s.toLowerCase()}</button>
            </ActionForm>
          ))}
        </div>
      ) : null}
    </div>
  );
}
function EvidenceCells({ a }: { a: AssetRow }) {
  return (
    <>
      <td><EvidenceBadge kind={a.evidence_class} /></td>
      <td><ConfidenceBadge level={a.confidence} /></td>
      <td><SourceTag sourceKey={a.source_key} /></td>
    </>
  );
}

function AssetTable({ rows, extra, canWrite, possibleNote }: { rows: AssetRow[]; extra: Array<[string, (a: AssetRow) => React.ReactNode]>; canWrite: boolean; possibleNote?: boolean }) {
  if (!rows.length) return <Empty>None recorded.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>Title</th>{extra.map(([h]) => <th key={h}>{h}</th>)}<th>Value & valuation basis</th><th>Ownership</th><th>Evidence</th><th>Confidence</th><th>Source</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((a) => {
            const possible = a.evidence_class === 'POSSIBLE_ASSOCIATION';
            return (
              <tr key={a.id} className={possible ? 'opacity-60' : a.status !== 'ACTIVE' ? 'opacity-70' : ''}>
                <td><div className="font-medium">{a.title}</div><div className="text-[11px] text-ink-400">{a.subtype ?? a.category.replace(/_/g, ' ')}{a.acquired_on ? ` - acquired ${formatDate(a.acquired_on)}` : ''}{a.liquidity ? ` - ${a.liquidity.toLowerCase().replace('_', '-')}` : ''}</div>{possible && possibleNote ? <Badge tone="warn">requires corroboration</Badge> : null}</td>
                {extra.map(([h, fn]) => <td key={h} className="text-xs">{fn(a) ?? '-'}</td>)}
                <td><ValueCell a={a} /></td>
                <td><Ownership a={a} /></td>
                <EvidenceCells a={a} />
                <td><StatusActions a={a} canWrite={canWrite} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LiabilityTable({ rows }: { rows: LiabilityRow[] }) {
  if (!rows.length) return <Empty>None recorded.</Empty>;
  const repayTone = (s: string | null) => (!s || s === 'REGULAR' || s === 'CLOSED' ? 'good' : ['WRITTEN_OFF', 'SETTLED', 'DPD_90'].includes(s) ? 'bad' : 'warn');
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>Lender</th><th>Type</th><th>Original</th><th>Outstanding</th><th>Monthly</th><th>Rate</th><th>Opened</th><th>Maturity</th><th>Collateral</th><th>Repayment</th><th>Role</th><th>Evidence</th><th>Confidence</th><th>Source</th></tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} className={l.status !== 'ACTIVE' ? 'opacity-60' : ''}>
              <td className="font-medium">{l.lender ?? '-'}</td>
              <td className="text-xs">{l.liability_type.replace(/_/g, ' ')}{l.secured === true ? <Badge tone="good" className="ml-1">secured</Badge> : l.secured === false ? <Badge tone="muted" className="ml-1">unsecured</Badge> : null}</td>
              <td>{inr(num(l.original_amount))}</td>
              <td>{inr(num(l.outstanding))}</td>
              <td>{inr(num(l.monthly_obligation))}</td>
              <td className="mono text-xs">{num(l.interest_rate) !== null ? `${num(l.interest_rate)}%` : '-'}</td>
              <td className="text-xs">{formatDate(l.opened_on)}</td>
              <td className="text-xs">{l.maturity_on ? formatDate(l.maturity_on) : '-'}</td>
              <td className="text-xs">{l.collateral ?? '-'}</td>
              <td><Badge tone={repayTone(l.repayment_status)}>{(l.repayment_status ?? 'UNKNOWN').replace(/_/g, ' ')}</Badge>{l.days_past_due ? <span className="mono ml-1 text-[10px] text-red-300">{l.days_past_due}d</span> : null}</td>
              <td><Badge tone={GUARANTOR.includes(l.role) ? 'gold' : 'neutral'}>{l.role.replace(/_/g, ' ')}</Badge></td>
              <td><EvidenceBadge kind={l.evidence_class} /></td>
              <td><ConfidenceBadge level={l.confidence} /></td>
              <td><SourceTag sourceKey={l.source_key} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AssetsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, db } = await loadClient(id, 'assets');
  const { ctx } = await loadIntelligence(db, id);
  const canWrite = hasPermission(role, 'clients:write');
  const canVerify = hasPermission(role, 'sensitive:reveal');
  const by = (...cats: AssetRow['category'][]) => ctx.assets.filter((a) => cats.includes(a.category));
  const d = (a: AssetRow, k: string) => str(a.details?.[k]);
  const realEstate = by('REAL_ESTATE');
  const borrowings = ctx.liabilities.filter((l) => !GUARANTOR.includes(l.role));
  const guarantees = ctx.liabilities.filter((l) => GUARANTOR.includes(l.role));
  const assetById = new Map(ctx.assets.map((a) => [a.id, a]));
  const graphType = (a: AssetRow) => (a.category === 'REAL_ESTATE' || a.category === 'BUSINESS_INTEREST' ? 'ASSET' : a.category === 'DEPOSIT' || a.category === 'CASH' ? 'BANK' : 'PROFILE');
  const edges: GraphEdge[] = ctx.assets.filter((a) => a.status === 'ACTIVE').map((a) => ({ toType: graphType(a), toId: a.id, toLabel: a.title, relation: `${a.ownership_scope}${a.category === 'REAL_ESTATE' ? ' PROPERTY' : a.category === 'BUSINESS_INTEREST' ? ' BUSINESS' : ` ${a.category}`}`, status: RELIABLE_EVIDENCE.includes(a.evidence_class) ? 'CONFIRMED' : 'POSSIBLE', sourceKey: a.source_key, tier: RELIABLE_EVIDENCE.includes(a.evidence_class) ? 1 : 3, confidence: CONF_NUM[a.confidence] ?? null }));
  const chains = [
    ...ctx.liabilities.filter((l) => l.linked_asset_id).map((l) => ({ asset: assetById.get(l.linked_asset_id ?? '')?.title ?? 'Unknown asset', liability: l, key: `l-${l.id}` })),
    ...ctx.assets.filter((a) => a.linked_liability_id && !ctx.liabilities.some((l) => l.linked_asset_id === a.id)).map((a) => ({ asset: a.title, liability: ctx.liabilities.find((l) => l.id === a.linked_liability_id) ?? null, key: `a-${a.id}` })),
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-400">Registered transaction values, official guideline values and estimated market values are always shown as separate bases and never averaged. Possible associations are greyed and never counted.</p>
      <Panel title={`Real estate & land (${realEstate.length})`} right={<Badge tone="muted">Valuation bases kept separate</Badge>}>
        <AssetTable rows={realEstate} canWrite={canWrite} possibleNote extra={[['City / survey', (a) => <>{d(a, 'city') ?? '-'}{d(a, 'survey_number') ? <div className="text-ink-400">Sy. {d(a, 'survey_number')}</div> : null}{d(a, 'registration_ref') ? <div className="text-ink-400">Reg. {d(a, 'registration_ref')}</div> : null}</>], ['Type / extent', (a) => <>{a.subtype ?? '-'}{d(a, 'extent') ? <div className="text-ink-400">{d(a, 'extent')}</div> : null}{a.details?.rental ? <Badge tone="info">rental</Badge> : null}</>]]} />
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Business interests (${by('BUSINESS_INTEREST').length})`}>
          <AssetTable rows={by('BUSINESS_INTEREST')} canWrite={canWrite} possibleNote extra={[['CIN / role', (a) => <>{d(a, 'cin') ? <span className="mono">{d(a, 'cin')}</span> : '-'}{d(a, 'role') ? <div className="text-ink-400">{d(a, 'role')}</div> : null}{d(a, 'shareholding') ? <div className="text-ink-400">Holding {d(a, 'shareholding')}</div> : null}</>]]} />
        </Panel>
        <Panel title={`Investments (${by('MUTUAL_FUND', 'SECURITY', 'DEPOSIT', 'FINANCIAL_INVESTMENT', 'CASH').length})`}>
          <AssetTable rows={by('MUTUAL_FUND', 'SECURITY', 'DEPOSIT', 'FINANCIAL_INVESTMENT', 'CASH')} canWrite={canWrite} extra={[['Instrument', (a) => <>{a.category.replace(/_/g, ' ')}{d(a, 'amc') ? <div className="text-ink-400">{d(a, 'amc')}</div> : null}{d(a, 'scheme') ? <div className="text-ink-400">{d(a, 'scheme')}</div> : null}{d(a, 'folio') ? <div className="mono text-ink-400">{d(a, 'folio')}</div> : null}{d(a, 'maturity_on') ? <div className="text-ink-400">Matures {formatDate(d(a, 'maturity_on'))}</div> : null}</>]]} />
        </Panel>
        <Panel title={`Retirement & insurance (${by('RETIREMENT', 'INSURANCE').length})`}>
          <AssetTable rows={by('RETIREMENT', 'INSURANCE')} canWrite={canWrite} extra={[['Kind', (a) => <>{a.category.replace(/_/g, ' ')}{d(a, 'maturity_on') ? <div className="text-ink-400">Matures {formatDate(d(a, 'maturity_on'))}</div> : null}</>]]} />
        </Panel>
        <Panel title={`Vehicles (${by('VEHICLE').length})`} right={<span className="text-[11px] text-ink-400">Possible associations shown greyed</span>}>
          <AssetTable rows={by('VEHICLE')} canWrite={canWrite} possibleNote extra={[['Make / model', (a) => <>{[d(a, 'make'), d(a, 'model')].filter(Boolean).join(' ') || '-'}{d(a, 'registration_no') ? <div className="mono text-ink-400">{d(a, 'registration_no')}</div> : null}{d(a, 'finance') ? <div className="text-ink-400">Finance: {d(a, 'finance')}</div> : null}</>]]} />
        </Panel>
        <Panel title={`Luxury, collectibles & other (${by('LUXURY', 'OTHER').length})`} className="xl:col-span-2">
          <AssetTable rows={by('LUXURY', 'OTHER')} canWrite={canWrite} possibleNote extra={[['Category', (a) => a.category.replace(/_/g, ' ')]]} />
        </Panel>
      </div>

      <Panel title={`Liabilities register (${borrowings.length})`} right={<span className="text-[11px] text-ink-400">Borrower / co-borrower only - guarantees below</span>}>
        <LiabilityTable rows={borrowings} />
      </Panel>
      <Panel title={`Guarantees & director guarantees (${guarantees.length})`} right={<Badge tone="gold">Contingent - not personal debt</Badge>}>
        <LiabilityTable rows={guarantees} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Family links (${ctx.family.length})`} right={<Badge tone="declared">Separate from personal wealth</Badge>}>
          {ctx.family.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Name</th><th>Relation</th><th>Evidence</th><th>Confidence</th><th>Entitlement</th></tr></thead>
                <tbody>
                  {ctx.family.map((f) => (
                    <tr key={f.id}><td className="font-medium">{f.name}</td><td>{f.relation.replace(/_/g, ' ')}</td><td><EvidenceBadge kind={f.evidence_class} /></td><td><ConfidenceBadge level={f.confidence} /></td><td className="text-xs">{(f.entitlement ?? 'NONE_KNOWN').replace(/_/g, ' ')}{f.note ? <div className="text-ink-400">{f.note}</div> : null}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No family links recorded.</Empty>
          )}
          {canWrite ? <div className="mt-4 border-t border-white/[0.06] pt-3"><AddFamilyLinkForm clientId={id} /></div> : null}
        </Panel>
        <Panel title={`Wealth timeline (${ctx.events.length})`}>
          <Timeline items={ctx.events.map((e) => ({ at: e.occurred_on, title: e.title, detail: `${e.event_type.replace(/_/g, ' ')}${num(e.amount) !== null ? ` - INR ${cr(num(e.amount) ?? 0)}` : ' - amount not available'}`, tone: e.event_type.includes('LOAN') ? 'warn' : e.event_type.includes('ACQUIRED') || e.event_type.includes('INHERIT') ? 'gold' : 'neutral', meta: <><EvidenceBadge kind={e.evidence_class} /><SourceTag sourceKey={e.source_key} /></> }))} />
          {canWrite ? <div className="mt-4 border-t border-white/[0.06] pt-3"><AddWealthEventForm clientId={id} /></div> : null}
        </Panel>
      </div>

      <Panel title="Asset ownership graph" right={<span className="text-[11px] text-ink-400">Solid = official / authorised evidence - dashed = declared, estimated or possible</span>}>
        {edges.length ? <RelationshipGraph center={ctx.displayName} edges={edges} /> : <Empty>No active assets to map.</Empty>}
        <h4 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">Property - mortgage - bank chains</h4>
        {chains.length ? (
          <ul className="space-y-1 text-sm">
            {chains.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-2 rounded border border-white/[0.06] px-3 py-1.5">
                <span className="font-medium text-ink-100">{c.asset}</span><span className="text-ink-500">-&gt;</span>
                <span className="text-amber-300">{c.liability ? c.liability.liability_type.replace(/_/g, ' ') : 'Linked liability not found'}</span><span className="text-ink-500">-&gt;</span>
                <span className="text-ink-200">{c.liability?.lender ?? 'Lender not available'}</span>
                {c.liability ? <span className="mono text-xs text-ink-300">{num(c.liability.outstanding) !== null ? `outstanding INR ${cr(num(c.liability.outstanding) ?? 0)}` : 'outstanding not available'}</span> : null}
                {c.liability ? <EvidenceBadge kind={c.liability.evidence_class} short /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-400">No property-to-mortgage links recorded.</p>
        )}
      </Panel>

      {canWrite ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Add asset" right={<Badge tone="muted">Analyst entry</Badge>}><AddAssetForm clientId={id} canVerify={canVerify} /></Panel>
          <Panel title="Add liability" right={<Badge tone="muted">Analyst entry</Badge>}><AddLiabilityForm clientId={id} realEstate={realEstate.map((a) => ({ id: a.id, title: a.title }))} /></Panel>
        </div>
      ) : (
        <p className="text-xs text-ink-400">Your role can view the register but not add records.</p>
      )}
    </div>
  );
}
