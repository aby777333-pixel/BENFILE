'use server';
/**
 * Phase-2 server actions: wealth register, analysis, approach, CRM, human input, property, AIF, portal.
 * Same discipline as actions.ts: authenticate, permission-check, write under RLS, audit, revalidate.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { audit } from '@/lib/db/audit';
import { getStaff } from '@/lib/db/server';
import { hasPermission, type Permission } from '@/lib/security/permissions';
import { loadIntelligence } from '@/lib/wealth/load-context';
import { analyzeClient, diffAnalyses, type ClientAnalysis } from '@/lib/wealth/behavior-engine';
import { recommendApproach, type Objective } from '@/lib/wealth/approach-engine';
import { detectAnomalies } from '@/lib/wealth/anomaly-engine';
import { detectTriggers } from '@/lib/wealth/triggers';
import { extractClaims, verifyClaim } from '@/lib/wealth/human-input-engine';
import { preferencesFromFeedback } from '@/lib/wealth/matching-engine';
import type { ActionResult } from '@/lib/actions';

async function guard(perm: Permission) {
  const { db, staff } = await getStaff();
  if (!staff) throw new Error('Not signed in');
  if (!hasPermission(staff.role, perm)) throw new Error(`Your role does not have ${perm}`);
  return { db, staff };
}
const uuid = z.string().uuid();
const optNum = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v));
const optStr = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : String(v));
const revalidate = (clientId: string) => {
  revalidatePath(`/clients/${clientId}`, 'layout');
  revalidatePath('/rm');
  revalidatePath('/management');
};
const wrap = async (fn: () => Promise<string | void>): Promise<ActionResult> => {
  try {
    const m = await fn();
    return { ok: true, message: m ?? undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
};
const evidenceEnum = z.enum(['VERIFIED', 'CLIENT_DECLARED', 'OFFICIAL_PUBLIC_RECORD', 'AUTHORIZED_THIRD_PARTY', 'DERIVED_ESTIMATE', 'POSSIBLE_ASSOCIATION', 'ANALYST_PROVIDED']);
const confEnum = z.enum(['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT']);

/* ---------------- Assets / liabilities / family / sources / events ---------------- */
export async function addAsset(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('clients:write');
    const evidence = evidenceEnum.parse(form.get('evidenceClass') ?? 'CLIENT_DECLARED');
    const basis = z.string().parse(form.get('valuationBasis') ?? 'NOT_VALUED');
    let details: Record<string, unknown> = {};
    try { details = form.get('details') ? (JSON.parse(String(form.get('details'))) as Record<string, unknown>) : {}; } catch { throw new Error('Details must be valid JSON'); }
    for (const k of ['city', 'survey_number', 'registration_ref', 'cin', 'role', 'folio', 'amc', 'scheme', 'registration_no', 'make', 'model', 'maturity_on', 'rental']) { const v = form.get(`d_${k}`); if (v !== null && v !== '') details[k] = k === 'rental' ? v === 'on' : String(v); }
    if (evidence === 'VERIFIED' && !hasPermission(staff.role, 'sensitive:reveal')) throw new Error('Only senior roles may mark an asset as VERIFIED; use OFFICIAL_PUBLIC_RECORD or AUTHORIZED_THIRD_PARTY with a source.');
    const { data, error } = await db.from('assets').insert({
      client_id: clientId, category: z.string().parse(form.get('category')), subtype: optStr(form.get('subtype')), title: z.string().min(2).max(200).parse(form.get('title')), details,
      value_low: optNum(form.get('valueLow')), value_mid: optNum(form.get('valueMid')), value_high: optNum(form.get('valueHigh')), valuation_basis: basis, valuation_date: optStr(form.get('valuationDate')), pricing_source: optStr(form.get('pricingSource')), valuation_method: optStr(form.get('valuationMethod')),
      liquidity: z.string().parse(form.get('liquidity') ?? 'ILLIQUID'), evidence_class: evidence, confidence: confEnum.parse(form.get('confidence') ?? 'LOW'), ownership_scope: z.string().parse(form.get('ownershipScope') ?? 'PERSONAL'), ownership_pct: optNum(form.get('ownershipPct')), is_inherited: form.get('inherited') === 'on', encumbered: form.get('encumbered') === 'on' ? true : null, acquired_on: optStr(form.get('acquiredOn')), source_key: optStr(form.get('sourceKey')) ?? 'ANALYST', created_by: staff.userId,
    }).select('id').single();
    if (error) throw new Error(error.message);
    if (form.get('valueMid')) await db.from('asset_valuations').insert({ asset_id: data.id, basis, value_low: optNum(form.get('valueLow')), value_mid: optNum(form.get('valueMid')), value_high: optNum(form.get('valueHigh')), valuation_date: optStr(form.get('valuationDate')) ?? new Date().toISOString().slice(0, 10), pricing_source: optStr(form.get('pricingSource')), methodology: optStr(form.get('valuationMethod')), confidence: confEnum.parse(form.get('confidence') ?? 'LOW'), created_by: staff.userId });
    if (form.get('acquiredOn')) await db.from('wealth_events').insert({ client_id: clientId, occurred_on: String(form.get('acquiredOn')), event_type: `${String(form.get('category'))}_ACQUIRED`, title: `Acquired ${String(form.get('title'))}`, amount: optNum(form.get('valueMid')), asset_id: data.id, evidence_class: evidence, source_key: optStr(form.get('sourceKey')) ?? 'ANALYST' });
    await audit(db, { action: 'asset.add', clientId, entityTable: 'assets', entityId: data.id, details: { category: form.get('category'), evidence } });
    revalidate(clientId);
    return 'Asset recorded';
  });
}

export async function updateAssetStatus(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const id = uuid.parse(form.get('id'));
    const status = z.enum(['ACTIVE', 'DISPOSED', 'DISPUTED', 'REJECTED']).parse(form.get('status'));
    const { db } = await guard('clients:write');
    const { data: a } = await db.from('assets').select('client_id,title').eq('id', id).single();
    const { error } = await db.from('assets').update({ status, disposed_on: status === 'DISPOSED' ? new Date().toISOString().slice(0, 10) : null }).eq('id', id);
    if (error) throw new Error(error.message);
    if (a) {
      if (status === 'DISPOSED') await db.from('wealth_events').insert({ client_id: a.client_id, occurred_on: new Date().toISOString().slice(0, 10), event_type: 'ASSET_SALE', title: `Disposed ${a.title}`, asset_id: id, evidence_class: 'ANALYST_PROVIDED', source_key: 'ANALYST' });
      await audit(db, { action: 'asset.status', clientId: a.client_id, entityTable: 'assets', entityId: id, details: { status } });
      revalidate(a.client_id);
    }
  });
}

export async function addLiability(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('clients:write');
    const { data, error } = await db.from('liabilities').insert({ client_id: clientId, liability_type: z.string().parse(form.get('type')), lender: optStr(form.get('lender')), original_amount: optNum(form.get('original')), outstanding: optNum(form.get('outstanding')), monthly_obligation: optNum(form.get('monthly')), interest_rate: optNum(form.get('rate')), opened_on: optStr(form.get('openedOn')), maturity_on: optStr(form.get('maturityOn')), collateral: optStr(form.get('collateral')), linked_asset_id: form.get('linkedAssetId') ? uuid.parse(form.get('linkedAssetId')) : null, secured: form.get('secured') === 'on', repayment_status: optStr(form.get('repaymentStatus')) ?? 'REGULAR', role: z.string().parse(form.get('role') ?? 'BORROWER'), evidence_class: evidenceEnum.parse(form.get('evidenceClass') ?? 'CLIENT_DECLARED'), confidence: confEnum.parse(form.get('confidence') ?? 'LOW'), source_key: optStr(form.get('sourceKey')) ?? 'ANALYST', created_by: staff.userId }).select('id').single();
    if (error) throw new Error(error.message);
    if (form.get('linkedAssetId')) await db.from('assets').update({ encumbered: true, linked_liability_id: data.id }).eq('id', String(form.get('linkedAssetId')));
    if (form.get('openedOn')) await db.from('wealth_events').insert({ client_id: clientId, occurred_on: String(form.get('openedOn')), event_type: 'LOAN_OPENED', title: `${String(form.get('type')).replace(/_/g, ' ')} opened${form.get('lender') ? ` with ${form.get('lender')}` : ''}`, amount: optNum(form.get('original')), liability_id: data.id, evidence_class: evidenceEnum.parse(form.get('evidenceClass') ?? 'CLIENT_DECLARED'), source_key: optStr(form.get('sourceKey')) ?? 'ANALYST' });
    await audit(db, { action: 'liability.add', clientId, entityTable: 'liabilities', entityId: data.id });
    revalidate(clientId);
    return 'Liability recorded';
  });
}

export async function addFamilyLink(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db } = await guard('clients:write');
    const { error } = await db.from('family_links').insert({ client_id: clientId, name: z.string().min(2).parse(form.get('name')), relation: z.string().parse(form.get('relation')), evidence_class: evidenceEnum.parse(form.get('evidenceClass') ?? 'CLIENT_DECLARED'), confidence: confEnum.parse(form.get('confidence') ?? 'LOW'), entitlement: optStr(form.get('entitlement')) ?? 'NONE_KNOWN', note: optStr(form.get('note')) });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'family.link', clientId, entityTable: 'family_links' });
    revalidate(clientId);
  });
}

export async function addFundSource(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('notes:write');
    const { error } = await db.from('fund_sources').insert({ client_id: clientId, kind: z.enum(['SOURCE_OF_FUNDS', 'SOURCE_OF_WEALTH']).parse(form.get('kind')), category: z.string().parse(form.get('category')), description: optStr(form.get('description')), amount: optNum(form.get('amount')), evidence_document_id: form.get('documentId') ? uuid.parse(form.get('documentId')) : null, evidence_class: 'CLIENT_DECLARED', status: form.get('documentId') ? 'EVIDENCED' : 'DECLARED', created_by: staff.userId });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'fund_source.add', clientId, entityTable: 'fund_sources' });
    revalidate(clientId);
  });
}

export async function addWealthEvent(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db } = await guard('clients:write');
    const { error } = await db.from('wealth_events').insert({ client_id: clientId, occurred_on: z.string().parse(form.get('occurredOn')), event_type: z.string().parse(form.get('eventType')), title: z.string().min(2).parse(form.get('title')), amount: optNum(form.get('amount')), evidence_class: evidenceEnum.parse(form.get('evidenceClass') ?? 'CLIENT_DECLARED'), source_key: optStr(form.get('sourceKey')) ?? 'ANALYST', evidence: form.get('evidenceNote') ? { note: String(form.get('evidenceNote')) } : {} });
    if (error) throw new Error(error.message);
    revalidate(clientId);
  });
}

/* ---------------- Bureau report / cash flow ingestion (JSON paste or provider) ---------------- */
export async function ingestBureauReport(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db } = await guard('verification:ingest');
    let j: Record<string, unknown>;
    try { j = JSON.parse(String(form.get('json'))); } catch { throw new Error('Invalid JSON'); }
    const n = (k: string) => (j[k] === undefined || j[k] === null ? null : Number(j[k]));
    const accounts = Array.isArray(j.accounts) ? (j.accounts as Array<Record<string, unknown>>) : [];
    const { error } = await db.from('credit_bureau_reports').insert({ client_id: clientId, bureau: String(j.bureau ?? 'CIBIL'), score: n('score'), report_date: (j.report_date as string) ?? null, score_history: j.score_history ?? [], credit_age_months: n('credit_age_months'), total_accounts: n('total_accounts') ?? accounts.length, active_accounts: n('active_accounts') ?? accounts.filter((a) => a.status === 'ACTIVE').length, closed_accounts: n('closed_accounts'), secured_loans: n('secured_loans'), unsecured_loans: n('unsecured_loans'), credit_cards: n('credit_cards'), sanctioned_total: n('sanctioned_total'), outstanding_total: n('outstanding_total'), utilization: n('utilization'), emi_total: n('emi_total'), dpd_30_count: n('dpd_30_count'), dpd_60_count: n('dpd_60_count'), dpd_90_count: n('dpd_90_count'), missed_payments_12m: n('missed_payments_12m'), write_offs: n('write_offs'), settlements: n('settlements'), defaults: n('defaults'), restructured: n('restructured'), enquiries_6m: n('enquiries_6m'), enquiries_12m: n('enquiries_12m'), oldest_account_on: (j.oldest_account_on as string) ?? null, newest_account_on: (j.newest_account_on as string) ?? null, accounts, enquiries: j.enquiries ?? [], source_key: String(j.source_key ?? 'CREDIT') });
    if (error) throw new Error(error.message);
    // Mirror active accounts into the liability register as authorised third-party data.
    for (const a of accounts.filter((x) => x.status === 'ACTIVE')) {
      await db.from('liabilities').insert({ client_id: clientId, liability_type: String(a.type ?? 'LOAN'), lender: String(a.lender ?? ''), original_amount: a.sanctioned ? Number(a.sanctioned) : null, outstanding: a.outstanding ? Number(a.outstanding) : null, monthly_obligation: a.emi ? Number(a.emi) : null, opened_on: (a.opened as string) ?? null, maturity_on: (a.maturity as string) ?? null, secured: !!a.secured, repayment_status: (a.dpd as number) > 0 ? `DPD_${a.dpd}` : 'REGULAR', days_past_due: (a.dpd as number) ?? 0, evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'HIGH', source_key: String(j.bureau ?? 'CREDIT') });
    }
    await db.from('wealth_events').insert({ client_id: clientId, occurred_on: (j.report_date as string) ?? new Date().toISOString().slice(0, 10), event_type: 'CREDIT_REFRESH', title: `Credit bureau report refreshed (${String(j.bureau ?? 'CIBIL')} ${j.score ?? ''})`, evidence_class: 'AUTHORIZED_THIRD_PARTY', source_key: 'CREDIT' });
    await audit(db, { action: 'credit.bureau_ingest', clientId, entityTable: 'credit_bureau_reports', details: { accounts: accounts.length } });
    revalidate(clientId);
    return `Bureau report stored with ${accounts.length} account(s)`;
  });
}

export async function ingestCashFlow(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db } = await guard('verification:ingest');
    const { data: consent } = await db.from('consents').select('id,sources_authorized').eq('client_id', clientId).eq('status', 'GRANTED').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!consent || !(consent.sources_authorized as string[]).includes('BANKING')) throw new Error('Consent on file does not authorise BANKING data.');
    let rows: Array<Record<string, unknown>>;
    try { const j = JSON.parse(String(form.get('json'))); rows = Array.isArray(j) ? j : (j.periods ?? j.months ?? []); } catch { throw new Error('Invalid JSON'); }
    if (!rows.length) throw new Error('No periods found');
    const n = (v: unknown) => (v === undefined || v === null ? null : Number(v));
    const { error } = await db.from('cash_flow_periods').upsert(rows.map((r) => ({ client_id: clientId, period: String(r.period), inflows: n(r.inflows), outflows: n(r.outflows), salary_credits: n(r.salary_credits), other_income: n(r.other_income), investment_transfers: n(r.investment_transfers), debt_payments: n(r.debt_payments), essential_spend: n(r.essential_spend), discretionary_spend: n(r.discretionary_spend), cash_withdrawals: n(r.cash_withdrawals), large_inflows: r.large_inflows ?? [], large_outflows: r.large_outflows ?? [], returned_transactions: n(r.returned_transactions), categories: r.categories ?? {}, evidence_class: 'AUTHORIZED_THIRD_PARTY', source_key: String(form.get('sourceKey') ?? 'AA'), consent_id: consent.id })), { onConflict: 'client_id,period,source_key' });
    if (error) throw new Error(error.message);
    if (form.get('bankName')) await db.from('bank_relationships').insert({ client_id: clientId, bank_name: String(form.get('bankName')), account_type: optStr(form.get('accountType')) ?? 'SAVINGS', balance: optNum(form.get('balance')), avg_monthly_balance: optNum(form.get('avgBalance')), balance_date: optStr(form.get('balanceDate')), source_key: String(form.get('sourceKey') ?? 'AA'), consent_id: consent.id });
    await audit(db, { action: 'banking.cashflow_ingest', clientId, entityTable: 'cash_flow_periods', details: { periods: rows.length } });
    revalidate(clientId);
    return `${rows.length} period(s) stored`;
  });
}

/* ---------------- Analyze / Approach ---------------- */
export async function runAnalyze(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('clients:read');
    const bundle = await loadIntelligence(db, clientId);
    const result = analyzeClient(bundle.ctx);
    const prev = (bundle.latestAnalysis?.result as ClientAnalysis | undefined) ?? null;
    const diff = diffAnalyses(prev, result);
    const version = (bundle.latestAnalysis?.version ?? 0) + 1;
    const { error } = await db.from('client_analyses').insert({ client_id: clientId, version, engine_version: result.engineVersion, inputs: result.inputs, result, diff, computed_by: staff.userId });
    if (error) throw new Error(error.message);
    // anomalies + triggers are refreshed alongside
    const { data: shared } = await db.rpc('shared_identifier_clients', { p_client_id: clientId });
    const anomalies = detectAnomalies({ profile: bundle.profile, sharedIdentifiers: (shared ?? []) as Array<{ kind: string; other_client_ids: string[] }>, documents: bundle.ctx.documents });
    for (const a of anomalies) await db.from('anomalies').upsert({ client_id: clientId, anomaly_type: a.type, detail: a.detail, evidence: a.evidence, severity: a.severity, fingerprint: a.fingerprint }, { onConflict: 'client_id,fingerprint', ignoreDuplicates: true });
    const triggers = detectTriggers(bundle.ctx, bundle.funds, bundle.siteVisitsCompleted);
    await db.from('opportunity_triggers').delete().eq('client_id', clientId).eq('status', 'OPEN');
    if (triggers.length) await db.from('opportunity_triggers').insert(triggers.map((t) => ({ client_id: clientId, trigger_type: t.type, title: t.title, source_key: t.sourceKey, evidence: t.evidence, event_date: t.eventDate, confidence: t.confidence, recommended_action: t.recommendedAction, sensitive: t.sensitive })));
    await db.from('clients').update({ hni_mode: result.wealth.hniIndicator.qualifies === true }).eq('id', clientId);
    await db.from('intelligence_events').insert({ client_id: clientId, event_type: 'ANALYSIS_RUN', title: `Analyze Client v${version}`, detail: diff.first ? 'First analysis' : `${diff.changes.length} change(s), ${diff.newRisks.length} new risk(s), ${diff.resolvedRisks.length} resolved`, source_key: 'ENGINE', actor_id: staff.userId });
    await audit(db, { action: 'analysis.run', clientId, entityTable: 'client_analyses', details: { version, humanInfluence: 'NONE', anomalies: anomalies.length, triggers: triggers.length } });
    revalidate(clientId);
    return `Analysis v${version} computed (${anomalies.length} anomaly(ies), ${triggers.length} trigger(s))`;
  });
}

export async function runApproach(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const objective = z.enum(['AIF', 'PROPERTY', 'BOTH', 'DISCOVERY', 'WEALTH_MANAGEMENT', 'INSURANCE', 'LOAN', 'ESTATE_PLANNING', 'OTHER']).parse(form.get('objective') ?? 'BOTH') as Objective;
    const { db, staff } = await guard('clients:read');
    const bundle = await loadIntelligence(db, clientId);
    const analysis = (bundle.latestAnalysis?.result as ClientAnalysis | undefined) ?? analyzeClient(bundle.ctx);
    const minCommit = (bundle.rules['aif.min_commitment'] as { amount?: number } | undefined)?.amount;
    const maxContacts = (bundle.rules['sales.max_contacts_7d'] as { count?: number } | undefined)?.count;
    const result = recommendApproach(bundle.ctx, analysis, objective, { funds: bundle.funds, aifMinCommitment: minCommit, maxContacts7d: maxContacts, landownerStage: bundle.landownerStage, siteVisits: bundle.siteVisits, plotInterests: bundle.plotInterests });
    const version = (bundle.latestStrategy?.version ?? 0) + 1;
    const { error } = await db.from('approach_strategies').insert({ client_id: clientId, version, objective, engine_version: result.engineVersion, result, confidence: result.approachConfidence, computed_by: staff.userId });
    if (error) throw new Error(error.message);
    for (const [vertical, score, rel, reasons, evidence, missing] of [['AIF', result.scores.aif, result.aif.relevance, result.aif.reasons, result.aif.evidence, result.aif.missing], ['PROPERTY', result.scores.property, result.property.relevance, result.property.reasons, result.property.evidence, result.property.missing], ['ENGAGEMENT', result.scores.engagement, result.relationshipEngagement.level, result.relationshipEngagement.basis, [], []]] as const) {
      await db.from('opportunity_scores').upsert({ client_id: clientId, vertical, score, relevance: rel, reasons, evidence, missing, confidence: result.approachConfidence }, { onConflict: 'client_id,vertical' });
    }
    await audit(db, { action: 'approach.run', clientId, entityTable: 'approach_strategies', details: { version, objective, confidence: result.approachConfidence } });
    revalidate(clientId);
    return `Approach v${version} (${objective}) - confidence ${result.approachConfidence.toLowerCase()}`;
  });
}

export async function createTaskFromAction(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('notes:write');
    const { error } = await db.from('tasks').insert({ client_id: clientId, title: z.string().min(3).parse(form.get('title')), task_type: z.string().parse(form.get('taskType') ?? 'FOLLOW_UP'), due_at: optStr(form.get('dueAt')), assigned_to: form.get('assignedTo') ? uuid.parse(form.get('assignedTo')) : staff.userId, priority: optStr(form.get('priority')) ?? 'NORMAL', source: optStr(form.get('source')) ?? 'MANUAL', reason: optStr(form.get('reason')), created_by: staff.userId });
    if (error) throw new Error(error.message);
    revalidate(clientId);
    return 'Task created';
  });
}

export async function completeTask(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const id = uuid.parse(form.get('id'));
    const { db } = await guard('notes:write');
    const { data } = await db.from('tasks').update({ status: z.enum(['DONE', 'CANCELLED']).parse(form.get('status') ?? 'DONE'), completed_at: new Date().toISOString() }).eq('id', id).select('client_id').single();
    if (data?.client_id) revalidate(data.client_id);
    revalidatePath('/rm');
  });
}

/* ---------------- CRM: interactions, interests, contact controls ---------------- */
const list = (v: FormDataEntryValue | null) => (v ? String(v).split(/\n|;/).map((s) => s.trim()).filter(Boolean) : []);
export async function addInteraction(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('notes:write');
    const { data, error } = await db.from('interactions').insert({ client_id: clientId, occurred_at: optStr(form.get('occurredAt')) ?? new Date().toISOString(), channel: z.string().parse(form.get('channel')), direction: z.string().parse(form.get('direction') ?? 'OUTBOUND'), kind: z.string().parse(form.get('kind') ?? 'CALL'), summary: z.string().min(3).parse(form.get('summary')), questions: list(form.get('questions')), objections: list(form.get('objections')), interests: list(form.get('interests')), concerns: list(form.get('concerns')), commitments: list(form.get('commitments')), products_discussed: list(form.get('products')), client_declared_changes: list(form.get('declaredChanges')), follow_up_at: optStr(form.get('followUpAt')), outcome: optStr(form.get('outcome')) ?? 'PENDING', decline_reason: optStr(form.get('declineReason')), language: optStr(form.get('language')) ?? 'en', original_text: optStr(form.get('originalText')), response_time_hours: optNum(form.get('responseHours')), author_id: staff.userId }).select('id').single();
    if (error) throw new Error(error.message);
    await db.from('contact_controls').upsert({ client_id: clientId, last_contact_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
    // Client-declared changes become human-context items labelled CLIENT SAID until reviewed (never facts).
    for (const c of list(form.get('declaredChanges'))) await db.from('human_inputs').insert({ client_id: clientId, category: 'CLIENT_SAID', source_type: 'CLIENT_DECLARED', body: c, first_hand: true, client_confirmed: false, related_meeting_id: data.id, author_id: staff.userId, author_confidence: 'MEDIUM' });
    if (form.get('followUpAt')) await db.from('tasks').insert({ client_id: clientId, title: `Follow up: ${String(form.get('summary')).slice(0, 80)}`, task_type: 'FOLLOW_UP', due_at: String(form.get('followUpAt')), assigned_to: staff.userId, source: 'MANUAL', created_by: staff.userId });
    await db.from('intelligence_events').insert({ client_id: clientId, event_type: `INTERACTION_${String(form.get('kind') ?? 'CALL')}`, title: `${String(form.get('channel'))} ${String(form.get('kind') ?? 'call').toLowerCase()}: ${String(form.get('summary')).slice(0, 100)}`, source_key: 'CRM', actor_id: staff.userId });
    await audit(db, { action: 'interaction.add', clientId, entityTable: 'interactions', entityId: data.id, details: { channel: form.get('channel'), kind: form.get('kind') } });
    revalidate(clientId);
    return 'Interaction recorded';
  });
}

export async function setInterest(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('notes:write');
    const { error } = await db.from('client_interests').upsert({ client_id: clientId, category: z.string().parse(form.get('category')), stance: z.enum(['INTERESTED', 'NOT_INTERESTED', 'UNKNOWN']).parse(form.get('stance')), evidence_class: form.get('declared') === 'on' ? 'CLIENT_DECLARED' : 'ANALYST_PROVIDED', source: optStr(form.get('source')), note: optStr(form.get('note')), updated_by: staff.userId, updated_at: new Date().toISOString() }, { onConflict: 'client_id,category' });
    if (error) throw new Error(error.message);
    revalidate(clientId);
  });
}

export async function setContactControls(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db } = await guard('notes:write');
    const { error } = await db.from('contact_controls').upsert({ client_id: clientId, do_not_contact: form.get('doNotContact') === 'on', preferred_channel: optStr(form.get('preferredChannel')), preferred_frequency_days: optNum(form.get('frequencyDays')), marketing_permission: form.get('marketing') === 'on', preferred_language: optStr(form.get('language')) ?? 'en', preferred_format: optStr(form.get('format')), reporting_frequency: optStr(form.get('reporting')), updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'contact.controls', clientId, entityTable: 'contact_controls', details: { doNotContact: form.get('doNotContact') === 'on', marketing: form.get('marketing') === 'on' } });
    revalidate(clientId);
  });
}

/* ---------------- Human input sandbox ---------------- */
export async function addHumanInput(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('notes:write');
    const { error } = await db.from('human_inputs').insert({ client_id: clientId, category: z.string().parse(form.get('category')), source_type: z.string().parse(form.get('sourceType')), body: z.string().min(3).max(4000).parse(form.get('body')), attributed_to: optStr(form.get('attributedTo')), author_confidence: z.enum(['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH']).parse(form.get('authorConfidence') ?? 'LOW'), first_hand: form.get('firstHand') === 'on', client_confirmed: form.get('clientConfirmed') === 'on', has_evidence: form.get('hasEvidence') === 'on', related_company: optStr(form.get('relatedCompany')), related_property: optStr(form.get('relatedProperty')), related_transaction: optStr(form.get('relatedTransaction')), language: optStr(form.get('language')) ?? 'en', author_id: staff.userId });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'human_input.add', clientId, entityTable: 'human_inputs', details: { category: form.get('category'), sourceType: form.get('sourceType') } });
    revalidate(clientId);
    return 'Recorded as unverified human context';
  });
}

export async function verifyHumanInput(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const id = uuid.parse(form.get('id'));
    const { db, staff } = await guard('external:search');
    const { data: h } = await db.from('human_inputs').select('*').eq('id', id).single();
    if (!h) throw new Error('Not found');
    const bundle = await loadIntelligence(db, h.client_id);
    if (!bundle.profile) throw new Error('Run a verification first');
    const { data: consent } = await db.from('consents').select('sources_authorized').eq('client_id', h.client_id).eq('status', 'GRANTED').order('created_at', { ascending: false }).limit(1).maybeSingle();
    const claims = extractClaims(h.body);
    const results = [];
    for (const c of claims.filter((c) => c.verifiable)) results.push({ claim: c, verification: await verifyClaim(c, bundle.profile, (consent?.sources_authorized as string[]) ?? []) });
    const statuses = results.map((r) => r.verification.status);
    const status = statuses.includes('CONTRADICTED') ? 'CONTRADICTED' : statuses.includes('VERIFIED') ? 'VERIFIED' : statuses.includes('POSSIBLE_MATCH') ? 'POSSIBLE_MATCH' : 'NOT_VERIFIED';
    const { error } = await db.from('human_inputs').update({ status, verification_result: { checkedAt: new Date().toISOString(), by: staff.userId, claims: claims.map((c) => ({ kind: c.kind, entities: c.entities, verifiable: c.verifiable, plan: c.verificationPlan, questions: c.followUpQuestions, cautions: c.cautions })), results: results.map((r) => ({ kind: r.claim.kind, ...r.verification })) } }).eq('id', id);
    if (error) throw new Error(error.message);
    // Verification tasks for claims that need documents/questions (never auto-add to assets)
    for (const c of claims.filter((c) => c.verifiable && ['LAND_HOLDING', 'PROPERTY_OWNERSHIP', 'INHERITANCE', 'INVESTMENT', 'LOAN'].includes(c.kind))) await db.from('tasks').insert({ client_id: h.client_id, title: `Verify claim (${c.kind.replace(/_/g, ' ').toLowerCase()}): ${c.verificationPlan[0]}`, task_type: 'DOCUMENT_REQUEST', assigned_to: staff.userId, source: 'HUMAN_INPUT', reason: h.body.slice(0, 200), created_by: staff.userId });
    await db.from('intelligence_events').insert({ client_id: h.client_id, event_type: 'HUMAN_INPUT_VERIFIED', title: `Human-input claim ${status.replace(/_/g, ' ').toLowerCase()}`, detail: results.map((r) => r.verification.summary).join(' ') || 'No automated verification path.', source_key: 'ENGINE', actor_id: staff.userId });
    await audit(db, { action: 'human_input.verify', clientId: h.client_id, entityTable: 'human_inputs', entityId: id, details: { status, claims: claims.length } });
    revalidate(h.client_id);
    return `Result: ${status.replace(/_/g, ' ')}. The original note is preserved unchanged.`;
  });
}

/* ---------------- Property: preferences, site visits, plots ---------------- */
export async function savePropertyPreferences(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('notes:write');
    const declared = form.get('declared') === 'on';
    const arr = (k: string) => form.getAll(k).map(String).filter(Boolean);
    const csv = (k: string) => (form.get(k) ? String(form.get(k)).split(',').map((s) => s.trim()).filter(Boolean) : []);
    const fieldEvidence = Object.fromEntries(['budget', 'cities', 'plot_size', 'facing', 'road_width', 'purpose', 'horizon'].map((k) => [k, { evidence_class: declared ? 'CLIENT_DECLARED' : 'ANALYST_PROVIDED', source: optStr(form.get('source')) ?? 'RM entry', date: new Date().toISOString().slice(0, 10) }]));
    const { error } = await db.from('property_preferences').upsert({ client_id: clientId, buyer_type: z.enum(['END_USER', 'INVESTOR', 'MIXED_UNKNOWN']).parse(form.get('buyerType') ?? 'MIXED_UNKNOWN'), buyer_type_basis: optStr(form.get('buyerTypeBasis')), purpose: optStr(form.get('purpose')), budget_min: optNum(form.get('budgetMin')), budget_max: optNum(form.get('budgetMax')), cities: csv('cities'), districts: csv('districts'), localities: csv('localities'), property_types: arr('propertyTypes'), plot_size_min_sqft: optNum(form.get('sizeMin')), plot_size_max_sqft: optNum(form.get('sizeMax')), facing: arr('facing'), road_width_min_ft: optNum(form.get('roadWidth')), corner_preferred: form.get('corner') === 'on', approval_required: form.get('approvalRequired') === 'on', proximity: arr('proximity'), horizon: optStr(form.get('horizon')), financing: optStr(form.get('financing')), field_evidence: fieldEvidence, declared_at: declared ? new Date().toISOString() : null, updated_by: staff.userId, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'property.preferences', clientId, entityTable: 'property_preferences', details: { declared } });
    revalidate(clientId);
    return 'Property requirements saved';
  });
}

export async function scheduleSiteVisit(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('notes:write');
    const plotIds = form.getAll('plotIds').map(String).filter(Boolean);
    const { data, error } = await db.from('site_visits').insert({ client_id: clientId, project_id: uuid.parse(form.get('projectId')), plot_ids: plotIds, scheduled_at: optStr(form.get('scheduledAt')), rm_id: form.get('rmId') ? uuid.parse(form.get('rmId')) : staff.userId, property_rep_id: form.get('repId') ? uuid.parse(form.get('repId')) : null, attendees: list(form.get('attendees')), pickup_required: form.get('pickup') === 'on', pickup_point: optStr(form.get('pickupPoint')), meeting_point: optStr(form.get('meetingPoint')), itinerary: list(form.get('itinerary')).map((s, i) => ({ step: i + 1, text: s })), status: form.get('scheduledAt') ? 'SCHEDULED' : 'PROPOSED', created_by: staff.userId }).select('id').single();
    if (error) throw new Error(error.message);
    for (const p of plotIds) await db.from('plot_interest').upsert({ client_id: clientId, plot_id: p, stance: 'INTERESTED', source: 'RM' }, { onConflict: 'client_id,plot_id', ignoreDuplicates: true });
    await db.from('tasks').insert({ client_id: clientId, title: 'Site visit', task_type: 'SITE_VISIT', due_at: optStr(form.get('scheduledAt')), assigned_to: staff.userId, source: 'MANUAL', created_by: staff.userId });
    await db.from('intelligence_events').insert({ client_id: clientId, event_type: 'SITE_VISIT_SCHEDULED', title: 'Site visit scheduled', detail: `${plotIds.length} plot(s)`, source_key: 'CRM', actor_id: staff.userId });
    await audit(db, { action: 'site_visit.schedule', clientId, entityTable: 'site_visits', entityId: data.id });
    revalidate(clientId);
    return 'Site visit created';
  });
}

export async function siteVisitFeedback(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const id = uuid.parse(form.get('id'));
    const { db, staff } = await guard('notes:write');
    const fb = { liked: list(form.get('liked')), disliked: list(form.get('disliked')), preferred_plots: list(form.get('preferredPlots')), price_reaction: optStr(form.get('priceReaction')), location_reaction: optStr(form.get('locationReaction')), road_width_pref: optNum(form.get('roadWidthPref')), plot_size_reaction: optStr(form.get('plotSizeReaction')), amenities: optStr(form.get('amenities')), questions: list(form.get('questions')), objections: list(form.get('objections')), decision_timeline: optStr(form.get('decisionTimeline')), follow_up_date: optStr(form.get('followUpDate')) };
    const { data: v, error } = await db.from('site_visits').update({ feedback: fb, status: 'COMPLETED', completed_at: new Date().toISOString() }).eq('id', id).select('client_id,project_id').single();
    if (error) throw new Error(error.message);
    const { data: pp } = await db.from('property_preferences').select('*').eq('client_id', v.client_id).maybeSingle();
    const patch = preferencesFromFeedback(pp, fb, `site visit ${id.slice(0, 8)}`);
    await db.from('property_preferences').upsert({ client_id: v.client_id, ...(pp ?? { buyer_type: 'MIXED_UNKNOWN' }), ...patch, updated_by: staff.userId, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
    for (const pn of fb.preferred_plots) { const { data: plot } = await db.from('plots').select('id').eq('project_id', v.project_id).eq('plot_number', pn).maybeSingle(); if (plot) await db.from('plot_interest').upsert({ client_id: v.client_id, plot_id: plot.id, stance: 'INTERESTED', source: 'SITE_VISIT', reason: 'Preferred during site visit' }, { onConflict: 'client_id,plot_id' }); }
    await db.from('interactions').insert({ client_id: v.client_id, channel: 'IN_PERSON', direction: 'OUTBOUND', kind: 'SITE_VISIT', summary: `Site visit completed. Liked: ${fb.liked.join(', ') || '-'}; disliked: ${fb.disliked.join(', ') || '-'}; price reaction: ${fb.price_reaction ?? '-'}`, questions: fb.questions, objections: fb.objections, interests: fb.preferred_plots.map((p) => `Plot ${p}`), follow_up_at: fb.follow_up_date, outcome: 'PROGRESSED', author_id: staff.userId });
    if (fb.follow_up_date) await db.from('tasks').insert({ client_id: v.client_id, title: 'Post-site-visit follow-up', task_type: 'FOLLOW_UP', due_at: fb.follow_up_date, assigned_to: staff.userId, source: 'MANUAL', created_by: staff.userId });
    await audit(db, { action: 'site_visit.feedback', clientId: v.client_id, entityTable: 'site_visits', entityId: id });
    revalidate(v.client_id);
    return 'Feedback captured; preference profile updated from explicit feedback only';
  });
}

export async function holdPlot(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const plotId = uuid.parse(form.get('plotId'));
    const clientId = uuid.parse(form.get('clientId'));
    const action = z.enum(['HOLD', 'RELEASE', 'BOOK']).parse(form.get('action'));
    const { db, staff } = await guard('clients:write');
    const patch = action === 'HOLD' ? { status: 'HELD', held_for_client_id: clientId, held_until: new Date(Date.now() + 7 * 86_400_000).toISOString() } : action === 'BOOK' ? { status: 'BOOKED', held_for_client_id: clientId } : { status: 'AVAILABLE', held_for_client_id: null, held_until: null };
    const { data: p, error } = await db.from('plots').update(patch).eq('id', plotId).select('plot_number,project_id').single();
    if (error) throw new Error(error.message);
    await db.from('intelligence_events').insert({ client_id: clientId, event_type: `PLOT_${action}`, title: `Plot ${p.plot_number} ${action.toLowerCase()}`, source_key: 'INVENTORY', actor_id: staff.userId });
    await audit(db, { action: `plot.${action.toLowerCase()}`, clientId, entityTable: 'plots', entityId: plotId });
    revalidate(clientId);
    revalidatePath('/inventory');
    return `Plot ${p.plot_number}: ${action.toLowerCase()}`;
  });
}

/* ---------------- AIF suitability journey ---------------- */
export async function updateAifSuitability(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('investor:capture');
    const q: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) if (k.startsWith('q_')) q[k.slice(2)] = String(v);
    const patch: Record<string, unknown> = { client_id: clientId, updated_by: staff.userId, updated_at: new Date().toISOString() };
    const set = (k: string, v: unknown) => { if (v !== null && v !== undefined && v !== '') patch[k] = v; };
    set('stage', optStr(form.get('stage')));
    set('investor_classification', optStr(form.get('classification')));
    set('risk_profile', optStr(form.get('riskProfile')));
    if (form.get('riskProfile')) set('risk_profile_basis', 'Suitability questionnaire answered by the client');
    set('horizon', optStr(form.get('horizon')));
    set('liquidity_needs', optStr(form.get('liquidityNeeds')));
    set('expected_amount', optNum(form.get('expectedAmount')));
    for (const k of ['sof_status', 'sow_status', 'kyc_status', 'aml_status', 'sanctions_status', 'pep_status', 'beneficial_owner_status']) set(k, optStr(form.get(k)));
    if (form.get('bankVerified') !== null) patch.bank_verified = form.get('bankVerified') === 'on';
    if (form.get('riskAck') !== null) patch.risk_acknowledged = form.get('riskAck') === 'on';
    if (form.get('docsExecuted') !== null) patch.documents_executed = form.get('docsExecuted') === 'on';
    if (form.get('fundId')) patch.fund_id = uuid.parse(form.get('fundId'));
    set('commitment_amount', optNum(form.get('commitment')));
    if (Object.keys(q).length) patch.questionnaire = q;
    const approval = optStr(form.get('approve'));
    if (approval === 'COMPLIANCE') { if (!hasPermission(staff.role, 'risk:escalate')) throw new Error('Compliance approval requires a compliance / senior role'); const { data: cur } = await db.from('aif_suitability').select('*').eq('client_id', clientId).maybeSingle(); const required = ['kyc_status', 'aml_status', 'sanctions_status', 'sof_status']; const missing = required.filter((k) => (cur as Record<string, string> | null)?.[k] !== 'COMPLETE'); if (missing.length) throw new Error(`Cannot approve: ${missing.join(', ')} not complete`); if (!cur?.risk_profile) throw new Error('Cannot approve: risk profile not set'); patch.compliance_approved_by = staff.userId; patch.compliance_approved_at = new Date().toISOString(); patch.stage = 'COMPLIANCE_APPROVAL'; }
    if (approval === 'INVESTMENT') { if (!hasPermission(staff.role, 'risk:escalate')) throw new Error('Investment approval requires a senior role'); const { data: cur } = await db.from('aif_suitability').select('compliance_approved_at').eq('client_id', clientId).maybeSingle(); if (!cur?.compliance_approved_at) throw new Error('Compliance approval must precede investment approval'); patch.investment_approved_by = staff.userId; patch.investment_approved_at = new Date().toISOString(); patch.stage = 'SUBSCRIPTION'; }
    const { error } = await db.from('aif_suitability').upsert(patch, { onConflict: 'client_id' });
    if (error) throw new Error(error.message);
    await db.from('intelligence_events').insert({ client_id: clientId, event_type: 'AIF_JOURNEY', title: `AIF journey updated${patch.stage ? `: ${String(patch.stage).replace(/_/g, ' ').toLowerCase()}` : ''}`, detail: approval ? `${approval} approval by ${staff.fullName}` : null, source_key: 'AIF', actor_id: staff.userId });
    await audit(db, { action: approval ? `aif.approve_${approval.toLowerCase()}` : 'aif.suitability_update', clientId, entityTable: 'aif_suitability', details: { stage: patch.stage, approval } });
    revalidate(clientId);
    return approval ? `${approval} approval recorded` : 'Suitability updated';
  });
}

/* ---------------- Legal matters / landowner / documents review / portal ---------------- */
export async function attachLegalMatter(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('external:review');
    let parties: unknown = [];
    try { parties = form.get('parties') ? JSON.parse(String(form.get('parties'))) : []; } catch { parties = list(form.get('parties')).map((p) => ({ name: p, role: 'UNKNOWN' })); }
    const { error } = await db.from('legal_matters').insert({ client_id: clientId, finding_id: form.get('findingId') ? uuid.parse(form.get('findingId')) : null, case_number: optStr(form.get('caseNumber')), court: optStr(form.get('court')), jurisdiction: optStr(form.get('jurisdiction')), case_type: optStr(form.get('caseType')), category: optStr(form.get('category')), parties, client_role: optStr(form.get('clientRole')) ?? 'UNKNOWN', subject_kind: optStr(form.get('subjectKind')) ?? 'PERSON', filing_date: optStr(form.get('filingDate')), status: optStr(form.get('status')), latest_order_date: optStr(form.get('orderDate')), amount_involved: optNum(form.get('amount')), source_key: optStr(form.get('sourceKey')) ?? 'ECOURTS', evidence_class: evidenceEnum.parse(form.get('evidenceClass') ?? 'OFFICIAL_PUBLIC_RECORD'), identity_confidence: optNum(form.get('identityConfidence')), match_status: optStr(form.get('matchStatus')), review_status: 'PENDING', note: optStr(form.get('note')) });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'legal.attach', clientId, entityTable: 'legal_matters' });
    revalidate(clientId);
    void staff;
  });
}

export async function reviewLegalMatter(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const id = uuid.parse(form.get('id'));
    const { db, staff } = await guard('external:review');
    const { data, error } = await db.from('legal_matters').update({ review_status: z.enum(['CONFIRMED', 'NOT_THE_CLIENT', 'NEEDS_INFO']).parse(form.get('decision')), reviewed_by: staff.userId, reviewed_at: new Date().toISOString(), note: optStr(form.get('note')) }).eq('id', id).select('client_id').single();
    if (error) throw new Error(error.message);
    await audit(db, { action: 'legal.review', clientId: data.client_id, entityTable: 'legal_matters', entityId: id, details: { decision: form.get('decision') } });
    revalidate(data.client_id);
  });
}

export async function saveLandowner(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('clients:write');
    const csv = (k: string) => (form.get(k) ? String(form.get(k)).split(',').map((s) => s.trim()).filter(Boolean) : []);
    const { error } = await db.from('landowner_profiles').upsert({ client_id: clientId, stage: optStr(form.get('stage')) ?? 'LEAD', land_location: optStr(form.get('location')), survey_numbers: csv('surveyNumbers'), extent_acres: optNum(form.get('extent')), co_owners: csv('coOwners'), title_documents: csv('titleDocs'), patta_status: optStr(form.get('patta')), ec_status: optStr(form.get('ec')), approval_potential: optStr(form.get('approvalPotential')), access: optStr(form.get('access')), road_frontage_ft: optNum(form.get('frontage')), current_use: optStr(form.get('currentUse')), expected_price: optNum(form.get('expectedPrice')), negotiable: form.get('negotiable') === 'on', reason_for_sale: optStr(form.get('reason')), timeline: optStr(form.get('timeline')), development: form.get('development') ? JSON.parse(String(form.get('development'))) : {}, updated_by: staff.userId, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'landowner.save', clientId, entityTable: 'landowner_profiles' });
    revalidate(clientId);
  });
}

export async function reviewDocument(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const id = uuid.parse(form.get('id'));
    const decision = z.enum(['VERIFIED', 'REJECTED', 'REPLACEMENT_REQUIRED', 'UNREADABLE', 'EXPIRED', 'UNDER_REVIEW']).parse(form.get('decision'));
    const { db, staff } = await guard('documents:request');
    if (decision === 'VERIFIED' && !hasPermission(staff.role, 'sensitive:reveal')) throw new Error('Marking a document VERIFIED requires a compliance / senior role');
    const patch: Record<string, unknown> = { status: decision, review_status: decision === 'UNDER_REVIEW' ? 'IN_REVIEW' : 'REVIEWED', reviewed_by: staff.userId, reviewed_at: new Date().toISOString(), review_note: optStr(form.get('note')) };
    if (decision === 'VERIFIED') { patch.evidence_class = 'VERIFIED'; patch.verification_provider = optStr(form.get('provider')) ?? 'MANUAL_REVIEW'; patch.verification_status = 'VERIFIED'; }
    if (form.get('nameOnDocument')) patch.name_on_document = String(form.get('nameOnDocument'));
    if (form.get('dobOnDocument')) patch.dob_on_document = String(form.get('dobOnDocument'));
    if (form.get('expiryDate')) patch.expiry_date = String(form.get('expiryDate'));
    const { data, error } = await db.from('client_documents').update(patch).eq('id', id).select('client_id,doc_type').single();
    if (error) throw new Error(error.message);
    await db.from('intelligence_events').insert({ client_id: data.client_id, event_type: 'DOCUMENT_REVIEWED', title: `${data.doc_type.replace(/_/g, ' ')} ${decision.toLowerCase().replace(/_/g, ' ')}`, source_key: 'DOCUMENTS', reviewer_status: 'REVIEWED', actor_id: staff.userId });
    await audit(db, { action: 'document.review', clientId: data.client_id, entityTable: 'client_documents', entityId: id, details: { decision } });
    revalidate(data.client_id);
  });
}

export async function mintPortalLink(form: FormData): Promise<ActionResult & { link?: string }> {
  try {
    const clientId = uuid.parse(form.get('clientId'));
    const { db } = await guard('documents:request');
    const { data, error } = await db.rpc('mint_portal_token', { p_client_id: clientId, p_days: Number(form.get('days') ?? 14) });
    if (error) throw new Error(error.message);
    revalidate(clientId);
    return { ok: true, message: 'Portal link created (share securely; it expires)', link: `/portal/${data as string}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function reviewPortalSubmission(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const id = uuid.parse(form.get('id'));
    const decision = z.enum(['ACCEPTED', 'REJECTED']).parse(form.get('decision'));
    const { db, staff } = await guard('clients:write');
    const { data: s, error } = await db.from('portal_submissions').update({ status: decision, reviewed_by: staff.userId, reviewed_at: new Date().toISOString() }).eq('id', id).select('*').single();
    if (error) throw new Error(error.message);
    const p = s.payload as Record<string, unknown>;
    if (decision === 'ACCEPTED') {
      if (s.kind === 'PROPERTY_REQUIREMENTS') await db.from('property_preferences').upsert({ client_id: s.client_id, buyer_type: (p.purpose === 'SELF_USE' ? 'END_USER' : p.purpose === 'INVESTMENT' ? 'INVESTOR' : 'MIXED_UNKNOWN'), buyer_type_basis: 'Client portal declaration', purpose: (p.purpose as string) ?? null, budget_min: p.budget_min ? Number(p.budget_min) : null, budget_max: p.budget_max ? Number(p.budget_max) : null, cities: String(p.cities ?? '').split(',').map((x) => x.trim()).filter(Boolean), property_types: String(p.property_types ?? 'PLOT').split(',').map((x) => x.trim()).filter(Boolean), plot_size_min_sqft: p.size_min ? Number(p.size_min) : null, plot_size_max_sqft: p.size_max ? Number(p.size_max) : null, horizon: (p.horizon as string) ?? null, financing: (p.financing as string) ?? null, field_evidence: { all: { evidence_class: 'CLIENT_DECLARED', source: 'client portal', date: new Date().toISOString().slice(0, 10) } }, declared_at: new Date().toISOString(), updated_by: staff.userId, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
      if (s.kind === 'SUITABILITY') await db.from('aif_suitability').upsert({ client_id: s.client_id, questionnaire: p, risk_profile: (p.risk_tolerance as string) ?? null, risk_profile_basis: 'Client portal suitability questionnaire', horizon: (p.horizon as string) ?? null, liquidity_needs: (p.liquidity as string) ?? null, expected_amount: p.expected_amount ? Number(p.expected_amount) : null, stage: 'SUITABILITY', updated_by: staff.userId, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
      if (s.kind === 'OBJECTIVES') await db.from('investor_profiles').insert({ client_id: s.client_id, objectives: String(p.objectives ?? '').split(',').map((x) => x.trim()).filter(Boolean), horizon: (p.horizon as string) ?? null, liquidity_needs: (p.liquidity as string) ?? null, risk_tolerance: (p.risk_tolerance as string) ?? null, experience: (p.experience as string) ?? null, income_range: (p.income_range as string) ?? null, net_worth_range: (p.net_worth_range as string) ?? null, source_of_funds: (p.source_of_funds as string) ?? null, source_of_wealth: (p.source_of_wealth as string) ?? null, expected_investment_amount: p.expected_amount ? Number(p.expected_amount) : null, preferences: String(p.preferences ?? '').split(',').map((x) => x.trim()).filter(Boolean), declaration: { declaredBy: 'CLIENT', capturedVia: 'CLIENT_PORTAL', clientConfirmed: true }, captured_by: staff.userId });
      if (s.kind === 'CONTACT_PREFERENCES') await db.from('contact_controls').upsert({ client_id: s.client_id, preferred_channel: (p.channel as string) ?? null, preferred_language: (p.language as string) ?? 'en', preferred_format: (p.format as string) ?? null, marketing_permission: p.marketing === true || p.marketing === 'on', updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
      if (s.kind === 'CORRECTION') await db.from('disputes').insert({ client_id: s.client_id, entity_table: String(p.entity ?? 'personal_details'), field_key: (p.field as string) ?? null, flag: 'DISPUTED', reason: `Client correction via portal: ${String(p.detail ?? '')}`, raised_by: staff.userId });
    }
    await audit(db, { action: 'portal.submission_review', clientId: s.client_id, entityTable: 'portal_submissions', entityId: id, details: { kind: s.kind, decision } });
    revalidate(s.client_id);
  });
}

/* ---------------- Inventory admin ---------------- */
export async function upsertDdItem(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const projectId = uuid.parse(form.get('projectId'));
    const { db, staff } = await guard('clients:write');
    const { error } = await db.from('property_due_diligence').upsert({ project_id: projectId, item_key: z.string().parse(form.get('itemKey')), status: z.enum(['VERIFIED', 'PENDING', 'NOT_AVAILABLE', 'POTENTIAL_ISSUE', 'CRITICAL_ISSUE']).parse(form.get('status')), finding: optStr(form.get('finding')), source: optStr(form.get('source')), reviewer_id: staff.userId, checked_at: new Date().toISOString() }, { onConflict: 'project_id,item_key' });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'property.dd_update', entityTable: 'property_due_diligence', entityId: projectId, details: { item: form.get('itemKey'), status: form.get('status') } });
    revalidatePath('/inventory');
    revalidatePath(`/inventory/${projectId}`);
  });
}

export async function updatePlotPrice(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const plotId = uuid.parse(form.get('plotId'));
    const { db, staff } = await guard('clients:write');
    const { data: plot } = await db.from('plots').select('price,project_id').eq('id', plotId).single();
    const negotiated = optNum(form.get('negotiated'));
    const { data: rule } = await db.from('compliance_rules').select('value').eq('key', 'sales.discount_approval_above_pct').maybeSingle();
    const maxPct = (rule?.value as { pct?: number } | undefined)?.pct ?? 5;
    if (negotiated !== null && plot?.price && (1 - negotiated / Number(plot.price)) * 100 > maxPct && !hasPermission(staff.role, 'risk:escalate')) throw new Error(`Discount above ${maxPct}% requires senior approval`);
    const { error } = await db.from('plots').update({ negotiated_price: negotiated, status: optStr(form.get('status')) ?? undefined }).eq('id', plotId);
    if (error) throw new Error(error.message);
    await audit(db, { action: 'plot.price', entityTable: 'plots', entityId: plotId, details: { negotiated, listPrice: plot?.price } });
    revalidatePath(`/inventory/${plot?.project_id}`);
  });
}
