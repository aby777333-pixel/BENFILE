import Link from 'next/link';
import { AIF_STAGES } from '@/lib/wealth/aif-stages';
import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/db/server';
import { hasPermission } from '@/lib/security/permissions';
import { updateComplianceRule, updateFreshnessWindow } from '@/lib/actions-ops';
import { cr } from '@/lib/wealth/wealth-engine';
import { formatDate, formatDateTime } from '@/lib/engines/normalize';
import { Panel, Empty, Stat } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badges';
import { ActionForm } from '@/components/ui/action-form';

export const dynamic = 'force-dynamic';

/**
 * Mirrors AIF_STAGES in src/components/client360/aif-journey.tsx. That module is 'use client'; importing a
 * non-component export from it into a server page yields a client-reference proxy, not the array
 * (the same reason management/page.tsx keeps a local copy). Keep the two lists in sync.
 */

type Numeric = string | number | null;
interface FundRow {
  id: string;
  name: string;
  category: string;
  strategy: string | null;
  thesis: string | null;
  min_commitment: Numeric;
  lock_in_years: Numeric;
  tenure_years: Numeric;
  target_size: Numeric;
  fees: Record<string, unknown> | null;
  risk_factors: string[] | null;
  status: string;
  closing_date: string | null;
  documents: unknown[] | null;
}
interface JourneyRow {
  client_id: string;
  stage: string;
  investor_classification: string | null;
  risk_profile: string | null;
  expected_amount: Numeric;
  kyc_status: string;
  aml_status: string;
  sanctions_status: string;
  pep_status: string;
  sof_status: string;
  compliance_approved_at: string | null;
  investment_approved_at: string | null;
  fund_id: string | null;
  updated_at: string;
  clients: { id: string; client_code: string; display_name: string } | Array<{ id: string; client_code: string; display_name: string }> | null;
}
interface RuleRow {
  key: string;
  value: unknown;
  description: string | null;
  version: Numeric;
  is_active: boolean;
  updated_at: string;
}
interface WindowRow {
  data_class: string;
  fresh_days: Numeric;
  stale_days: Numeric;
  expired_days: Numeric;
  description: string | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const inr = (v: number | null) => (v === null ? '-' : `INR ${cr(v)}`);
const screenTone = (s: string) => (s === 'COMPLETE' ? 'good' : s === 'FLAGGED' ? 'bad' : s === 'IN_PROGRESS' ? 'info' : 'muted');
const fundTone = (s: string) => (s === 'OPEN' ? 'good' : s === 'CLOSING' ? 'warn' : s === 'CLOSED' ? 'muted' : 'neutral');
const feeText = (v: unknown) => (typeof v === 'number' ? (v <= 1 ? `${(v * 100).toFixed(2).replace(/\.?0+$/, '')}%` : String(v)) : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

function ScreenBadge({ label, status }: { label: string; status: string }) {
  return (
    <Badge tone={screenTone(status)} title={`${label}: ${status.replace(/_/g, ' ')}`}>
      {label} {status === 'COMPLETE' ? 'ok' : status === 'FLAGGED' ? 'flag' : status === 'IN_PROGRESS' ? 'wip' : 'pending'}
    </Badge>
  );
}

export default async function AifPage() {
  const { db, staff } = await getStaff();
  if (!staff) redirect('/login');

  const [{ data: fundsRaw }, { data: journeyRaw }, { data: rulesRaw }, { data: windowsRaw }] = await Promise.all([
    db.from('aif_funds').select('id,name,category,strategy,thesis,min_commitment,lock_in_years,tenure_years,target_size,fees,risk_factors,status,closing_date,documents').order('name'),
    db.from('aif_suitability').select('client_id,stage,investor_classification,risk_profile,expected_amount,kyc_status,aml_status,sanctions_status,pep_status,sof_status,compliance_approved_at,investment_approved_at,fund_id,updated_at,clients(id,client_code,display_name)').order('updated_at', { ascending: false }),
    db.from('compliance_rules').select('key,value,description,version,is_active,updated_at').order('key'),
    db.from('freshness_windows').select('data_class,fresh_days,stale_days,expired_days,description').order('data_class'),
  ]);

  const funds = (fundsRaw ?? []) as FundRow[];
  const journeys = (journeyRaw ?? []) as JourneyRow[];
  const rules = (rulesRaw ?? []) as RuleRow[];
  const windows = (windowsRaw ?? []) as WindowRow[];
  const fundName = new Map(funds.map((f) => [f.id, f.name]));
  const canConfigure = hasPermission(staff.role, 'scoring:configure');

  const stageCounts = new Map<string, number>();
  for (const j of journeys) stageCounts.set(j.stage, (stageCounts.get(j.stage) ?? 0) + 1);
  const stageIndex = (s: string) => {
    const i = AIF_STAGES.indexOf(s);
    return i === -1 ? AIF_STAGES.length : i;
  };
  const sortedJourneys = [...journeys].sort((a, b) => stageIndex(b.stage) - stageIndex(a.stage) || (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  const pipeline = journeys.reduce((s, j) => s + (num(j.expected_amount) ?? 0), 0);
  const complianceApproved = journeys.filter((j) => j.compliance_approved_at).length;
  const investmentApproved = journeys.filter((j) => j.investment_approved_at).length;
  const flagged = journeys.filter((j) => [j.kyc_status, j.aml_status, j.sanctions_status, j.pep_status, j.sof_status].includes('FLAGGED')).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AIF funds &amp; compliance configuration</h1>
        <p className="text-xs text-ink-400">Fund catalogue, the capital path every investor follows, and the versioned rules that gate each approval. Client codes only - open a client for the full journey.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(
          [
            ['Funds', funds.length, 'muted'],
            ['Open for subscription', funds.filter((f) => f.status === 'OPEN').length, 'good'],
            ['Clients in journey', journeys.length, 'gold'],
            ['Pipeline (expected)', inr(pipeline), 'gold'],
            ['Compliance approved', complianceApproved, complianceApproved ? 'good' : 'muted'],
            ['Screens flagged', flagged, flagged ? 'bad' : 'good'],
          ] as Array<[string, React.ReactNode, 'good' | 'warn' | 'bad' | 'muted' | 'gold']>
        ).map(([label, v, tone]) => (
          <div key={label} className="panel p-3">
            <Stat label={label} value={<span className="mono text-xl">{v}</span>} tone={tone} />
          </div>
        ))}
      </div>

      {/* ---------------- FUNDS ---------------- */}
      <Panel title="AIF funds" right={<Badge tone="muted">{funds.length}</Badge>}>
        {funds.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Fund</th>
                  <th>Category</th>
                  <th>Strategy / thesis</th>
                  <th className="text-right">Min commitment</th>
                  <th className="text-right">Lock-in</th>
                  <th className="text-right">Tenure</th>
                  <th className="text-right">Target size</th>
                  <th>Fees</th>
                  <th>Risk factors</th>
                  <th>Status</th>
                  <th>Closing</th>
                  <th className="text-right">Docs</th>
                  <th className="text-right">Journeys</th>
                </tr>
              </thead>
              <tbody>
                {funds.map((f) => {
                  const fees = Object.entries(f.fees ?? {});
                  const risks = f.risk_factors ?? [];
                  const lock = num(f.lock_in_years);
                  const tenure = num(f.tenure_years);
                  return (
                    <tr key={f.id}>
                      <td className="font-medium">{f.name}</td>
                      <td>
                        <Badge tone="neutral">{f.category.replace(/_/g, ' ')}</Badge>
                      </td>
                      <td className="max-w-[320px] text-xs">
                        <div className="text-ink-200">{f.strategy ?? '-'}</div>
                        {f.thesis ? <div className="mt-0.5 text-ink-400">{f.thesis}</div> : null}
                      </td>
                      <td className="mono text-right">{inr(num(f.min_commitment))}</td>
                      <td className="mono text-right text-ink-300">{lock !== null ? `${lock} yr` : '-'}</td>
                      <td className="mono text-right text-ink-300">{tenure !== null ? `${tenure} yr` : '-'}</td>
                      <td className="mono text-right text-ink-300">{inr(num(f.target_size))}</td>
                      <td>
                        {fees.length ? (
                          <div className="flex flex-wrap gap-1">
                            {fees.map(([k, v]) => (
                              <Badge key={k} tone="muted">
                                {k.replace(/_/g, ' ')}: {feeText(v)}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-ink-500">-</span>
                        )}
                      </td>
                      <td>
                        {risks.length ? (
                          <div className="flex max-w-[280px] flex-wrap gap-1">
                            {risks.map((r) => (
                              <Badge key={r} tone="warn">
                                {r.replace(/_/g, ' ')}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-ink-500">-</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={fundTone(f.status)}>{f.status}</Badge>
                      </td>
                      <td className="text-xs text-ink-300">{f.closing_date ? formatDate(f.closing_date) : '-'}</td>
                      <td className="mono text-right">{Array.isArray(f.documents) ? f.documents.length : 0}</td>
                      <td className="mono text-right">{journeys.filter((j) => j.fund_id === f.id).length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No funds configured.</Empty>
        )}
      </Panel>

      {/* ---------------- CAPITAL PATH ---------------- */}
      <Panel title="AIF capital path" right={<Badge tone="muted">{journeys.length} clients</Badge>}>
        <div className="overflow-x-auto pb-1">
          <ol className="flex min-w-max items-stretch gap-1">
            {AIF_STAGES.map((s, i) => {
              const c = stageCounts.get(s) ?? 0;
              return (
                <li key={s} className={`flex w-[92px] shrink-0 flex-col items-center rounded-md border px-1.5 py-2 text-center ${c ? 'border-gold-500/40 bg-gold-500/10' : 'border-white/[0.06] bg-white/[0.02]'}`}>
                  <span className={`mono text-lg font-semibold ${c ? 'text-gold-300' : 'text-ink-500'}`}>{c}</span>
                  <span className="text-[9.5px] uppercase leading-tight tracking-wider text-ink-300">{s.replace(/_/g, ' ')}</span>
                  <span className="mt-1 text-[9px] text-ink-500">{i + 1}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="mt-4">
          {sortedJourneys.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Stage</th>
                    <th>Classification</th>
                    <th>Risk profile</th>
                    <th className="text-right">Expected</th>
                    <th>Screens</th>
                    <th>Compliance approval</th>
                    <th>Investment approval</th>
                    <th>Fund</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedJourneys.map((j) => {
                    const c = one(j.clients);
                    return (
                      <tr key={j.client_id}>
                        <td>
                          <Link href={`/clients/${j.client_id}/approach`} className="mono text-xs text-gold-300 hover:underline">
                            {c?.client_code ?? 'client'}
                          </Link>
                          {c?.display_name ? <div className="text-[11px] text-ink-400">{c.display_name}</div> : null}
                        </td>
                        <td>
                          <Badge tone={['FUNDING', 'REPORTING'].includes(j.stage) ? 'good' : j.stage === 'COMPLIANCE_APPROVAL' || j.stage === 'SUBSCRIPTION' ? 'gold' : 'neutral'}>
                            {stageIndex(j.stage) + 1}. {j.stage.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        <td className="text-xs text-ink-300">{(j.investor_classification ?? 'NOT_ASSESSED').replace(/_/g, ' ')}</td>
                        <td className="text-xs text-ink-300">{j.risk_profile ?? '-'}</td>
                        <td className="mono text-right">{inr(num(j.expected_amount))}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <ScreenBadge label="KYC" status={j.kyc_status} />
                            <ScreenBadge label="AML" status={j.aml_status} />
                            <ScreenBadge label="Sanctions" status={j.sanctions_status} />
                            <ScreenBadge label="PEP" status={j.pep_status} />
                            <ScreenBadge label="SoF" status={j.sof_status} />
                          </div>
                        </td>
                        <td>{j.compliance_approved_at ? <Badge tone="good">{formatDate(j.compliance_approved_at)}</Badge> : <Badge tone="muted">Pending</Badge>}</td>
                        <td>{j.investment_approved_at ? <Badge tone="good">{formatDate(j.investment_approved_at)}</Badge> : <Badge tone="muted">Pending</Badge>}</td>
                        <td className="text-xs text-ink-300">{j.fund_id ? (fundName.get(j.fund_id) ?? 'Fund') : '-'}</td>
                        <td className="text-xs text-ink-400">{formatDateTime(j.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No client is on the AIF capital path yet.</Empty>
          )}
        </div>
        <p className="mt-2 text-[11px] text-ink-500">Compliance approval requires KYC, AML, sanctions and source-of-funds COMPLETE plus a recorded risk profile; investment approval requires prior compliance approval. Both are human gates recorded on the client&apos;s journey.</p>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        {/* ---------------- COMPLIANCE RULES ---------------- */}
        <Panel title="Compliance rules" right={<Badge tone={canConfigure ? 'gold' : 'muted'}>{canConfigure ? 'editable' : 'read only'}</Badge>}>
          {rules.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value (JSON)</th>
                    <th>Description</th>
                    <th className="text-right">Version</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => {
                    const pretty = JSON.stringify(r.value, null, 2);
                    return (
                      <tr key={r.key}>
                        <td>
                          <span className="mono text-xs">{r.key}</span>
                          {!r.is_active ? <Badge tone="muted" className="ml-1">inactive</Badge> : null}
                        </td>
                        <td>
                          {canConfigure ? (
                            <ActionForm action={updateComplianceRule} resetOnSuccess={false} className="space-y-1">
                              <input type="hidden" name="key" value={r.key} />
                              <textarea name="valueJson" defaultValue={pretty} rows={Math.min(8, Math.max(2, pretty.split('\n').length))} className="input mono min-w-[260px] py-1 text-xs" aria-label={`Value for ${r.key}`} spellCheck={false} />
                              <button className="btn btn-sm">Save (new version)</button>
                            </ActionForm>
                          ) : (
                            <pre className="mono max-w-[360px] whitespace-pre-wrap text-xs text-ink-200">{pretty}</pre>
                          )}
                        </td>
                        <td className="max-w-[260px] text-xs text-ink-300">{r.description ?? '-'}</td>
                        <td className="mono text-right">v{num(r.version) ?? 1}</td>
                        <td className="text-xs text-ink-400">{formatDateTime(r.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No compliance rules seeded.</Empty>
          )}
        </Panel>

        {/* ---------------- FRESHNESS WINDOWS ---------------- */}
        <Panel title="Freshness windows" right={<Badge tone="muted">days</Badge>}>
          {windows.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data class</th>
                    {canConfigure ? (
                      <th>Fresh / stale / expired (days)</th>
                    ) : (
                      <>
                        <th className="text-right">Fresh</th>
                        <th className="text-right">Stale</th>
                        <th className="text-right">Expired</th>
                      </>
                    )}
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {windows.map((w) => {
                    const fresh = num(w.fresh_days) ?? 0;
                    const stale = num(w.stale_days) ?? 0;
                    const expired = num(w.expired_days) ?? 0;
                    return (
                      <tr key={w.data_class}>
                        <td className="mono text-xs">{w.data_class.replace(/_/g, ' ')}</td>
                        {canConfigure ? (
                          <td>
                            <ActionForm action={updateFreshnessWindow} resetOnSuccess={false} className="flex flex-wrap items-center gap-1">
                              <input type="hidden" name="dataClass" value={w.data_class} />
                              <input name="fresh" type="number" min={1} max={3650} defaultValue={fresh} className="input mono w-20 py-1 text-right text-xs" aria-label={`Fresh days for ${w.data_class}`} />
                              <input name="stale" type="number" min={1} max={3650} defaultValue={stale} className="input mono w-20 py-1 text-right text-xs" aria-label={`Stale days for ${w.data_class}`} />
                              <input name="expired" type="number" min={1} max={3650} defaultValue={expired} className="input mono w-20 py-1 text-right text-xs" aria-label={`Expired days for ${w.data_class}`} />
                              <button className="btn btn-sm">Save</button>
                            </ActionForm>
                          </td>
                        ) : (
                          <>
                            <td className="mono text-right text-emerald-300">{fresh}</td>
                            <td className="mono text-right text-amber-300">{stale}</td>
                            <td className="mono text-right text-red-300">{expired}</td>
                          </>
                        )}
                        <td className="text-xs text-ink-300">{w.description ?? '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No freshness windows seeded.</Empty>
          )}
          <p className="mt-2 text-[11px] text-ink-500">Windows must satisfy fresh &lt; stale &lt; expired. Facts older than the stale window are flagged; facts beyond the expired window are not relied on for decisions.</p>
        </Panel>
      </div>

      <p className="text-[11px] text-ink-500">All regulatory thresholds are configuration-driven and versioned; the rules engine is deterministic and separate from AI.</p>
    </div>
  );
}
