/**
 * Ingest pipeline: raw provider payload -> adapter -> canonical -> engines -> persisted snapshot.
 * Never overwrites a previous run; each ingest creates a new verification_run.
 */
import { createHash } from 'node:crypto';
import type { CanonicalProfile, Assessment } from '@/lib/canonical/types';
import { validateCanonical } from '@/lib/canonical/schema';
import { assessProfile } from '@/lib/engines/assess';
import { monthsBetween } from '@/lib/engines/normalize';
import { detectAdapter, getAdapter } from '@/lib/providers/registry';
import { hashIdentifier, maskByKind, type SensitiveKind } from '@/lib/security/masking';
import { log } from '@/lib/security/logger';
import { audit } from './audit';
import type { Db } from './server';
import type { ScoringConfig } from '@/lib/engines/scoring';

export interface IngestInput {
  raw: unknown;
  providerKey?: string;
  clientId?: string | null;
  actorId: string;
  snapshotLabel?: string | null;
  consent?: { purpose: string; purposeCode?: string; reference?: string | null; expiresAt?: string | null; sources?: string[] };
}

export interface IngestResult {
  clientId: string;
  runId: string;
  runSeq: number;
  clientCode: string;
  profile: CanonicalProfile;
  assessment: Assessment;
  warnings: string[];
}

const DOC_KIND: Record<string, SensitiveKind> = { PAN: 'PAN', AADHAAR: 'AADHAAR', PASSPORT: 'PASSPORT', VOTER_ID: 'VOTER_ID', DRIVING_LICENCE: 'DRIVING_LICENCE', RATION_CARD: 'RATION_CARD', GSTIN: 'GSTIN', DIN: 'DIN', OTHER: 'OTHER' };

async function loadActiveScoring(db: Db): Promise<ScoringConfig | undefined> {
  const { data } = await db.from('scoring_configs').select('version,weights,notes').eq('is_active', true).maybeSingle();
  return data ? { version: data.version, weights: data.weights as ScoringConfig['weights'], notes: data.notes ?? undefined } : undefined;
}

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`ingest ${step} failed: ${error?.message ?? 'unknown error'}`);
}

export async function ingestVerification(db: Db, input: IngestInput): Promise<IngestResult> {
  const adapter = input.providerKey ? getAdapter(input.providerKey) : detectAdapter(input.raw);
  if (!adapter) throw new Error('No adapter recognises this payload. Specify providerKey or register an adapter.');
  const { profile, warnings } = adapter.normalize(input.raw);
  const validation = validateCanonical(profile);
  if (!validation.success) {
    throw new Error(`Canonical validation failed: ${validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const scoring = await loadActiveScoring(db);
  const assessment = assessProfile(profile, { scoring });

  const displayName = profile.person.fullName.value ?? profile.identityDocuments.find((d) => d.nameOnDocument)?.nameOnDocument ?? `Client ${profile.verification.referenceId ?? profile.verification.verificationId}`;
  const current = profile.employment.records.find((r) => r.status === 'CURRENT');
  const city = profile.addresses[0]?.city ?? null;

  /* ---- client (create or reuse) ---- */
  let clientId = input.clientId ?? null;
  let clientCode = '';
  if (!clientId) {
    // Reuse a client if the same PAN hash already exists (prevents accidental duplicates).
    const pan = profile.identityDocuments.find((d) => d.docType === 'PAN')?.number;
    const panHash = hashIdentifier('PAN', pan);
    if (panHash) {
      const { data: found } = await db.rpc('find_clients_by_hash', { p_kind: 'PAN', p_hash: panHash });
      if (Array.isArray(found) && found.length) clientId = found[0] as string;
    }
  }
  if (!clientId) {
    const { data, error } = await db
      .from('clients')
      .insert({ display_name: displayName, country: adapter.country, status: 'PENDING', created_by: input.actorId, consent_status: input.consent ? 'GRANTED' : 'PENDING' })
      .select('id,client_code')
      .single();
    if (error) fail('client insert', error);
    clientId = data.id;
    clientCode = data.client_code;
    if (input.consent) {
      await db.from('consents').insert({
        client_id: clientId,
        status: 'GRANTED',
        purpose: input.consent.purpose,
        purpose_code: input.consent.purposeCode ?? 'KYC_ONBOARDING',
        granted_at: new Date().toISOString(),
        expires_at: input.consent.expiresAt ?? null,
        sources_authorized: input.consent.sources ?? adapter.domains,
        provider_key: adapter.key,
        consent_reference: input.consent.reference ?? null,
        captured_by: input.actorId,
      });
    }
  } else {
    const { data } = await db.from('clients').select('client_code').eq('id', clientId).single();
    clientCode = data?.client_code ?? '';
  }

  /* ---- run ---- */
  const { data: last } = await db.from('verification_runs').select('run_seq').eq('client_id', clientId).order('run_seq', { ascending: false }).limit(1).maybeSingle();
  const runSeq = (last?.run_seq ?? 0) + 1;
  const { data: run, error: runErr } = await db
    .from('verification_runs')
    .insert({
      client_id: clientId,
      run_seq: runSeq,
      provider_key: adapter.key,
      adapter_version: adapter.version,
      engine_version: assessment.engineVersion,
      verification_id: profile.verification.verificationId,
      reference_id: profile.verification.referenceId,
      status: profile.verification.status,
      requested_at: profile.verification.requestedAt,
      completed_at: profile.verification.completedAt,
      snapshot_label: input.snapshotLabel ?? (runSeq === 1 ? 'Initial verification' : `Re-verification #${runSeq}`),
      canonical: stripSensitive(profile),
      assessment,
      warnings,
      ingested_by: input.actorId,
    })
    .select('id')
    .single();
  if (runErr) fail('run insert', runErr);
  const runId = run.id as string;

  const rawJson = JSON.stringify(input.raw);
  const { error: rawErr } = await db.from('raw_provider_payloads').insert({ run_id: runId, client_id: clientId, payload: input.raw, sha256: createHash('sha256').update(rawJson).digest('hex') });
  if (rawErr) fail('raw payload insert', rawErr);

  /* ---- sensitive values helper ---- */
  const storeSensitive = async (kind: SensitiveKind, entityTable: string, fieldKey: string, value: string | null | undefined): Promise<string | null> => {
    const hash = hashIdentifier(kind, value);
    if (!value || !hash) return null;
    const { data, error } = await db.rpc('store_sensitive', { p_client_id: clientId, p_run_id: runId, p_kind: kind, p_entity_table: entityTable, p_field_key: fieldKey, p_value_full: value, p_value_hash: hash });
    if (error) fail('sensitive insert', error);
    return data as string;
  };

  /* ---- personal ---- */
  const inc = profile.person.income.value;
  await db.from('personal_details').insert({
    run_id: runId,
    client_id: clientId,
    full_name: profile.person.fullName.value,
    gender: profile.person.gender.value,
    dob: profile.person.dateOfBirth.value,
    age: profile.person.age.value,
    age_assertion: profile.person.age.provenance.assertion,
    occupation: profile.person.occupation.value,
    income_amount: inc?.amount ?? null,
    income_currency: inc?.currency ?? null,
    income_period: inc?.period ?? null,
    income_kind: inc?.kind ?? null,
    income_assertion: profile.person.income.provenance.assertion,
    income_source_key: profile.person.income.provenance.sourceKey,
    relatives: profile.person.relatives.map((r) => ({ name: r.name, relation: r.relation, source: r.provenance.sourceKey })),
    source_key: profile.person.fullName.provenance.sourceKey,
  });

  /* ---- documents ---- */
  for (const d of profile.identityDocuments) {
    const kind = DOC_KIND[d.docType] ?? 'OTHER';
    const svId = await storeSensitive(kind, 'identity_documents', d.docType, d.number);
    const { error } = await db.from('identity_documents').insert({
      run_id: runId,
      client_id: clientId,
      doc_type: d.docType,
      number_masked: d.number ? maskByKind(kind, d.number) : d.maskedNumber ? maskByKind(kind, d.maskedNumber) : null,
      number_hash: hashIdentifier(kind, d.number),
      sensitive_value_id: svId,
      name_on_document: d.nameOnDocument,
      subtype: d.subtype,
      status: d.status,
      aadhaar_linked: d.aadhaarLinked,
      source_key: d.provenance.sourceKey,
      tier: d.provenance.tier,
      assertion: d.provenance.assertion,
      evidence_path: d.provenance.evidencePath,
      retrieved_at: d.provenance.retrievedAt,
    });
    if (error) fail('identity_documents insert', error);
  }

  /* ---- addresses ---- */
  if (profile.addresses.length) {
    const { error } = await db.from('client_addresses').insert(
      profile.addresses.map((a) => ({
        run_id: runId,
        client_id: clientId,
        full_address: a.fullAddress,
        street: a.street,
        city: a.city,
        state: a.state,
        country: a.country,
        pin_code: a.pinCode,
        address_type: a.addressType,
        source_key: a.provenance.sourceKey,
        tier: a.provenance.tier,
        assertion: a.provenance.assertion,
        evidence_path: a.provenance.evidencePath,
      })),
    );
    if (error) fail('addresses insert', error);
  }

  /* ---- phones / emails ---- */
  for (const ph of profile.contacts.phones) {
    const svId = await storeSensitive('PHONE', 'phone_numbers', 'number', ph.number);
    const { error } = await db.from('phone_numbers').insert({ run_id: runId, client_id: clientId, number_masked: maskByKind('PHONE', ph.number), number_hash: hashIdentifier('PHONE', ph.number), sensitive_value_id: svId, phone_type: ph.phoneType, source_key: ph.provenance.sourceKey, tier: ph.provenance.tier, assertion: ph.provenance.assertion, evidence_path: ph.provenance.evidencePath });
    if (error) fail('phone insert', error);
  }
  for (const em of profile.contacts.emails) {
    const svId = await storeSensitive('EMAIL', 'emails', 'email', em.email);
    const { error } = await db.from('emails').insert({ run_id: runId, client_id: clientId, email_masked: maskByKind('EMAIL', em.email), email_hash: hashIdentifier('EMAIL', em.email), sensitive_value_id: svId, source_key: em.provenance.sourceKey, tier: em.provenance.tier, assertion: em.provenance.assertion, evidence_path: em.provenance.evidencePath });
    if (error) fail('email insert', error);
  }

  /* ---- bank ---- */
  for (const b of profile.bankAccounts) {
    const svId = await storeSensitive('BANK_ACCOUNT', 'bank_accounts', 'account_number', b.accountNumber);
    const { error } = await db.from('bank_accounts').insert({ run_id: runId, client_id: clientId, account_masked: maskByKind('BANK_ACCOUNT', b.accountNumber), account_hash: hashIdentifier('BANK_ACCOUNT', b.accountNumber), sensitive_value_id: svId, ifsc: b.ifsc, bank_name: b.bankName, branch: b.branch, account_type: b.accountType, holder_name: b.accountHolderName, verified: b.verified, source_key: b.provenance.sourceKey, tier: b.provenance.tier, assertion: b.provenance.assertion, evidence_path: b.provenance.evidencePath });
    if (error) fail('bank insert', error);
  }

  /* ---- employment ---- */
  for (const r of profile.employment.records) {
    let employerId: string | null = null;
    if (r.employer.establishmentId) {
      const { data: emp, error } = await db
        .from('employers')
        .upsert(
          { name: r.employer.name, establishment_id: r.employer.establishmentId, ownership_type: r.employer.ownershipType, setup_date: r.employer.setupDate, employee_count: r.employer.employeeCount, pf_filings: r.employer.pfFilings, confidence: r.employer.confidence, source_key: r.employer.provenance.sourceKey, first_seen_run_id: runId, updated_at: new Date().toISOString() },
          { onConflict: 'establishment_id' },
        )
        .select('id')
        .single();
      if (error) fail('employer upsert', error);
      employerId = emp.id;
    }
    const { error } = await db.from('employment_records').insert({ run_id: runId, client_id: clientId, employer_id: employerId, employer_name: r.employer.name, establishment_id: r.employer.establishmentId, status: r.status, joining_date: r.joiningDate, exit_date: r.exitDate, tenure_months: monthsBetween(r.joiningDate, r.exitDate), employee_name_on_record: r.employeeNameOnRecord, employee_name_match: r.employeeNameMatch, employer_name_match: r.employerNameMatch, employer_confidence: r.employer.confidence, source_key: r.provenance.sourceKey, tier: r.provenance.tier, assertion: r.provenance.assertion, evidence_path: r.provenance.evidencePath });
    if (error) fail('employment insert', error);
  }
  if (profile.employment.epfo) {
    const e = profile.employment.epfo;
    const uanId = await storeSensitive('UAN', 'epfo_records', 'uan', e.uan);
    const memId = await storeSensitive('PF_MEMBER_ID', 'epfo_records', 'member_id', e.memberId);
    const { error } = await db.from('epfo_records').insert({ run_id: runId, client_id: clientId, uan_masked: maskByKind('UAN', e.uan), uan_hash: hashIdentifier('UAN', e.uan), uan_sensitive_value_id: uanId, member_id_masked: maskByKind('PF_MEMBER_ID', e.memberId), member_id_sensitive_value_id: memId, aadhaar_linked: e.aadhaarLinked, pf_filing_available: e.pfFilingAvailable, employee_name_match: e.employeeNameMatch, source_key: e.provenance.sourceKey, assertion: e.provenance.assertion, evidence_path: e.provenance.evidencePath, retrieved_at: e.provenance.retrievedAt });
    if (error) fail('epfo insert', error);
  }

  /* ---- credit ---- */
  if (profile.credit) {
    const c = profile.credit;
    const { error } = await db.from('credit_profiles').insert({
      run_id: runId,
      client_id: clientId,
      score: c.score,
      band: c.band,
      bureau: c.bureau,
      score_date: c.scoreDate,
      identifiers_masked: Object.fromEntries(Object.entries(c.identifiers).map(([k, v]) => [k, k.toLowerCase() === 'pan' ? maskByKind('PAN', v) : v])),
      active_loans: c.summary.activeLoans,
      secured_loans: c.summary.securedLoans,
      unsecured_loans: c.summary.unsecuredLoans,
      credit_cards: c.summary.creditCards,
      total_outstanding: c.summary.totalOutstanding,
      utilization: c.summary.utilization,
      enquiries_12m: c.summary.enquiriesLast12m,
      delinquencies: c.summary.delinquencies,
      accounts: c.accounts,
      events: c.events,
      source_key: c.provenance.sourceKey,
      tier: c.provenance.tier,
      assertion: c.provenance.assertion,
      evidence_path: c.provenance.evidencePath,
      retrieved_at: c.provenance.retrievedAt,
    });
    if (error) fail('credit insert', error);
  }

  /* ---- mobile ---- */
  if (profile.mobile) {
    const m = profile.mobile;
    const { error } = await db.from('mobile_intelligence').insert({ run_id: runId, client_id: clientId, number_masked: maskByKind('PHONE', m.number), number_hash: hashIdentifier('PHONE', m.number), is_valid: m.isValid, subscriber_status: m.subscriberStatus, connection_type: m.connectionType, service_provider: m.serviceProvider, original_provider: m.originalProvider, network_region: m.networkRegion, is_ported: m.isPorted, source_key: m.provenance.sourceKey, assertion: m.provenance.assertion, evidence_path: m.provenance.evidencePath, retrieved_at: m.provenance.retrievedAt });
    if (error) fail('mobile insert', error);
  }

  /* ---- engine outputs ---- */
  if (assessment.identityChecks.length) {
    const { error } = await db.from('identity_checks').insert(assessment.identityChecks.map((c) => ({ run_id: runId, client_id: clientId, check_key: c.key, label: c.label, left_source: c.leftSource, right_source: c.rightSource, left_value_masked: c.leftValue, right_value_masked: c.rightValue, sensitive: c.sensitive, status: c.status, score: c.score, explanation: c.explanation })));
    if (error) fail('identity_checks insert', error);
  }
  if (assessment.dataQuality.length) {
    const { error } = await db.from('data_quality').insert(assessment.dataQuality.map((q) => ({ run_id: runId, client_id: clientId, source_key: q.sourceKey, label: q.label, tier: q.tier, available: q.available, verification_status: q.verificationStatus, retrieved_at: q.retrievedAt, last_updated_at: q.lastUpdatedAt, age_days: q.ageDays, freshness: q.freshness, confidence: q.confidence, completeness: q.completeness })));
    if (error) fail('data_quality insert', error);
  }
  {
    const { error } = await db.from('profile_scores').insert({ run_id: runId, client_id: clientId, config_version: assessment.score.configVersion, total: assessment.score.total, coverage: assessment.score.coverage, components: assessment.score.components, computed_at: assessment.score.computedAt });
    if (error) fail('profile_scores insert', error);
  }

  // Risk signals: upsert by fingerprint so analyst review state survives re-verification.
  for (const s of assessment.riskSignals) {
    const { data: existing } = await db.from('risk_signals').select('id,status').eq('client_id', clientId).eq('fingerprint', s.fingerprint).maybeSingle();
    if (existing) {
      await db.from('risk_signals').update({ run_id: runId, severity: s.severity, explanation: s.explanation, evidence: s.evidence, updated_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      const { error } = await db.from('risk_signals').insert({ client_id: clientId, run_id: runId, fingerprint: s.fingerprint, rule_key: s.ruleKey, category: s.category, severity: s.severity, origin: s.origin, source_key: s.sourceKey, title: s.title, explanation: s.explanation, evidence: s.evidence, detected_at: s.detectedAt, status: s.status, requires_review: s.requiresReview });
      if (error) fail('risk_signals insert', error);
    }
  }

  /* ---- relationships from verified data (confirmed, Tier 2) ---- */
  const rels: Array<Record<string, unknown>> = [];
  for (const r of profile.employment.records) {
    rels.push({ client_id: clientId, from_type: 'CLIENT', from_id: clientId, from_label: displayName, to_type: 'EMPLOYER', to_id: r.employer.establishmentId ?? r.employer.name, to_label: r.employer.name, relation: r.status === 'CURRENT' ? 'EMPLOYED_BY' : 'FORMERLY_EMPLOYED_BY', status: 'CONFIRMED', confidence: 100, source_key: 'UAN', tier: 2, evidence: { path: r.provenance.evidencePath, runId } });
  }
  for (const rel of profile.person.relatives) {
    rels.push({ client_id: clientId, from_type: 'CLIENT', from_id: clientId, from_label: displayName, to_type: 'RELATIVE', to_id: rel.name, to_label: rel.name, relation: rel.relation ?? 'RELATIVE', status: 'CONFIRMED', confidence: 100, source_key: rel.provenance.sourceKey, tier: rel.provenance.tier, evidence: { path: rel.provenance.evidencePath, runId } });
  }
  for (const a of profile.addresses) {
    const label = [a.city, a.state].filter(Boolean).join(', ') || a.fullAddress || 'Address';
    rels.push({ client_id: clientId, from_type: 'CLIENT', from_id: clientId, from_label: displayName, to_type: 'ADDRESS', to_id: `${a.provenance.sourceKey}:${a.pinCode ?? label}`, to_label: `${a.addressType ?? 'Address'} - ${label}`, relation: 'RESIDES_AT', status: 'CONFIRMED', confidence: 100, source_key: a.provenance.sourceKey, tier: a.provenance.tier, evidence: { path: a.provenance.evidencePath, runId } });
  }
  for (const b of profile.bankAccounts) {
    rels.push({ client_id: clientId, from_type: 'CLIENT', from_id: clientId, from_label: displayName, to_type: 'BANK', to_id: b.ifsc ?? b.bankName ?? 'bank', to_label: `${b.bankName ?? 'Bank'}${b.branch ? ` - ${b.branch}` : ''}`, relation: 'BANKS_WITH', status: 'CONFIRMED', confidence: 100, source_key: b.provenance.sourceKey, tier: b.provenance.tier, evidence: { path: b.provenance.evidencePath, runId } });
  }
  if (rels.length) await db.from('relationships').upsert(rels, { onConflict: 'client_id,from_type,from_id,to_type,to_id,relation', ignoreDuplicates: true });

  /* ---- timeline + client summary ---- */
  await db.from('intelligence_events').insert({ client_id: clientId, occurred_at: profile.verification.completedAt ?? new Date().toISOString(), event_type: runSeq === 1 ? 'VERIFICATION_INITIAL' : 'VERIFICATION_REFRESH', title: runSeq === 1 ? 'Initial verification' : `Verification refreshed (run #${runSeq})`, detail: `${adapter.name} - ${profile.verification.status}. ${assessment.riskSignals.length} signal(s), ${assessment.identityChecks.filter((c) => c.status === 'MISMATCH').length} mismatch(es).`, source_key: 'PROVIDER', run_id: runId, actor_id: input.actorId });

  const searchText = [displayName, clientCode, profile.verification.verificationId, profile.verification.referenceId, city, current?.employer.name, profile.person.occupation.value].filter(Boolean).join(' ');
  const { error: updErr } = await db
    .from('clients')
    .update({
      display_name: displayName,
      status: assessment.overall.profileStatus,
      risk_level: assessment.overall.riskLevel,
      credit_band: profile.credit?.band ?? 'NOT_AVAILABLE',
      employment_status: current ? 'CURRENT' : profile.employment.records.length ? 'EXITED' : 'UNKNOWN',
      occupation: profile.person.occupation.value,
      city,
      completeness: assessment.overall.completeness,
      freshness: assessment.overall.freshness,
      latest_run_id: runId,
      last_verified_at: profile.verification.completedAt ?? profile.verification.updatedAt ?? new Date().toISOString(),
      search_text: searchText,
    })
    .eq('id', clientId);
  if (updErr) fail('client update', updErr);

  await audit(db, { action: 'verification.ingest', clientId, entityTable: 'verification_runs', entityId: runId, details: { provider: adapter.key, runSeq, status: profile.verification.status, warnings: warnings.length } });
  log.info('ingest.completed', { clientId, runId, runSeq, provider: adapter.key });
  return { clientId: clientId as string, runId, runSeq, clientCode, profile, assessment, warnings };
}

/** The canonical JSON stored on the run must not carry full identifiers; they live in sensitive_values. */
export function stripSensitive(p: CanonicalProfile): CanonicalProfile {
  return {
    ...p,
    identityDocuments: p.identityDocuments.map((d) => ({ ...d, number: null, maskedNumber: d.number ? maskByKind(DOC_KIND[d.docType] ?? 'OTHER', d.number) : d.maskedNumber ? maskByKind(DOC_KIND[d.docType] ?? 'OTHER', d.maskedNumber) : null })),
    contacts: {
      phones: p.contacts.phones.map((x) => ({ ...x, number: maskByKind('PHONE', x.number) ?? 'XXXXX' })),
      emails: p.contacts.emails.map((x) => ({ ...x, email: maskByKind('EMAIL', x.email) ?? 'masked' })),
    },
    bankAccounts: p.bankAccounts.map((b) => ({ ...b, accountNumber: maskByKind('BANK_ACCOUNT', b.accountNumber) })),
    employment: { ...p.employment, epfo: p.employment.epfo ? { ...p.employment.epfo, uan: maskByKind('UAN', p.employment.epfo.uan), memberId: maskByKind('PF_MEMBER_ID', p.employment.epfo.memberId) } : null },
    mobile: p.mobile ? { ...p.mobile, number: maskByKind('PHONE', p.mobile.number) ?? null } : null,
    credit: p.credit ? { ...p.credit, identifiers: Object.fromEntries(Object.entries(p.credit.identifiers).map(([k, v]) => [k, k.toLowerCase() === 'pan' ? maskByKind('PAN', v) : v])) } : null,
  };
}
