/**
 * Seeds demo data through the real ingest pipeline as the demo Super Admin (RLS applies).
 *   npm run seed
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { ingestVerification } from '../src/lib/db/ingest';
import { buildSubject, runExternalSearch } from '../src/lib/external/orchestrator';

function loadEnv() {
  try {
    const txt = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* ignore */
  }
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const email = process.env.BENFILE_SEED_EMAIL ?? 'admin@benfile.local';
  const password = process.env.BENFILE_SEED_PASSWORD ?? '';
  if (!url || !anon || !password) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and BENFILE_SEED_PASSWORD');
  const db = createClient(url, anon, { auth: { persistSession: false } });
  const { data: auth, error } = await db.auth.signInWithPassword({ email, password });
  if (error || !auth.user) throw new Error(`sign-in failed: ${error?.message}`);
  const actorId = auth.user.id;
  const { data: staff } = await db.from('staff_profiles').select('user_id,full_name,role');
  const analyst = staff?.find((s) => s.role === 'ANALYST');
  const senior = staff?.find((s) => s.role === 'SENIOR_ANALYST');

  const full = JSON.parse(readFileSync(path.join(process.cwd(), 'fixtures', 'india-composite-sample.json'), 'utf8'));
  const sparse = JSON.parse(readFileSync(path.join(process.cwd(), 'fixtures', 'sparse-sample.json'), 'utf8'));

  const { data: existing } = await db.from('clients').select('id').limit(1);
  if (existing?.length) {
    console.log('Clients already exist; skipping seed. Delete rows to re-seed.');
    return;
  }

  console.log('Ingesting full sample...');
  const r1 = await ingestVerification(db, { raw: full, actorId, consent: { purpose: 'KYC onboarding and ongoing due diligence', purposeCode: 'KYC_ONBOARDING', reference: 'CONSENT-2026-0814-001', sources: ['IDENTITY', 'CONTACT', 'DOCUMENTS', 'ADDRESS', 'BANKING', 'EMPLOYMENT', 'MOBILE', 'CREDIT', 'RISK', 'CORPORATE', 'SCREENING', 'LEGAL', 'MEDIA', 'PROFESSIONAL', 'SOCIAL', 'WEB'] } });
  console.log(`  ${r1.clientCode} run #${r1.runSeq} - ${r1.assessment.overall.profileStatus} - ${r1.assessment.riskSignals.length} signals`);

  // Earlier snapshot for the same client so history/compare has two runs (older score, exited employer only).
  const earlier = structuredClone(full) as typeof full;
  earlier.verification_id = 'VER-2026-01-12-A1B2C3';
  earlier.created_at = '2026-01-12T10:00:00Z';
  earlier.completed_at = '2026-01-12T10:01:30Z';
  earlier.updated_at = '2026-01-12T10:01:30Z';
  earlier.data.credit.score = 781;
  earlier.data.credit.score_date = '2026-01-05';
  earlier.data.employment.history[0].pf_filings = earlier.data.employment.history[0].pf_filings.slice(0, 1);
  earlier.data.risk = [];
  // Insert the earlier run first by re-ingesting in order: simplest is to ingest it as run #2 labelled accordingly, then re-ingest current as #3.
  const r2 = await ingestVerification(db, { raw: earlier, clientId: r1.clientId, actorId, snapshotLabel: 'Initial verification (Jan 2026 snapshot, back-filled)' });
  const r3 = await ingestVerification(db, { raw: full, clientId: r1.clientId, actorId, snapshotLabel: 'Credit information refreshed' });
  console.log(`  history runs #${r2.runSeq}, #${r3.runSeq}`);

  console.log('Ingesting sparse sample...');
  const r4 = await ingestVerification(db, { raw: sparse, actorId, consent: { purpose: 'Employment verification for tenancy', purposeCode: 'EMPLOYMENT_VERIFICATION', reference: 'CONSENT-2025-1102-014', sources: ['IDENTITY', 'CONTACT', 'DOCUMENTS', 'ADDRESS', 'EMPLOYMENT', 'MOBILE', 'RISK'] } });
  console.log(`  ${r4.clientCode} run #${r4.runSeq} - ${r4.assessment.overall.profileStatus} - freshness ${r4.assessment.overall.freshness}`);

  console.log('Running external intelligence for the first client...');
  const [{ data: emails }, { data: phones }] = await Promise.all([db.from('emails').select('email_hash').eq('run_id', r3.runId), db.from('phone_numbers').select('number_hash').eq('run_id', r3.runId)]);
  const subject = buildSubject(r3.profile, { emailHashes: (emails ?? []).map((e) => e.email_hash), phoneHashes: (phones ?? []).map((p) => p.number_hash) });
  const ext = await runExternalSearch(subject, { purpose: 'KYC / client due diligence', consentSources: ['ALL'] });
  const { data: search } = await db.from('external_searches').insert({ client_id: r1.clientId, purpose: 'KYC / client due diligence', connectors: ext.connectorsRun, requested_by: actorId, completed_at: new Date().toISOString(), summary: ext.summary }).select('id').single();
  for (const f of ext.findings) {
    await db.from('external_findings').insert({ client_id: r1.clientId, search_id: search!.id, connector_key: f.connectorKey, result_type: f.resultType, title: f.title, excerpt: f.excerpt, url: f.url, source_name: f.sourceName, source_class: f.sourceClass, tier: f.tier, record_id: f.recordId, published_at: f.publishedAt, retrieved_at: f.retrievedAt, match_score: f.match.score, match_status: f.match.status, match_reasons: { reasons: f.match.reasons, gaps: f.match.gaps }, category: f.category, severity: f.severity, entity_role: f.entityRole ?? null, data: { ...f.data, mode: f.mode, categoryLabel: f.categoryLabel, humanReviewRequired: f.humanReviewRequired, connectorName: f.connectorName } });
  }
  await db.from('refresh_schedules').upsert({ client_id: r1.clientId, last_checked_at: new Date().toISOString(), next_permitted_at: new Date(Date.now() + 90 * 86_400_000).toISOString(), sources_checked: ext.connectorsRun });
  await db.from('intelligence_events').insert({ client_id: r1.clientId, event_type: 'EXTERNAL_SEARCH', title: `External intelligence search run (${ext.findings.length} findings)`, detail: `Connectors: ${ext.connectorsRun.join(', ')}`, source_key: 'EXTERNAL', actor_id: actorId });
  console.log(`  ${ext.findings.length} findings stored as PENDING review`);

  console.log('Opening cases and notes...');
  const { data: c1 } = await db.from('cases').insert({ client_id: r1.clientId, title: 'Review provider mobile risk indicator (is_safe=false / LOW)', priority: 'NORMAL', assigned_to: analyst?.user_id ?? actorId, opened_by: actorId }).select('id').single();
  await db.from('analyst_notes').insert({ client_id: r1.clientId, case_id: c1?.id, author_id: actorId, kind: 'NOTE', body: 'Provider flags a secondary SIM as inactive while rating overall risk LOW. Primary mobile is CONNECTED and matches the PAN-linked number. Recommend confirming the secondary number with the client before closing.' });
  await db.from('cases').insert({ client_id: r4.clientId, title: 'Stale verification - re-verify before relying on employment data', priority: 'HIGH', assigned_to: senior?.user_id ?? actorId, opened_by: actorId });
  await db.from('clients').update({ review_status: 'IN_REVIEW', assigned_to: analyst?.user_id ?? actorId }).eq('id', r1.clientId);
  await db.from('clients').update({ review_status: 'IN_REVIEW', assigned_to: senior?.user_id ?? actorId }).eq('id', r4.clientId);
  console.log('Seed complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
