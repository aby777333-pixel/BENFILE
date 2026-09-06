'use server';
/**
 * Analyst workspace server actions. Every action: authenticates, checks the permission,
 * performs the write under RLS, writes an audit row, and revalidates the client pages.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/lib/db/audit';
import { getStaff } from '@/lib/db/server';
import { buildSubject, runExternalSearch } from '@/lib/external/orchestrator';
import { compareTimeline, type TimelineEntry } from '@/lib/external/timeline';
import { hasPermission, type Permission } from '@/lib/security/permissions';
import type { CanonicalProfile } from '@/lib/canonical/types';
import { ingestVerification } from '@/lib/db/ingest';

async function guard(perm: Permission) {
  const { db, staff } = await getStaff();
  if (!staff) throw new Error('Not signed in');
  if (!hasPermission(staff.role, perm)) throw new Error(`Your role does not have ${perm}`);
  return { db, staff };
}
const uuid = z.string().uuid();
const revalidate = (clientId: string) => {
  revalidatePath(`/clients/${clientId}`, 'layout');
  revalidatePath('/dashboard');
  revalidatePath('/cases');
};

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
const wrap = async (fn: () => Promise<string | void>): Promise<ActionResult> => {
  try {
    const m = await fn();
    return { ok: true, message: m ?? undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
};

/* ---------------- Risk signals ---------------- */
export async function reviewSignal(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const id = uuid.parse(form.get('id'));
    const status = z.enum(['REVIEWED', 'ESCALATED', 'DISMISSED', 'RESOLVED', 'NEEDS_REVIEW']).parse(form.get('status'));
    const notes = z.string().max(2000).optional().parse(form.get('notes') ?? undefined);
    const { db, staff } = await guard(status === 'ESCALATED' ? 'risk:escalate' : 'risk:review');
    const { data: sig } = await db.from('risk_signals').select('client_id,status').eq('id', id).single();
    const { error } = await db.from('risk_signals').update({ status, reviewer_id: staff.userId, reviewer_notes: notes || null, reviewed_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    await audit(db, { action: 'risk.status_change', clientId: sig?.client_id, entityTable: 'risk_signals', entityId: id, details: { from: sig?.status, to: status } });
    await db.from('intelligence_events').insert({ client_id: sig?.client_id, event_type: 'RISK_REVIEWED', title: `Risk signal ${status.toLowerCase()}`, detail: notes || null, previous_value: sig?.status, new_value: status, reviewer_status: 'REVIEWED', actor_id: staff.userId });
    if (sig?.client_id) revalidate(sig.client_id);
    return `Signal marked ${status.toLowerCase()}`;
  });
}

/* ---------------- Notes ---------------- */
export async function addNote(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const body = z.string().min(2).max(5000).parse(form.get('body'));
    const kind = z.enum(['NOTE', 'ASSESSMENT', 'ESCALATION']).parse(form.get('kind') ?? 'NOTE');
    const caseId = form.get('caseId') ? uuid.parse(form.get('caseId')) : null;
    const { db, staff } = await guard('notes:write');
    const { error } = await db.from('analyst_notes').insert({ client_id: clientId, case_id: caseId, author_id: staff.userId, kind, body });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'note.add', clientId, entityTable: 'analyst_notes', details: { kind, caseId } });
    revalidate(clientId);
  });
}

/* ---------------- Cases ---------------- */
export async function openCase(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const title = z.string().min(3).max(200).parse(form.get('title'));
    const priority = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).parse(form.get('priority') ?? 'NORMAL');
    const assignedTo = form.get('assignedTo') ? uuid.parse(form.get('assignedTo')) : null;
    const { db, staff } = await guard('cases:manage');
    const { data, error } = await db.from('cases').insert({ client_id: clientId, title, priority, assigned_to: assignedTo, opened_by: staff.userId }).select('id,case_code').single();
    if (error) throw new Error(error.message);
    await db.from('clients').update({ review_status: 'IN_REVIEW', assigned_to: assignedTo ?? undefined }).eq('id', clientId);
    await audit(db, { action: 'case.open', clientId, entityTable: 'cases', entityId: data.id, details: { title, priority, assignedTo } });
    await db.from('intelligence_events').insert({ client_id: clientId, event_type: 'CASE_OPENED', title: `Case ${data.case_code} opened`, detail: title, actor_id: staff.userId });
    revalidate(clientId);
    return `Case ${data.case_code} opened`;
  });
}

export async function updateCase(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const id = uuid.parse(form.get('id'));
    const status = form.get('status') ? z.enum(['OPEN', 'IN_REVIEW', 'ESCALATED', 'AWAITING_CLIENT', 'CLOSED']).parse(form.get('status')) : null;
    const assignedTo = form.get('assignedTo') !== null ? (form.get('assignedTo') ? uuid.parse(form.get('assignedTo')) : null) : undefined;
    const closureReason = z.string().max(500).optional().parse(form.get('closureReason') ?? undefined);
    const { db, staff } = await guard(assignedTo !== undefined ? 'cases:assign' : status === 'ESCALATED' ? 'risk:escalate' : 'cases:manage');
    const { data: c } = await db.from('cases').select('client_id,status,assigned_to').eq('id', id).single();
    const patch: Record<string, unknown> = {};
    if (status) patch.status = status;
    if (assignedTo !== undefined) patch.assigned_to = assignedTo;
    if (status === 'CLOSED') {
      patch.closed_at = new Date().toISOString();
      patch.closure_reason = closureReason || null;
    }
    const { error } = await db.from('cases').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
    if (c?.client_id) {
      const review = status === 'CLOSED' ? 'REVIEWED' : status === 'ESCALATED' ? 'ESCALATED' : status ? 'IN_REVIEW' : undefined;
      await db.from('clients').update({ ...(review ? { review_status: review } : {}), ...(assignedTo !== undefined ? { assigned_to: assignedTo } : {}) }).eq('id', c.client_id);
      await audit(db, { action: assignedTo !== undefined ? 'case.assign' : 'case.status_change', clientId: c.client_id, entityTable: 'cases', entityId: id, details: { from: c.status, to: status, assignedFrom: c.assigned_to, assignedTo } });
      await db.from('intelligence_events').insert({ client_id: c.client_id, event_type: 'CASE_UPDATED', title: status ? `Case ${status.toLowerCase().replace('_', ' ')}` : 'Case reassigned', detail: closureReason || null, previous_value: c.status, new_value: status ?? c.status, actor_id: staff.userId });
      revalidate(c.client_id);
    }
  });
}

/* ---------------- Client status ---------------- */
export async function setClientStatus(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const status = z.enum(['PENDING', 'VERIFIED', 'NEEDS_REVIEW', 'PARTIAL', 'REJECTED', 'ARCHIVED']).parse(form.get('status'));
    const { db, staff } = await guard('clients:write');
    const { data: prev } = await db.from('clients').select('status').eq('id', clientId).single();
    const { error } = await db.from('clients').update({ status, review_status: status === 'VERIFIED' ? 'REVIEWED' : undefined }).eq('id', clientId);
    if (error) throw new Error(error.message);
    await audit(db, { action: 'client.status_change', clientId, entityTable: 'clients', entityId: clientId, details: { from: prev?.status, to: status } });
    await db.from('intelligence_events').insert({ client_id: clientId, event_type: 'STATUS_CHANGED', title: `Profile status set to ${status.replace('_', ' ')}`, previous_value: prev?.status, new_value: status, reviewer_status: 'REVIEWED', actor_id: staff.userId });
    revalidate(clientId);
  });
}

/* ---------------- Document requests ---------------- */
export async function requestDocument(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const documentType = z.string().min(2).max(120).parse(form.get('documentType'));
    const reason = z.string().max(500).optional().parse(form.get('reason') ?? undefined);
    const { db, staff } = await guard('documents:request');
    const { error } = await db.from('document_requests').insert({ client_id: clientId, document_type: documentType, reason: reason || null, requested_by: staff.userId });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'document.request', clientId, entityTable: 'document_requests', details: { documentType } });
    await db.from('intelligence_events').insert({ client_id: clientId, event_type: 'DOCUMENT_REQUESTED', title: `Document requested: ${documentType}`, detail: reason || null, actor_id: staff.userId });
    revalidate(clientId);
  });
}

export async function fulfilDocumentRequest(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const id = uuid.parse(form.get('id'));
    const status = z.enum(['RECEIVED', 'CANCELLED']).parse(form.get('status'));
    const { db } = await guard('documents:request');
    const { data: r } = await db.from('document_requests').select('client_id').eq('id', id).single();
    const { error } = await db.from('document_requests').update({ status, fulfilled_at: status === 'RECEIVED' ? new Date().toISOString() : null }).eq('id', id);
    if (error) throw new Error(error.message);
    await audit(db, { action: 'document.request_update', clientId: r?.client_id, entityTable: 'document_requests', entityId: id, details: { status } });
    if (r?.client_id) revalidate(r.client_id);
  });
}

/* ---------------- Disputes / corrections ---------------- */
export async function raiseDispute(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const entityTable = z.string().min(2).max(60).parse(form.get('entityTable'));
    const fieldKey = z.string().max(120).optional().parse(form.get('fieldKey') ?? undefined);
    const flag = z.enum(['INCORRECT', 'OUTDATED', 'WRONG_PERSON', 'DISPUTED', 'UNVERIFIED', 'SOURCE_ERROR']).parse(form.get('flag'));
    const reason = z.string().min(3).max(1000).parse(form.get('reason'));
    const { db, staff } = await guard('notes:write');
    const { error } = await db.from('disputes').insert({ client_id: clientId, entity_table: entityTable, field_key: fieldKey || null, flag, reason, raised_by: staff.userId });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'dispute.raise', clientId, entityTable, fieldKey, details: { flag } });
    await db.from('intelligence_events').insert({ client_id: clientId, event_type: 'DATA_DISPUTED', title: `Data flagged as ${flag.replace('_', ' ').toLowerCase()}`, detail: `${entityTable}${fieldKey ? ` / ${fieldKey}` : ''}: ${reason}`, actor_id: staff.userId });
    revalidate(clientId);
  });
}

export async function resolveDispute(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const id = uuid.parse(form.get('id'));
    const resolution = z.string().min(3).max(1000).parse(form.get('resolution'));
    const status = z.enum(['CORRECTED', 'UPHELD', 'REJECTED']).parse(form.get('status'));
    const { db, staff } = await guard('disputes:manage');
    const { data: d } = await db.from('disputes').select('client_id,flag').eq('id', id).single();
    const { error } = await db.from('disputes').update({ status, resolution, resolved_by: staff.userId, resolved_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    await audit(db, { action: 'dispute.resolve', clientId: d?.client_id, entityTable: 'disputes', entityId: id, details: { status } });
    if (d?.client_id) revalidate(d.client_id);
  });
}

/* ---------------- Consent ---------------- */
export async function recordConsent(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const purpose = z.string().min(3).max(300).parse(form.get('purpose'));
    const purposeCode = z.string().max(60).parse(form.get('purposeCode') ?? 'KYC_ONBOARDING');
    const reference = z.string().max(120).optional().parse(form.get('reference') ?? undefined);
    const expiresAt = form.get('expiresAt') ? new Date(String(form.get('expiresAt'))).toISOString() : null;
    const sources = form.getAll('sources').map(String);
    const { db, staff } = await guard('consent:manage');
    const { error } = await db.from('consents').insert({ client_id: clientId, status: 'GRANTED', purpose, purpose_code: purposeCode, granted_at: new Date().toISOString(), expires_at: expiresAt, sources_authorized: sources, consent_reference: reference || null, captured_by: staff.userId });
    if (error) throw new Error(error.message);
    await db.from('clients').update({ consent_status: 'GRANTED' }).eq('id', clientId);
    await audit(db, { action: 'consent.record', clientId, entityTable: 'consents', details: { purposeCode, sources, expiresAt } });
    revalidate(clientId);
  });
}

/* ---------------- External intelligence ---------------- */
export async function runExternalIntelligence(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const purpose = z.string().min(3).max(300).parse(form.get('purpose'));
    const connectorKeys = form.getAll('connectors').map(String);
    const { db, staff } = await guard('external:search');
    const { data: client } = await db.from('clients').select('latest_run_id,display_name').eq('id', clientId).single();
    if (!client?.latest_run_id) throw new Error('Run a verification before external intelligence.');
    const { data: consent } = await db.from('consents').select('id,sources_authorized,expires_at,status').eq('client_id', clientId).eq('status', 'GRANTED').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!consent) throw new Error('No granted consent on file. Record consent and lawful purpose first.');
    if (consent.expires_at && new Date(consent.expires_at) < new Date()) throw new Error('Consent has expired; re-capture before searching.');
    const { data: run } = await db.from('verification_runs').select('canonical').eq('id', client.latest_run_id).single();
    const [{ data: emails }, { data: phones }] = await Promise.all([db.from('emails').select('email_hash').eq('run_id', client.latest_run_id), db.from('phone_numbers').select('number_hash').eq('run_id', client.latest_run_id)]);
    const subject = buildSubject(run!.canonical as CanonicalProfile, { emailHashes: (emails ?? []).map((e) => e.email_hash), phoneHashes: (phones ?? []).map((p) => p.number_hash) });
    const result = await runExternalSearch(subject, { purpose, consentSources: consent.sources_authorized as string[], connectorKeys });

    const { data: search, error: sErr } = await db.from('external_searches').insert({ client_id: clientId, consent_id: consent.id, purpose, connectors: result.connectorsRun, requested_by: staff.userId, completed_at: new Date().toISOString(), summary: { ...result.summary, skipped: result.connectorsSkipped } }).select('id').single();
    if (sErr) throw new Error(sErr.message);
    let added = 0;
    for (const f of result.findings) {
      const { error } = await db.from('external_findings').upsert(
        { client_id: clientId, search_id: search.id, connector_key: f.connectorKey, result_type: f.resultType, title: f.title, excerpt: f.excerpt, url: f.url, source_name: `${f.sourceName}${f.mode === 'SANDBOX' ? '' : ''}`, source_class: f.sourceClass, tier: f.tier, record_id: f.recordId, published_at: f.publishedAt, retrieved_at: f.retrievedAt, match_score: f.match.score, match_status: f.match.status, match_reasons: { reasons: f.match.reasons, gaps: f.match.gaps }, category: f.category, severity: f.severity, entity_role: f.entityRole ?? null, data: { ...f.data, mode: f.mode, categoryLabel: f.categoryLabel, humanReviewRequired: f.humanReviewRequired, connectorName: f.connectorName } },
        { onConflict: 'client_id,connector_key,record_id', ignoreDuplicates: true },
      );
      if (!error) added++;
    }
    await db.from('refresh_schedules').upsert({ client_id: clientId, last_checked_at: new Date().toISOString(), next_permitted_at: new Date(Date.now() + 90 * 86_400_000).toISOString(), sources_checked: result.connectorsRun, authorized_until: consent.expires_at, consent_id: consent.id, updated_at: new Date().toISOString() });
    await audit(db, { action: 'external.search', clientId, entityTable: 'external_searches', entityId: search.id, details: { purpose, connectors: result.connectorsRun, findings: result.findings.length, skipped: result.connectorsSkipped } });
    await db.from('intelligence_events').insert({ client_id: clientId, event_type: 'EXTERNAL_SEARCH', title: `External intelligence search run (${result.findings.length} findings)`, detail: `Connectors: ${result.connectorsRun.join(', ')}${result.connectorsSkipped.length ? `; skipped: ${result.connectorsSkipped.map((s) => s.key).join(', ')}` : ''}`, source_key: 'EXTERNAL', actor_id: staff.userId });
    revalidate(clientId);
    return `${result.findings.length} findings retrieved (${added} new). ${result.summary.reviewRequired} require human review.`;
  });
}

const GRAPH_TYPE: Record<string, string> = { CORPORATE_RECORD: 'COMPANY', DIRECTORSHIP: 'DIRECTORSHIP', PROFESSIONAL_PROFILE: 'PROFESSIONAL_PROFILE', SOCIAL_PROFILE: 'SOCIAL_PROFILE', NEWS: 'NEWS', LEGAL_RECORD: 'LEGAL_RECORD', REGULATORY_RECORD: 'REGULATORY', PUBLIC_ASSET: 'ASSET', WEB_MENTION: 'WEBSITE', GOVERNMENT_RECORD: 'REGULATORY', SANCTIONS_SCREEN: 'REGULATORY', PEP_SCREEN: 'REGULATORY' };
const GRAPH_RELATION: Record<string, string> = { CORPORATE_RECORD: 'ASSOCIATED_WITH', DIRECTORSHIP: 'DIRECTOR_OF', PROFESSIONAL_PROFILE: 'HAS_PROFILE', SOCIAL_PROFILE: 'HAS_PROFILE', NEWS: 'MENTIONED_IN', LEGAL_RECORD: 'PARTY_TO', REGULATORY_RECORD: 'SUBJECT_OF', PUBLIC_ASSET: 'POSSIBLY_OWNS', WEB_MENTION: 'LINKED_TO', GOVERNMENT_RECORD: 'SCREENED_IN', SANCTIONS_SCREEN: 'SCREENED_IN', PEP_SCREEN: 'SCREENED_IN' };

export async function reviewFinding(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const id = uuid.parse(form.get('id'));
    const decision = z.enum(['ADDED', 'REJECTED', 'FLAGGED', 'PENDING']).parse(form.get('decision'));
    const note = z.string().max(1000).optional().parse(form.get('note') ?? undefined);
    const { db, staff } = await guard('external:review');
    const { data: f } = await db.from('external_findings').select('*').eq('id', id).single();
    if (!f) throw new Error('Finding not found');
    const { error } = await db.from('external_findings').update({ review_status: decision, reviewed_by: staff.userId, reviewed_at: new Date().toISOString(), review_note: note || null }).eq('id', id);
    if (error) throw new Error(error.message);
    const { data: client } = await db.from('clients').select('display_name,latest_run_id').eq('id', f.client_id).single();
    if (decision === 'ADDED') {
      const status = f.match_status === 'CONFIRMED' ? 'CONFIRMED' : 'POSSIBLE';
      await db.from('relationships').upsert(
        { client_id: f.client_id, from_type: 'CLIENT', from_id: f.client_id, from_label: client?.display_name ?? 'Client', to_type: GRAPH_TYPE[f.result_type] ?? 'ENTITY', to_id: f.record_id ?? f.id, to_label: f.title, relation: f.entity_role ? `${GRAPH_RELATION[f.result_type]}_AS_${f.entity_role}` : (GRAPH_RELATION[f.result_type] ?? 'ASSOCIATED_WITH'), status, confidence: f.match_score, source_key: f.connector_key.replace('-sandbox', '').toUpperCase(), tier: f.tier, evidence: { findingId: f.id, url: f.url, reasons: f.match_reasons, reviewedBy: staff.userId }, finding_id: f.id },
        { onConflict: 'client_id,from_type,from_id,to_type,to_id,relation' },
      );
      // Professional timeline comparison when a profile with a career timeline is attached.
      const timeline = (f.data as { timeline?: TimelineEntry[] })?.timeline;
      if (timeline?.length && client?.latest_run_id) {
        const { data: run } = await db.from('verification_runs').select('canonical').eq('id', client.latest_run_id).single();
        const cmp = compareTimeline(timeline, run!.canonical as CanonicalProfile);
        await db.from('intelligence_events').insert({ client_id: f.client_id, event_type: 'TIMELINE_COMPARED', title: `Career timeline vs EPFO: ${cmp.status.replace(/_/g, ' ')}`, detail: cmp.explanation, source_key: f.connector_key, finding_id: f.id, reviewer_status: 'REVIEWED', actor_id: staff.userId });
        if (cmp.status === 'INCONSISTENCY_REQUIRING_REVIEW') {
          await db.from('risk_signals').upsert({ client_id: f.client_id, run_id: client.latest_run_id, fingerprint: `timeline:${f.id}`, rule_key: 'external.timeline_inconsistency', category: 'EMPLOYMENT', severity: 'LOW', origin: 'EXTERNAL', source_key: f.connector_key.replace('-sandbox', '').toUpperCase(), title: 'Public career timeline differs from verified employment', explanation: cmp.explanation, evidence: cmp.rows, status: 'NEEDS_REVIEW', requires_review: true }, { onConflict: 'client_id,fingerprint' });
        }
      }
      if (f.category === 'POTENTIAL_ADVERSE' || f.result_type === 'LEGAL_RECORD' || ((f.data as { hits?: number })?.hits ?? 0) > 0) {
        await db.from('risk_signals').upsert({ client_id: f.client_id, run_id: client?.latest_run_id ?? null, fingerprint: `finding:${f.id}`, rule_key: f.result_type === 'LEGAL_RECORD' ? 'external.legal_record' : f.category === 'POTENTIAL_ADVERSE' ? 'external.adverse_media' : 'external.screening_hit', category: f.result_type === 'LEGAL_RECORD' ? 'LEGAL' : f.category === 'POTENTIAL_ADVERSE' ? 'ADVERSE_MEDIA' : 'SANCTIONS', severity: f.severity ?? 'MEDIUM', origin: 'EXTERNAL', source_key: f.connector_key.replace('-sandbox', '').toUpperCase(), title: f.title, explanation: `${(f.data as { categoryLabel?: string })?.categoryLabel ?? f.result_type}. Identity match: ${f.match_status.replace(/_/g, ' ')} (${f.match_score}%). Attached by ${staff.fullName}.`, evidence: [{ label: 'Source', sourceKey: f.connector_key, value: f.source_name }, ...(f.url ? [{ label: 'URL', sourceKey: f.connector_key, value: f.url }] : [])], status: 'NEEDS_REVIEW', requires_review: true }, { onConflict: 'client_id,fingerprint' });
      }
    }
    await audit(db, { action: 'external.finding_review', clientId: f.client_id, entityTable: 'external_findings', entityId: id, details: { decision, resultType: f.result_type, matchStatus: f.match_status } });
    await db.from('intelligence_events').insert({ client_id: f.client_id, event_type: decision === 'ADDED' ? 'FINDING_ATTACHED' : decision === 'REJECTED' ? 'FINDING_REJECTED' : 'FINDING_FLAGGED', title: `${decision === 'ADDED' ? 'Attached' : decision === 'REJECTED' ? 'Rejected' : 'Flagged'}: ${f.title}`, detail: `${f.result_type.replace(/_/g, ' ')} - ${f.source_name} - match ${f.match_status.replace(/_/g, ' ')} ${f.match_score}%${note ? ` - ${note}` : ''}`, source_key: f.connector_key, finding_id: f.id, reviewer_status: 'REVIEWED', actor_id: staff.userId });
    revalidate(f.client_id);
  });
}

/* ---------------- Investor profile ---------------- */
export async function saveInvestorProfile(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const clientId = uuid.parse(form.get('clientId'));
    const { db, staff } = await guard('investor:capture');
    const str = (k: string) => (form.get(k) ? String(form.get(k)) : null);
    const amount = form.get('expectedAmount') ? Number(form.get('expectedAmount')) : null;
    const { data: consent } = await db.from('consents').select('id').eq('client_id', clientId).eq('status', 'GRANTED').order('created_at', { ascending: false }).limit(1).maybeSingle();
    const { error } = await db.from('investor_profiles').insert({
      client_id: clientId,
      consent_id: consent?.id ?? null,
      objectives: form.getAll('objectives').map(String),
      horizon: str('horizon'),
      liquidity_needs: str('liquidity'),
      risk_tolerance: str('riskTolerance'),
      experience: str('experience'),
      income_range: str('incomeRange'),
      net_worth_range: str('netWorthRange'),
      source_of_funds: str('sourceOfFunds'),
      source_of_wealth: str('sourceOfWealth'),
      expected_investment_amount: Number.isFinite(amount) ? amount : null,
      preferences: form.getAll('preferences').map(String),
      declaration: { declaredBy: 'CLIENT', capturedVia: 'ANALYST_FORM', clientConfirmed: form.get('confirmed') === 'on' },
      captured_by: staff.userId,
    });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'investor.capture', clientId, entityTable: 'investor_profiles' });
    await db.from('intelligence_events').insert({ client_id: clientId, event_type: 'INVESTOR_PROFILE', title: 'Investor profile captured (client declared)', actor_id: staff.userId });
    revalidate(clientId);
  });
}

/* ---------------- Reports ---------------- */
export async function exportReport(form: FormData) {
  const clientId = uuid.parse(form.get('clientId'));
  const { db, staff } = await guard('reports:export');
  const { data: client } = await db.from('clients').select('latest_run_id,client_code').eq('id', clientId).single();
  const reference = `RPT-${client?.client_code ?? 'BF'}-${Date.now().toString(36).toUpperCase()}`;
  const sections = ['overview', 'identity', 'contact', 'address', 'employment', 'credit', 'banking', 'risk', 'quality', 'evidence', 'notes', 'disclaimers'];
  const { error } = await db.from('report_exports').insert({ client_id: clientId, run_id: client?.latest_run_id ?? null, reference, format: 'HTML', sections, masked: true, exported_by: staff.userId });
  if (error) throw new Error(error.message);
  await audit(db, { action: 'report.export', clientId, entityTable: 'report_exports', entityId: reference, details: { sections, masked: true } });
  await db.from('intelligence_events').insert({ client_id: clientId, event_type: 'REPORT_EXPORTED', title: `Report ${reference} generated`, actor_id: staff.userId });
  redirect(`/reports/${clientId}?ref=${reference}`);
}

/* ---------------- Ingest from the UI ---------------- */
export async function ingestFromForm(form: FormData): Promise<ActionResult & { clientId?: string }> {
  try {
    const { db, staff } = await guard('verification:ingest');
    const rawText = z.string().min(2).parse(form.get('raw'));
    let raw: unknown;
    try {
      raw = JSON.parse(rawText);
    } catch {
      return { ok: false, error: 'Payload is not valid JSON.' };
    }
    const clientId = form.get('clientId') ? uuid.parse(form.get('clientId')) : null;
    const purpose = z.string().min(3).max(300).parse(form.get('purpose'));
    const reference = z.string().max(120).optional().parse(form.get('consentReference') ?? undefined);
    const expiresAt = form.get('expiresAt') ? new Date(String(form.get('expiresAt'))).toISOString() : null;
    const sources = form.getAll('sources').map(String);
    if (!clientId && form.get('consentConfirmed') !== 'on') return { ok: false, error: 'Confirm that consent and a lawful purpose are on file before ingesting.' };
    const r = await ingestVerification(db, { raw, clientId, actorId: staff.userId, snapshotLabel: form.get('label') ? String(form.get('label')) : null, consent: clientId ? undefined : { purpose, reference, expiresAt, sources: sources.length ? sources : undefined } });
    revalidate(r.clientId);
    revalidatePath('/clients');
    return { ok: true, clientId: r.clientId, message: `Run #${r.runSeq} ingested for ${r.clientCode}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/* ---------------- Scoring config ---------------- */
export async function saveScoringConfig(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const { db, staff } = await guard('scoring:configure');
    const version = z.string().min(3).max(40).regex(/^[a-z0-9.-]+$/i).parse(form.get('version'));
    const keys = ['identity', 'employment', 'credit', 'contact', 'completeness', 'risk'] as const;
    const weights = Object.fromEntries(keys.map((k) => [k, Number(form.get(k)) / 100]));
    const sum = Object.values(weights).reduce((s, v) => s + v, 0);
    if (Math.abs(sum - 1) > 0.001) throw new Error(`Weights must total 100% (currently ${Math.round(sum * 100)}%).`);
    if (weights.credit > 0.3) throw new Error('Credit weight is capped at 30% so the profile score never becomes a proxy credit score.');
    const notes = z.string().max(500).optional().parse(form.get('notes') ?? undefined);
    await db.from('scoring_configs').update({ is_active: false }).eq('is_active', true);
    const { error } = await db.from('scoring_configs').upsert({ version, weights, notes: notes || null, is_active: true, created_by: staff.userId });
    if (error) throw new Error(error.message);
    await audit(db, { action: 'scoring.config_change', entityTable: 'scoring_configs', entityId: version, details: { weights } });
    revalidatePath('/admin');
    return `Scoring config ${version} is now active for new runs.`;
  });
}

export async function updateStaffRole(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const { db } = await guard('users:manage');
    const userId = uuid.parse(form.get('userId'));
    const role = z.enum(['SUPER_ADMIN', 'COMPLIANCE_OFFICER', 'SENIOR_ANALYST', 'ANALYST', 'RELATIONSHIP_MANAGER', 'AUDITOR']).parse(form.get('role'));
    const isActive = form.get('isActive') === 'on';
    const { data: prev } = await db.from('staff_profiles').select('role,is_active').eq('user_id', userId).single();
    const { error } = await db.from('staff_profiles').update({ role, is_active: isActive }).eq('user_id', userId);
    if (error) throw new Error(error.message);
    await audit(db, { action: 'permissions.change', entityTable: 'staff_profiles', entityId: userId, details: { from: prev, to: { role, isActive } } });
    revalidatePath('/admin');
  });
}
