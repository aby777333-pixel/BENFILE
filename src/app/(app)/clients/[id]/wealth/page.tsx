import { loadClient } from '@/lib/db/load-client';
import { loadIntelligence } from '@/lib/wealth/load-context';
import { computeWealth, cr, type DebtServiceMetrics, type MetricValue, type NetWorthComponent, type ValueRange } from '@/lib/wealth/wealth-engine';
import { hasPermission } from '@/lib/security/permissions';
import { formatDate, formatDateTime } from '@/lib/engines/normalize';
import { Panel, Stat, Empty, Kv, NotAvailable } from '@/components/ui/panel';
import { Badge, EvidenceBadge, ConfidenceBadge, SourceTag, StatusBadge } from '@/components/ui/badges';
import { ActionForm } from '@/components/ui/action-form';
import { Gauge, CREDIT_BANDS } from '@/components/charts/gauge';
import { CompositionChart, ScoreHistoryChart, CashFlowChart, HorizontalBars } from '@/components/wealth/composition-chart';
import { ingestBureauReport, ingestCashFlow, addFundSource } from '@/lib/actions-wealth';
import type { BankRelationshipRow, BureauReportRow, CashFlowRow, FundSourceRow } from '@/lib/wealth/types';

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const inr = (v: number | null | undefined) => (v === null || v === undefined ? <NotAvailable /> : <span className="mono">INR {cr(v)}</span>);
const rangeText = (r: ValueRange | null) => (r ? (Math.abs(r.high - r.low) / Math.max(Math.abs(r.mid), 1) > 0.05 ? `INR ${cr(r.low)} - ${cr(r.high)}` : `INR ${cr(r.mid)}`) : null);
const count = (v: number | null) => (v === null ? <NotAvailable label="Not returned" /> : <span className="mono">{v}</span>);
const metricTone = (s: MetricValue['status']) => (s === 'OK' ? 'good' : s === 'WATCH' ? 'warn' : s === 'ELEVATED' ? 'bad' : 'muted');

export default async function WealthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, db } = await loadClient(id, 'wealth');
  const bundle = await loadIntelligence(db, id);
  const { ctx } = bundle;
  const w = computeWealth({ assets: ctx.assets, liabilities: ctx.liabilities, bureau: ctx.bureau, cashFlow: ctx.cashFlow, banks: ctx.banks, incomeAnnual: ctx.verified.incomeAnnual, incomeEvidence: ctx.verified.incomeEvidence });
  const canIngest = hasPermission(role, 'verification:ingest');
  const canWrite = hasPermission(role, 'clients:write');
  const p = w.personal;
  const nw = p.netWorth;
  const hni = w.hniIndicator;

  return (
    <div className="space-y-4">
      <Panel title="Executive wealth summary" right={<span className="text-[11px] text-ink-400">Engine {w.engineVersion} - computed {formatDateTime(w.computedAt)} - family-linked wealth excluded</span>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <Stat label="Estimated net worth" tone={nw.range ? 'gold' : 'muted'} value={rangeText(nw.range) ?? 'Insufficient verified information'} sub={<span className="flex flex-wrap gap-1"><ConfidenceBadge level={nw.confidence} /><Badge tone="muted">{Math.round(nw.coverage * 100)}% assets valued</Badge></span>} />
          <Stat label="Liquid net worth" value={rangeText(p.liquidNetWorth.range) ?? 'Not available'} sub={<ConfidenceBadge level={p.liquidNetWorth.confidence} />} />
          <Stat label="Investable assets" value={rangeText(p.investableAssets.range) ?? 'Not available'} sub={<ConfidenceBadge level={p.investableAssets.confidence} />} />
          <Stat label="Total liabilities" tone={p.totalLiabilities.value ? 'warn' : undefined} value={p.totalLiabilities.value === null ? 'Not available' : `INR ${cr(p.totalLiabilities.value)}`} sub={<ConfidenceBadge level={p.totalLiabilities.confidence} />} />
          <Stat label="Monthly debt obligations" value={p.monthlyObligations.value === null ? 'Not available' : `INR ${cr(p.monthlyObligations.value)}`} sub={<ConfidenceBadge level={p.monthlyObligations.confidence} />} />
          <Stat label="Credit score" value={ctx.bureau?.score ?? ctx.verified.creditScore ?? 'Not available'} sub={ctx.bureau ? <span className="flex gap-1"><EvidenceBadge kind={ctx.bureau.evidence_class} short /><span>{ctx.bureau.bureau} {formatDate(ctx.bureau.report_date)}</span></span> : ctx.verified.creditScore !== null ? 'Verification run score - no bureau report' : 'No bureau data'} />
          <Stat label="Data coverage" tone={w.coverage.overall >= 70 ? 'good' : w.coverage.overall >= 40 ? 'warn' : 'muted'} value={`${w.coverage.overall}%`} sub="Across 8 domains" />
          <Stat label="Last refresh" value={formatDate(ctx.bureau?.retrieved_at ?? w.computedAt)} sub={ctx.bureau ? 'Latest bureau retrieval' : 'Engine run (no bureau)'} />
          <Stat label="HNI indicator" tone={hni.qualifies === true ? 'gold' : hni.qualifies === false ? 'muted' : 'muted'} value={hni.qualifies === true ? 'Qualifies' : hni.qualifies === false ? 'Does not qualify' : 'Not assessed'} sub={<EvidenceBadge kind={hni.qualifies === null ? 'INSUFFICIENT_DATA' : 'DERIVED_ESTIMATE'} short />} />
          <Stat label="Verified value share" tone={p.verifiedValueShare >= 0.6 ? 'good' : 'warn'} value={`${Math.round(p.verifiedValueShare * 100)}%`} sub={`Estimated ${Math.round(p.estimatedValueShare * 100)}% - declared ${Math.round(p.declaredValueShare * 100)}%`} />
        </div>
        <div className="mt-4 space-y-1 border-t border-white/[0.06] pt-3 text-xs text-ink-300">
          <p><EvidenceBadge kind="DERIVED_ESTIMATE" short /> {nw.statement}</p>
          <p><EvidenceBadge kind="DERIVED_ESTIMATE" short /> {p.liquidNetWorth.statement}</p>
          <p><EvidenceBadge kind="DERIVED_ESTIMATE" short /> {p.investableAssets.statement}</p>
          <p><Badge tone="gold">HNI basis</Badge> {hni.basis}</p>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="Wealth composition (personal, mid values)" className="xl:col-span-3" right={<EvidenceBadge kind="DERIVED_ESTIMATE" />}>
          <CompositionChart slices={p.composition} verifiedShare={p.verifiedValueShare} estimatedShare={p.estimatedValueShare} declaredShare={p.declaredValueShare} />
        </Panel>
        <Panel title="Data coverage by domain" className="xl:col-span-2" right={<Badge tone="muted">{w.coverage.overall}% overall</Badge>}>
          <HorizontalBars data={w.coverage.domains.map((d) => ({ label: d.label, value: d.pct }))} unit="%" max={100} />
          <ul className="mt-2 space-y-0.5 text-[11px] text-ink-400">
            {w.coverage.domains.map((d) => (
              <li key={d.key}><span className="text-ink-300">{d.label}:</span> {d.basis}</li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Net-worth components" right={<span className="text-[11px] text-ink-400">Ranges, not point estimates - each row carries its evidence class</span>}>
        <ComponentsTable components={p.components} />
      </Panel>

      <Panel title="Client capital map" right={<EvidenceBadge kind="DERIVED_ESTIMATE" />}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {w.capitalMap.map((b) => (
            <div key={b.key} className={`rounded-lg border p-3 ${b.key === 'UNKNOWN' ? 'border-dashed border-white/10' : 'border-white/[0.06] bg-ink-900'}`}>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">{b.label}</div>
              <div className={`mt-1 text-base font-semibold ${b.key === 'LIQUID_NOW' ? 'text-emerald-300' : b.key === 'LEVERAGED' ? 'text-amber-300' : 'text-ink-100'}`}>{rangeText(b.range) ?? (b.key === 'UNKNOWN' ? 'Not counted' : 'Not available')}</div>
              <p className="mt-1 text-[11px] text-ink-400">{b.note}</p>
              {b.items.length ? (
                <ul className="mt-2 space-y-0.5 text-xs text-ink-200">
                  {b.items.slice(0, 6).map((it, i) => (
                    <li key={i} className="truncate">- {it}</li>
                  ))}
                  {b.items.length > 6 ? <li className="text-ink-400">+{b.items.length - 6} more</li> : null}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-ink-500">Nothing recorded.</p>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Debt service & financial pressure" right={w.debtService.available ? <EvidenceBadge kind="DERIVED_ESTIMATE" /> : <Badge tone="muted">Inputs missing</Badge>}>
        <DebtServiceGrid m={w.debtService} />
      </Panel>

      <CreditConsole bureau={ctx.bureau} runScore={ctx.verified.creditScore} clientId={id} canIngest={canIngest} />

      <CashFlowPanel cashFlow={ctx.cashFlow} banks={ctx.banks} clientId={id} canIngest={canIngest} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Family-linked wealth (shown separately)" right={<Badge tone="declared">Not in personal net worth</Badge>}>
          <p className="mb-3 text-xs text-ink-300">{w.familyLinked.statement}</p>
          {w.familyLinked.components.length ? <ComponentsTable components={w.familyLinked.components} /> : <Empty>No family-linked assets recorded.</Empty>}
          {w.familyLinked.range ? <p className="mt-2 text-xs text-ink-400">Family-linked total {rangeText(w.familyLinked.range)}. Family-linked wealth is never added to personal net worth; it can only contribute with evidence of beneficial ownership, inheritance entitlement or trust interest.</p> : null}
        </Panel>
        <Panel title="Possible associations (require corroboration)" right={<EvidenceBadge kind="POSSIBLE_ASSOCIATION" />}>
          <p className="mb-3 text-xs text-ink-300">{w.possibleAssociations.statement} A possible association is a name or record match that has not been tied to the client by an official record or authorised data; it never contributes to any figure on this page.</p>
          {w.possibleAssociations.titles.length ? (
            <ul className="space-y-1 text-sm">
              {w.possibleAssociations.titles.map((t, i) => (
                <li key={i} className="flex items-center justify-between rounded border border-dashed border-white/10 px-3 py-1.5 text-ink-300">
                  <span>{t}</span>
                  <Badge tone="warn">requires corroboration</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No possible associations recorded.</Empty>
          )}
        </Panel>
      </div>

      <FundSourcesPanel sources={ctx.fundSources} clientId={id} canWrite={canWrite} />
    </div>
  );
}

function ComponentsTable({ components }: { components: NetWorthComponent[] }) {
  if (!components.length) return <Empty>No assets recorded. Nothing is inferred.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr><th>Component</th><th>Items</th><th>Range (low / mid / high)</th><th>Confidence</th><th>Evidence</th><th>Verified share</th><th>Basis</th></tr>
        </thead>
        <tbody>
          {components.map((c) => (
            <tr key={c.key} className={c.category === 'LIABILITY' ? 'bg-danger/5' : ''}>
              <td className="font-medium">{c.label}</td>
              <td className="mono">{c.count}</td>
              <td className="mono text-xs">{c.range ? `${cr(c.range.low)} / ${cr(c.range.mid)} / ${cr(c.range.high)}` : <NotAvailable label="Not valued" />}</td>
              <td><ConfidenceBadge level={c.confidence} /></td>
              <td><EvidenceBadge kind={c.evidenceClass} /></td>
              <td className="mono text-xs">{c.range ? `${Math.round(c.verifiedShare * 100)}%` : '-'}</td>
              <td className="text-xs text-ink-300">{c.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DebtServiceGrid({ m }: { m: DebtServiceMetrics }) {
  const rows: Array<[keyof Omit<DebtServiceMetrics, 'available'>, string]> = [['dti', 'Debt-to-income'], ['emiToIncome', 'EMI-to-income'], ['utilization', 'Credit utilisation'], ['securedVsUnsecured', 'Secured vs unsecured'], ['concentration', 'Lender concentration'], ['recentBorrowing', 'Recent borrowing'], ['paymentStress', 'Payment stress']];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map(([k, label]) => {
        const v = m[k];
        return (
          <div key={k} className="rounded-lg border border-white/[0.06] bg-ink-900 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider text-ink-400">{label}</span>
              <Badge tone={metricTone(v.status)}>{v.status.replace('_', ' ')}</Badge>
            </div>
            <div className={`mt-1 text-sm font-semibold ${v.status === 'NOT_AVAILABLE' ? 'text-ink-400' : 'text-ink-100'}`}>{v.display}</div>
            <p className="mt-1 text-[11px] text-ink-300">{v.basis}</p>
            {v.missing?.length ? <p className="mt-1 text-[11px] text-amber-300/80">Missing: {v.missing.join(', ')}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function CreditConsole({ bureau, runScore, clientId, canIngest }: { bureau: BureauReportRow | null; runScore: number | null; clientId: string; canIngest: boolean }) {
  const ingestForm = canIngest ? (
    <ActionForm action={ingestBureauReport} className="mt-3 space-y-2">
      <input type="hidden" name="clientId" value={clientId} />
      <label className="label">Paste bureau report JSON (bureau, score, report_date, accounts[], enquiries[], dpd counts ...)</label>
      <textarea name="json" className="input font-mono text-xs" rows={4} required placeholder='{"bureau":"CIBIL","score":762,"report_date":"2026-08-01","accounts":[...]}' />
      <button className="btn btn-primary btn-sm" type="submit">Ingest bureau report</button>
    </ActionForm>
  ) : null;
  if (!bureau) {
    return (
      <Panel title="Credit health console" right={<Badge tone="muted">No bureau report</Badge>}>
        <div className="grid gap-4 md:grid-cols-[200px_1fr]">
          <Gauge value={runScore} min={300} max={900} label="Credit score" sublabel={runScore === null ? 'Not available' : 'Verification run'} bands={CREDIT_BANDS} />
          <div>
            <p className="text-sm text-ink-100">{runScore === null ? 'No credit score has been returned by any source.' : `The verification run returned a score of ${runScore}.`}</p>
            <p className="mt-1 text-xs text-ink-400">Not reduced to a single score - bureau report required for credit age, accounts, utilisation, DPD history, enquiries and write-offs.</p>
            {ingestForm}
          </div>
        </div>
      </Panel>
    );
  }
  const accounts = Array.isArray(bureau.accounts) ? bureau.accounts : [];
  const enquiries = Array.isArray(bureau.enquiries) ? bureau.enquiries : [];
  const util = num(bureau.utilization);
  return (
    <Panel title="Credit health console" right={<span className="flex gap-1.5"><EvidenceBadge kind={bureau.evidence_class} /><SourceTag sourceKey={bureau.source_key} /></span>}>
      <div className="grid gap-4 xl:grid-cols-[200px_1fr_1fr_1fr]">
        <div>
          <Gauge value={num(bureau.score)} min={300} max={900} label={bureau.bureau} sublabel={formatDate(bureau.report_date)} bands={CREDIT_BANDS} />
          {runScore !== null && runScore !== num(bureau.score) ? <p className="mt-1 text-[11px] text-ink-400">Verification-run score {runScore} differs from bureau {bureau.bureau}. Both shown; neither is adjusted.</p> : null}
          <ScoreHistoryChart history={Array.isArray(bureau.score_history) ? bureau.score_history : []} />
        </div>
        <Kv rows={[['Credit age', num(bureau.credit_age_months) !== null ? `${Math.floor((num(bureau.credit_age_months) ?? 0) / 12)} yr ${(num(bureau.credit_age_months) ?? 0) % 12} mo` : null], ['Accounts total', count(num(bureau.total_accounts))], ['Active', count(num(bureau.active_accounts))], ['Closed', count(num(bureau.closed_accounts))], ['Secured loans', count(num(bureau.secured_loans))], ['Unsecured loans', count(num(bureau.unsecured_loans))], ['Credit cards', count(num(bureau.credit_cards))], ['Oldest account', formatDate(bureau.oldest_account_on)], ['Newest account', formatDate(bureau.newest_account_on)]]} />
        <Kv rows={[['Sanctioned', inr(num(bureau.sanctioned_total))], ['Outstanding', inr(num(bureau.outstanding_total))], ['Utilisation', util === null ? null : <Badge key="u" tone={util > 0.7 ? 'bad' : util > 0.4 ? 'warn' : 'good'}>{Math.round(util * 100)}%</Badge>], ['Total EMI', inr(num(bureau.emi_total))], ['Enquiries 6m', count(num(bureau.enquiries_6m))], ['Enquiries 12m', count(num(bureau.enquiries_12m))]]} />
        <Kv rows={[['DPD 30 / 60 / 90+', <span key="d" className="mono">{num(bureau.dpd_30_count) ?? '-'} / {num(bureau.dpd_60_count) ?? '-'} / {num(bureau.dpd_90_count) ?? '-'}</span>], ['Missed payments 12m', count(num(bureau.missed_payments_12m))], ['Write-offs', count(num(bureau.write_offs))], ['Settlements', count(num(bureau.settlements))], ['Defaults', count(num(bureau.defaults))], ['Restructured', count(num(bureau.restructured))]]} />
      </div>
      <h4 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">Accounts ({accounts.length})</h4>
      {accounts.length ? (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Type</th><th>Lender</th><th>Secured</th><th>Opened</th><th>Status</th><th>Sanctioned</th><th>Outstanding</th><th>EMI</th><th>DPD</th></tr></thead>
            <tbody>
              {accounts.map((a, i) => (
                <tr key={i}>
                  <td>{String(a.type ?? '-').replace(/_/g, ' ')}</td>
                  <td>{a.lender || '-'}</td>
                  <td>{a.secured ? <Badge tone="good">Secured</Badge> : <Badge tone="muted">Unsecured</Badge>}</td>
                  <td className="text-xs">{formatDate(a.opened)}</td>
                  <td><StatusBadge status={String(a.status ?? 'UNKNOWN')} /></td>
                  <td>{inr(num(a.sanctioned))}</td>
                  <td>{inr(num(a.outstanding))}</td>
                  <td>{inr(num(a.emi))}</td>
                  <td>{num(a.dpd) ? <Badge tone={(num(a.dpd) ?? 0) >= 90 ? 'bad' : 'warn'}>{num(a.dpd)} DPD</Badge> : <Badge tone="good">0</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Bureau returned no account-level detail.</Empty>
      )}
      <h4 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">Enquiries ({enquiries.length})</h4>
      {enquiries.length ? (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Date</th><th>Lender</th><th>Purpose</th></tr></thead>
            <tbody>
              {enquiries.map((e, i) => (
                <tr key={i}><td className="text-xs">{formatDate(e.date)}</td><td>{e.lender || '-'}</td><td>{e.purpose || '-'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No enquiries returned.</Empty>
      )}
      {ingestForm}
    </Panel>
  );
}

function CashFlowPanel({ cashFlow, banks, clientId, canIngest }: { cashFlow: CashFlowRow[]; banks: BankRelationshipRow[]; clientId: string; canIngest: boolean }) {
  const points = cashFlow.map((c) => ({ period: c.period, inflows: c.inflows, outflows: c.outflows, savings: c.inflows !== null && c.outflows !== null ? c.inflows - c.outflows : null, investment: c.investment_transfers, debt: c.debt_payments }));
  const cats = new Map<string, number>();
  for (const c of cashFlow) for (const [k, v] of Object.entries(c.categories ?? {})) cats.set(k, (cats.get(k) ?? 0) + (num(v) ?? 0));
  const catData = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label: label.replace(/_/g, ' '), value }));
  const flat = (key: 'large_inflows' | 'large_outflows') => cashFlow.flatMap((c) => (Array.isArray(c[key]) ? c[key] : []).map((x) => ({ ...x, amount: num(x.amount) ?? 0, period: c.period }))).sort((a, b) => b.amount - a.amount).slice(0, 8);
  const salaries = cashFlow.map((c) => c.salary_credits).filter((v): v is number => v !== null && v > 0);
  const mean = salaries.length ? salaries.reduce((s, v) => s + v, 0) / salaries.length : null;
  const cv = mean && salaries.length > 1 ? Math.sqrt(salaries.reduce((s, v) => s + (v - mean) ** 2, 0) / salaries.length) / mean : null;
  const consistency = !cashFlow.length ? null : salaries.length === 0 ? 'No salary credits identified' : `${salaries.length}/${cashFlow.length} months with salary credits; mean INR ${cr(mean ?? 0)}${cv !== null ? `; variation ${Math.round(cv * 100)}% (${cv < 0.1 ? 'stable' : cv < 0.3 ? 'moderately variable' : 'irregular'})` : ''}`;
  const form = canIngest ? (
    <ActionForm action={ingestCashFlow} className="mt-4 space-y-3 border-t border-white/[0.06] pt-3">
      <input type="hidden" name="clientId" value={clientId} />
      <p className="text-[11px] text-ink-400">Requires a GRANTED consent that authorises BANKING. Periods are stored as authorised third-party data under that consent.</p>
      <textarea name="json" className="input font-mono text-xs" rows={3} required placeholder='[{"period":"2026-07","inflows":...,"outflows":...,"salary_credits":...,"categories":{...}}]' />
      <div className="grid gap-3 md:grid-cols-6">
        <div><label className="label">Source key</label><input name="sourceKey" className="input" defaultValue="AA" /></div>
        <div><label className="label">Bank name</label><input name="bankName" className="input" placeholder="Optional" /></div>
        <div><label className="label">Account type</label><input name="accountType" className="input" placeholder="SAVINGS" /></div>
        <div><label className="label">Balance</label><input name="balance" type="number" className="input" /></div>
        <div><label className="label">Avg balance</label><input name="avgBalance" type="number" className="input" /></div>
        <div><label className="label">Balance date</label><input name="balanceDate" type="date" className="input" /></div>
      </div>
      <button className="btn btn-primary btn-sm" type="submit">Ingest cash flow</button>
    </ActionForm>
  ) : null;
  return (
    <Panel title="Cash-flow intelligence & bank relationships" right={cashFlow.length ? <span className="flex gap-1.5"><EvidenceBadge kind={cashFlow[0].evidence_class} /><SourceTag sourceKey={cashFlow[0].source_key} /></span> : <Badge tone="muted">No consented banking data</Badge>}>
      {cashFlow.length ? (
        <>
          <CashFlowChart points={points} />
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">Category allocation (all periods)</h4>
              <HorizontalBars data={catData} unit="INR" />
            </div>
            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">Large inflows</h4>
              <FlowList items={flat('large_inflows')} tone="text-emerald-300" />
            </div>
            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">Large outflows</h4>
              <FlowList items={flat('large_outflows')} tone="text-red-300" />
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-300"><EvidenceBadge kind="DERIVED_ESTIMATE" short /> Income consistency: {consistency}. Returned transactions: {cashFlow.reduce((s, c) => s + (c.returned_transactions ?? 0), 0)}.</p>
        </>
      ) : (
        <Empty>No cash-flow periods. Cash-flow intelligence requires consented banking data (account aggregator or statements).</Empty>
      )}
      <h4 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">Bank relationships ({banks.length})</h4>
      {banks.length ? (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Bank</th><th>Account type</th><th>Balance</th><th>Avg monthly balance</th><th>As of</th><th>Evidence</th></tr></thead>
            <tbody>
              {banks.map((b, i) => (
                <tr key={i}><td className="font-medium">{b.bank_name}</td><td>{b.account_type ?? '-'}</td><td>{inr(b.balance)}</td><td>{inr(b.avg_monthly_balance)}</td><td className="text-xs">{formatDate(b.balance_date)}</td><td><EvidenceBadge kind={b.evidence_class} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-ink-400">No bank relationships recorded.</p>
      )}
      {form}
    </Panel>
  );
}

function FlowList({ items, tone }: { items: Array<{ date: string; amount: number; label: string; period: string }>; tone: string }) {
  if (!items.length) return <p className="text-xs text-ink-400">None flagged.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {items.map((x, i) => (
        <li key={i} className="flex items-center justify-between gap-2 rounded border border-white/[0.06] px-2 py-1">
          <span className="truncate text-ink-200">{x.label || 'Unlabelled'} <span className="text-ink-500">{formatDate(x.date)}</span></span>
          <span className={`mono shrink-0 ${tone}`}>INR {cr(x.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

function FundSourcesPanel({ sources, clientId, canWrite }: { sources: FundSourceRow[]; clientId: string; canWrite: boolean }) {
  return (
    <Panel title="Source of funds / source of wealth" right={<Badge tone="declared">Declared until evidenced</Badge>}>
      {sources.length ? (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Kind</th><th>Category</th><th>Description</th><th>Amount</th><th>Evidence</th><th>Status</th></tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}><td><Badge tone={s.kind === 'SOURCE_OF_WEALTH' ? 'gold' : 'info'}>{s.kind.replace(/_/g, ' ')}</Badge></td><td>{s.category.replace(/_/g, ' ')}</td><td className="text-ink-300">{s.description ?? '-'}</td><td>{inr(num(s.amount))}</td><td><EvidenceBadge kind={s.evidence_class} /></td><td><StatusBadge status={s.status} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No source-of-funds or source-of-wealth declarations recorded.</Empty>
      )}
      {canWrite ? (
        <ActionForm action={addFundSource} className="mt-4 grid gap-3 border-t border-white/[0.06] pt-3 md:grid-cols-5">
          <input type="hidden" name="clientId" value={clientId} />
          <div><label className="label">Kind</label><select name="kind" className="input"><option value="SOURCE_OF_FUNDS">Source of funds</option><option value="SOURCE_OF_WEALTH">Source of wealth</option></select></div>
          <div><label className="label">Category</label><select name="category" className="input">{['SALARY', 'BUSINESS_INCOME', 'PROPERTY_SALE', 'INHERITANCE', 'GIFT', 'INVESTMENT_RETURNS', 'RENTAL_INCOME', 'LOAN', 'SAVINGS', 'OTHER'].map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select></div>
          <div><label className="label">Description</label><input name="description" className="input" /></div>
          <div><label className="label">Amount (INR)</label><input name="amount" type="number" min={0} className="input" /></div>
          <div className="flex items-end"><button className="btn btn-sm" type="submit">Record declaration</button></div>
        </ActionForm>
      ) : null}
    </Panel>
  );
}
