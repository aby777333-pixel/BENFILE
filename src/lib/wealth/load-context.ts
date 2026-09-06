/** Assembles the ClientIntelligenceContext from the database (RLS applies) for the Analyze / Approach / NLQ engines. */
import { cache } from 'react';
import type { Assessment, CanonicalProfile } from '@/lib/canonical/types';
import { monthsBetween } from '@/lib/engines/normalize';
import type { Db } from '@/lib/db/server';
import type { AifFundRow, AifSuitabilityRow, AssetRow, BankRelationshipRow, BureauReportRow, CashFlowRow, ClientDocumentRow, ClientIntelligenceContext, ContactControlsRow, FamilyLinkRow, FundSourceRow, HumanInputRow, InteractionRow, InterestRow, LegalMatterRow, LiabilityRow, PropertyPreferencesRow, WealthEventRow } from './types';

export interface IntelligenceBundle {
  ctx: ClientIntelligenceContext;
  profile: CanonicalProfile | null;
  assessment: Assessment | null;
  runId: string | null;
  funds: AifFundRow[];
  rules: Record<string, unknown>;
  siteVisits: number;
  siteVisitsCompleted: number;
  plotInterests: number;
  landownerStage: string | null;
  latestAnalysis: { id: string; version: number; result: unknown; computed_at: string; inputs: unknown; diff: unknown } | null;
  latestStrategy: { id: string; version: number; objective: string; result: unknown; confidence: string; computed_at: string } | null;
}

const lvl = (checks: Assessment['identityChecks'], prefix: string): 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_AVAILABLE' => {
  const rel = checks.filter((c) => c.key.startsWith(prefix) && c.status !== 'NOT_AVAILABLE');
  if (!rel.length) return 'NOT_AVAILABLE';
  if (rel.some((c) => c.status === 'MISMATCH')) return 'LOW';
  return rel.every((c) => c.status === 'MATCH') ? 'HIGH' : 'MEDIUM';
};

export const loadIntelligence = cache(async (db: Db, clientId: string, now = new Date()): Promise<IntelligenceBundle> => {
  const { data: client } = await db.from('clients').select('id,display_name,latest_run_id').eq('id', clientId).single();
  const run = client?.latest_run_id ? (await db.from('verification_runs').select('id,canonical,assessment').eq('id', client.latest_run_id).maybeSingle()).data : null;
  const [assets, liabilities, bureau, cashFlow, banks, family, legal, fundSources, events, interactions, interests, contact, investor, prefs, suit, human, docs, extPending, signals, funds, rules, visits, plotInt, landowner, analysis, strategy] = await Promise.all([
    db.from('assets').select('*').eq('client_id', clientId).order('value_mid', { ascending: false, nullsFirst: false }),
    db.from('liabilities').select('*').eq('client_id', clientId),
    db.from('credit_bureau_reports').select('*').eq('client_id', clientId).order('report_date', { ascending: false }).limit(1).maybeSingle(),
    db.from('cash_flow_periods').select('*').eq('client_id', clientId).order('period'),
    db.from('bank_relationships').select('*').eq('client_id', clientId),
    db.from('family_links').select('*').eq('client_id', clientId),
    db.from('legal_matters').select('*').eq('client_id', clientId),
    db.from('fund_sources').select('*').eq('client_id', clientId),
    db.from('wealth_events').select('*').eq('client_id', clientId).order('occurred_on', { ascending: false }),
    db.from('interactions').select('*').eq('client_id', clientId).order('occurred_at', { ascending: false }).limit(100),
    db.from('client_interests').select('*').eq('client_id', clientId),
    db.from('contact_controls').select('*').eq('client_id', clientId).maybeSingle(),
    db.from('investor_profiles').select('*').eq('client_id', clientId).order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('property_preferences').select('*').eq('client_id', clientId).maybeSingle(),
    db.from('aif_suitability').select('*').eq('client_id', clientId).maybeSingle(),
    db.from('human_inputs').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
    db.from('client_documents').select('*').eq('client_id', clientId).order('uploaded_at', { ascending: false }),
    db.from('external_findings').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('review_status', 'PENDING'),
    db.from('risk_signals').select('title,severity,requires_review,status').eq('client_id', clientId).not('status', 'in', '("DISMISSED","RESOLVED")'),
    db.from('aif_funds').select('*').order('name'),
    db.from('compliance_rules').select('key,value').eq('is_active', true),
    db.from('site_visits').select('id,status').eq('client_id', clientId),
    db.from('plot_interest').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
    db.from('landowner_profiles').select('stage').eq('client_id', clientId).maybeSingle(),
    db.from('client_analyses').select('id,version,result,computed_at,inputs,diff').eq('client_id', clientId).order('version', { ascending: false }).limit(1).maybeSingle(),
    db.from('approach_strategies').select('id,version,objective,result,confidence,computed_at').eq('client_id', clientId).order('version', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const profile = (run?.canonical as CanonicalProfile | undefined) ?? null;
  const assessment = (run?.assessment as Assessment | undefined) ?? null;
  const current = profile?.employment.records.find((r) => r.status === 'CURRENT') ?? null;
  const ip = investor.data;
  const ctx: ClientIntelligenceContext = {
    clientId,
    displayName: client?.display_name ?? 'Client',
    now,
    verified: {
      incomeAnnual: profile?.person.income.value?.amount ?? null,
      incomeEvidence: profile?.person.income.value ? (profile.person.income.provenance.assertion === 'CLIENT_DECLARED' ? 'CLIENT_DECLARED' : 'VERIFIED') : null,
      employmentCurrent: profile ? !!current : null,
      employmentTenureMonths: current ? monthsBetween(current.joiningDate, null, now) : null,
      employerName: current?.employer.name ?? null,
      creditScore: profile?.credit?.score ?? null,
      identityConsistency: assessment ? lvl(assessment.identityChecks, 'name.') : 'NOT_AVAILABLE',
      addressConsistency: assessment ? lvl(assessment.identityChecks, 'address.') : 'NOT_AVAILABLE',
      contactConsistency: assessment ? lvl(assessment.identityChecks, 'phone.') : 'NOT_AVAILABLE',
      verificationConfidence: assessment?.overall.confidence ?? null,
      profileScore: assessment?.score.total ?? null,
      openRiskSignals: (signals.data ?? []).map((s) => ({ title: s.title, severity: s.severity, requiresReview: s.requires_review })),
      freshness: assessment?.overall.freshness ?? null,
      completeness: assessment?.overall.completeness ?? null,
    },
    assets: (assets.data ?? []) as AssetRow[],
    liabilities: (liabilities.data ?? []) as LiabilityRow[],
    bureau: (bureau.data as BureauReportRow | null) ?? null,
    cashFlow: (cashFlow.data ?? []) as CashFlowRow[],
    banks: (banks.data ?? []) as BankRelationshipRow[],
    family: (family.data ?? []) as FamilyLinkRow[],
    legal: (legal.data ?? []) as LegalMatterRow[],
    fundSources: (fundSources.data ?? []) as FundSourceRow[],
    events: (events.data ?? []) as WealthEventRow[],
    interactions: (interactions.data ?? []) as InteractionRow[],
    interests: (interests.data ?? []) as InterestRow[],
    contact: (contact.data as ContactControlsRow | null) ?? null,
    investorProfile: ip ? { objectives: ip.objectives ?? [], horizon: ip.horizon, liquidity: ip.liquidity_needs, riskTolerance: ip.risk_tolerance, experience: ip.experience, incomeRange: ip.income_range, netWorthRange: ip.net_worth_range, sourceOfFunds: ip.source_of_funds, sourceOfWealth: ip.source_of_wealth, expectedAmount: ip.expected_investment_amount ? Number(ip.expected_investment_amount) : null, preferences: ip.preferences ?? [], confirmed: !!(ip.declaration as { clientConfirmed?: boolean })?.clientConfirmed } : null,
    propertyPreferences: (prefs.data as PropertyPreferencesRow | null) ?? null,
    aifSuitability: (suit.data as AifSuitabilityRow | null) ?? null,
    humanInputs: (human.data ?? []) as HumanInputRow[],
    documents: (docs.data ?? []) as ClientDocumentRow[],
    externalPending: extPending.count ?? 0,
  };
  // numeric columns arrive as strings from PostgREST; coerce the ones the engines do arithmetic on
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  for (const a of ctx.assets) { a.value_low = num(a.value_low); a.value_mid = num(a.value_mid); a.value_high = num(a.value_high); a.ownership_pct = num(a.ownership_pct); }
  for (const l of ctx.liabilities) { l.outstanding = num(l.outstanding); l.monthly_obligation = num(l.monthly_obligation); l.original_amount = num(l.original_amount); l.interest_rate = num(l.interest_rate); }
  for (const c of ctx.cashFlow) for (const k of ['inflows', 'outflows', 'salary_credits', 'other_income', 'investment_transfers', 'debt_payments', 'essential_spend', 'discretionary_spend', 'cash_withdrawals'] as const) c[k] = num(c[k]);
  if (ctx.bureau) for (const k of ['utilization', 'emi_total', 'outstanding_total', 'sanctioned_total'] as const) ctx.bureau[k] = num(ctx.bureau[k]);
  for (const b of ctx.banks) { b.balance = num(b.balance); b.avg_monthly_balance = num(b.avg_monthly_balance); }
  if (ctx.propertyPreferences) { const p = ctx.propertyPreferences; p.budget_min = num(p.budget_min); p.budget_max = num(p.budget_max); p.plot_size_min_sqft = num(p.plot_size_min_sqft); p.plot_size_max_sqft = num(p.plot_size_max_sqft); }
  if (ctx.aifSuitability) ctx.aifSuitability.expected_amount = num(ctx.aifSuitability.expected_amount);
  const fundsRows = ((funds.data ?? []) as AifFundRow[]).map((f) => ({ ...f, min_commitment: Number(f.min_commitment), lock_in_years: num(f.lock_in_years), tenure_years: num(f.tenure_years) }));
  return {
    ctx,
    profile,
    assessment,
    runId: run?.id ?? null,
    funds: fundsRows,
    rules: Object.fromEntries((rules.data ?? []).map((r) => [r.key, r.value])),
    siteVisits: visits.data?.length ?? 0,
    siteVisitsCompleted: (visits.data ?? []).filter((v) => v.status === 'COMPLETED').length,
    plotInterests: plotInt.count ?? 0,
    landownerStage: landowner.data?.stage ?? null,
    latestAnalysis: analysis.data ?? null,
    latestStrategy: strategy.data ?? null,
  };
});
