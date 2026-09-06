/**
 * Phase-2 demo seed (wealth OS, credit console, cash flow, CRM, AIF + property verticals).
 * Runs as the demo Super Admin through RLS. Idempotent: exits early when Rohan already has assets.
 *   npx tsx scripts/seed-phase2.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
type Ret = Record<string, string>;

let db: SupabaseClient;
let failed = false;

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

/** PostgREST fills missing keys with explicit nulls in a mixed batch (overriding column defaults), so batch rows by identical key set. */
function groupByKeys(rows: Row[]): Row[][] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const sig = Object.keys(r).sort().join(',');
    const g = groups.get(sig);
    if (g) g.push(r);
    else groups.set(sig, [r]);
  }
  return [...groups.values()];
}

async function write(table: string, rows: Row | Row[], select: string, verb: 'inserted' | 'upserted', onConflict?: string): Promise<Ret[]> {
  const out: Ret[] = [];
  let errors = 0;
  for (const group of groupByKeys(Array.isArray(rows) ? rows : [rows])) {
    const q = onConflict ? db.from(table).upsert(group, { onConflict }) : db.from(table).insert(group);
    const { data, error } = await q.select(select);
    if (error) {
      failed = true;
      errors++;
      console.error(`  ${table}: ERROR ${error.message}`);
      continue;
    }
    out.push(...((data ?? []) as unknown as Ret[]));
  }
  if (out.length || !errors) console.log(`  ${table}: ${out.length} rows ${verb}`);
  return out;
}

const insert = (table: string, rows: Row | Row[], select = 'id') => write(table, rows, select, 'inserted');
const upsert = (table: string, rows: Row | Row[], onConflict: string, select = 'id') => write(table, rows, select, 'upserted', onConflict);

const DD_KEYS = ['TITLE_CHAIN', 'PARENT_DOCUMENTS', 'SALE_DEED', 'PATTA', 'CHITTA', 'ADANGAL', 'FMB', 'SURVEY', 'EC', 'MORTGAGE', 'LITIGATION', 'ACQUISITION_NOTIFICATION', 'LAND_CLASSIFICATION', 'CONVERSION', 'ACCESS', 'RIGHT_OF_WAY', 'WATERBODY', 'FOREST', 'HT_LINE', 'FLOOD', 'APPROVAL', 'RERA', 'OSR', 'ROAD_WIDTH', 'UTILITIES', 'REGISTRATION', 'PROMOTER_DOCS'];

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const email = process.env.BENFILE_SEED_EMAIL ?? 'admin@benfile.local';
  const password = process.env.BENFILE_SEED_PASSWORD ?? '';
  if (!url || !anon || !password) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and BENFILE_SEED_PASSWORD');
  db = createClient(url, anon, { auth: { persistSession: false } });
  const { data: auth, error: authErr } = await db.auth.signInWithPassword({ email, password });
  if (authErr || !auth.user) throw new Error(`sign-in failed: ${authErr?.message}`);
  const me = auth.user.id;

  const { data: rohanRow, error: rohanErr } = await db.from('clients').select('id,display_name').eq('display_name', 'Rohan Kumar Mehta').maybeSingle();
  if (rohanErr || !rohanRow) throw new Error(`Client 'Rohan Kumar Mehta' not found (${rohanErr?.message ?? 'run scripts/seed.ts first'})`);
  const rohan = (rohanRow as Ret).id;
  const { data: priyaRow } = await db.from('clients').select('id,display_name').ilike('display_name', 'priya%').limit(1).maybeSingle();
  const priya = priyaRow ? (priyaRow as Ret).id : null;

  const { data: existingAssets } = await db.from('assets').select('id').eq('client_id', rohan).limit(1);
  if (existingAssets?.length) {
    console.log('already seeded');
    return;
  }

  const { data: consentRow } = await db.from('consents').select('id').eq('client_id', rohan).eq('status', 'GRANTED').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const consentId = consentRow ? (consentRow as Ret).id : null;

  console.log('Assets...');
  const c = rohan;
  const mf = (subtype: string, title: string, amc: string, scheme: string, value: number): Row => ({ client_id: c, category: 'MUTUAL_FUND', subtype, title, value_mid: value, valuation_basis: 'STATEMENT', valuation_date: '2026-08-31', pricing_source: 'CAMS CAS', evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'VERIFIED', liquidity: 'LIQUID', details: { amc, scheme, folio: 'XXXX1234', sip: 25000 }, acquired_on: '2024-01-10', source_key: 'CAMS', created_by: me });
  const sec = (title: string, value: number): Row => ({ client_id: c, category: 'SECURITY', subtype: 'EQUITY', title, value_mid: value, valuation_basis: 'NAV', valuation_date: '2026-08-31', pricing_source: 'NSE close via CDSL CAS', evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'VERIFIED', liquidity: 'LIQUID', acquired_on: '2020-06-15', source_key: 'CDSL', created_by: me });
  const assets = await insert(
    'assets',
    [
      { client_id: c, category: 'REAL_ESTATE', subtype: 'APARTMENT', title: 'Flat Koramangala', details: { city: 'Bengaluru', registration_ref: 'KOR/2019/1123', survey_number: '12/2A' }, value_low: 40e6, value_mid: 42e6, value_high: 45e6, valuation_basis: 'ESTIMATED_MARKET', valuation_date: '2026-06-30', pricing_source: 'Comparable transactions Koramangala Q2 2026', valuation_method: 'Comparable sales, 3 comps within 800 m', liquidity: 'ILLIQUID', evidence_class: 'OFFICIAL_PUBLIC_RECORD', confidence: 'HIGH', acquired_on: '2019-08-12', encumbered: true, source_key: 'SRO', created_by: me },
      { client_id: c, category: 'REAL_ESTATE', subtype: 'PLOT', title: 'Plot Whitefield', details: { city: 'Bengaluru', survey_number: '88/1', extent: '2400 sq ft' }, value_low: 7.5e6, value_mid: 8e6, value_high: 8.5e6, valuation_basis: 'OFFICIAL_GUIDELINE', valuation_date: '2026-04-01', pricing_source: 'Karnataka guideline value 2026', liquidity: 'ILLIQUID', evidence_class: 'OFFICIAL_PUBLIC_RECORD', confidence: 'HIGH', acquired_on: '2021-03-30', source_key: 'SRO', created_by: me },
      { client_id: c, category: 'REAL_ESTATE', subtype: 'AGRICULTURAL', title: 'Ancestral farmland Hosur', ownership_scope: 'FAMILY_LINKED', evidence_class: 'CLIENT_DECLARED', value_mid: 30e6, valuation_basis: 'DECLARED', confidence: 'LOW', liquidity: 'ILLIQUID', details: { city: 'Hosur', extent: '6 acres', note: 'Held by father; no entitlement evidence' }, created_by: me },
      { client_id: c, category: 'BUSINESS_INTEREST', subtype: 'LLP', title: 'Mehta Family Ventures LLP', evidence_class: 'POSSIBLE_ASSOCIATION', confidence: 'LOW', details: { role: 'Designated partner (registry name match only)' }, valuation_basis: 'NOT_VALUED', source_key: 'MCA', created_by: me },
      mf('EQUITY', 'HDFC Flexi Cap - Growth', 'HDFC AMC', 'HDFC Flexi Cap Fund - Growth', 3.2e6),
      mf('HYBRID', 'ICICI Balanced Advantage', 'ICICI Prudential AMC', 'ICICI Prudential Balanced Advantage Fund', 2.1e6),
      mf('INDEX', 'UTI Nifty 50 Index', 'UTI AMC', 'UTI Nifty 50 Index Fund', 1.4e6),
      sec('Infosys Ltd', 1.8e6),
      sec('HDFC Bank Ltd', 0.9e6),
      { client_id: c, category: 'DEPOSIT', subtype: 'FIXED_DEPOSIT', title: 'HDFC Bank FD', value_mid: 2.5e6, valuation_basis: 'STATEMENT', valuation_date: '2026-08-31', details: { maturity_on: '2026-10-15', bank: 'HDFC Bank' }, liquidity: 'LIQUID', evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'HIGH', source_key: 'AA', created_by: me },
      { client_id: c, category: 'CASH', subtype: 'SAVINGS', title: 'HDFC savings balance', value_mid: 0.9e6, valuation_basis: 'STATEMENT', valuation_date: '2026-08-31', liquidity: 'LIQUID', evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'HIGH', source_key: 'AA', created_by: me },
      { client_id: c, category: 'RETIREMENT', subtype: 'EPF', title: 'EPF balance', value_mid: 1.9e6, valuation_basis: 'STATEMENT', valuation_date: '2026-08-31', liquidity: 'ILLIQUID', evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'HIGH', source_key: 'EPFO', details: { committed: true }, created_by: me },
      { client_id: c, category: 'INSURANCE', subtype: 'TERM_LIFE', title: 'Term life cover', details: { cover: 20e6, premium: 24000, insurer: 'HDFC Life' }, valuation_basis: 'NOT_VALUED', evidence_class: 'CLIENT_DECLARED', confidence: 'LOW', created_by: me },
      { client_id: c, category: 'VEHICLE', subtype: 'CAR', title: 'Hyundai Creta 2022', value_mid: 0.9e6, valuation_basis: 'ESTIMATED_MARKET', valuation_date: '2026-06-30', evidence_class: 'CLIENT_DECLARED', confidence: 'LOW', liquidity: 'SEMI_LIQUID', details: { make: 'Hyundai', model: 'Creta', year: 2022, registration_no: 'KA01XX1234 (masked)', finance: 'Hypothecated to HDFC' }, encumbered: true, created_by: me },
    ],
    'id,title',
  );
  const assetId = (title: string) => assets.find((a) => a.title === title)?.id ?? null;
  const flatId = assetId('Flat Koramangala');
  const plotWhitefieldId = assetId('Plot Whitefield');
  const vehicleId = assetId('Hyundai Creta 2022');

  console.log('Liabilities...');
  const liabilities = await insert(
    'liabilities',
    [
      { client_id: c, liability_type: 'HOME_LOAN', lender: 'HDFC Bank', original_amount: 28e6, outstanding: 19.6e6, monthly_obligation: 24500, interest_rate: 8.6, opened_on: '2019-08-20', maturity_on: '2039-08-20', collateral: 'Flat Koramangala', linked_asset_id: flatId, secured: true, repayment_status: 'REGULAR', days_past_due: 0, evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'HIGH', source_key: 'CIBIL', created_by: me },
      { client_id: c, liability_type: 'VEHICLE_LOAN', lender: 'HDFC Bank', original_amount: 1.1e6, outstanding: 4.2e5, monthly_obligation: 18400, interest_rate: 9.1, opened_on: '2022-06-10', maturity_on: '2027-06-10', collateral: 'Hyundai Creta', linked_asset_id: vehicleId, secured: true, repayment_status: 'REGULAR', days_past_due: 0, evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'HIGH', source_key: 'CIBIL', created_by: me },
      { client_id: c, liability_type: 'CREDIT_CARD', lender: 'HDFC Bank', outstanding: 68000, monthly_obligation: 6800, secured: false, repayment_status: 'REGULAR', days_past_due: 0, evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'HIGH', source_key: 'CIBIL', created_by: me },
    ],
    'id,liability_type',
  );
  const homeLoanId = liabilities.find((l) => l.liability_type === 'HOME_LOAN')?.id ?? null;
  const vehicleLoanId = liabilities.find((l) => l.liability_type === 'VEHICLE_LOAN')?.id ?? null;
  for (const [aid, lid] of [
    [flatId, homeLoanId],
    [vehicleId, vehicleLoanId],
  ]) {
    if (!aid || !lid) continue;
    const { error } = await db.from('assets').update({ linked_liability_id: lid }).eq('id', aid);
    if (error) {
      failed = true;
      console.error(`  assets link: ERROR ${error.message}`);
    } else console.log('  assets: linked_liability_id set');
  }

  console.log('Credit bureau...');
  await insert('credit_bureau_reports', {
    client_id: c,
    bureau: 'CIBIL',
    score: 805,
    report_date: '2026-08-10',
    score_history: [
      { date: '2025-02-01', score: 781 },
      { date: '2025-08-01', score: 792 },
      { date: '2026-02-01', score: 798 },
      { date: '2026-08-01', score: 805 },
    ],
    credit_age_months: 112,
    total_accounts: 6,
    active_accounts: 3,
    closed_accounts: 3,
    secured_loans: 2,
    unsecured_loans: 1,
    credit_cards: 1,
    sanctioned_total: 30.1e6,
    outstanding_total: 20.09e6,
    utilization: 0.18,
    emi_total: 49700,
    dpd_30_count: 0,
    dpd_60_count: 0,
    dpd_90_count: 0,
    missed_payments_12m: 0,
    write_offs: 0,
    settlements: 0,
    defaults: 0,
    restructured: 0,
    enquiries_6m: 1,
    enquiries_12m: 2,
    oldest_account_on: '2017-03-01',
    newest_account_on: '2024-11-01',
    accounts: [
      { type: 'HOME_LOAN', lender: 'HDFC Bank', secured: true, opened: '2019-08-20', status: 'ACTIVE', sanctioned: 28e6, outstanding: 19.6e6, emi: 24500, dpd: 0 },
      { type: 'VEHICLE_LOAN', lender: 'HDFC Bank', secured: true, opened: '2022-06-10', status: 'ACTIVE', sanctioned: 1.1e6, outstanding: 4.2e5, emi: 18400, dpd: 0 },
      { type: 'CREDIT_CARD', lender: 'HDFC Bank', secured: false, opened: '2024-11-01', status: 'ACTIVE', sanctioned: 3e5, outstanding: 68000, emi: 6800, dpd: 0 },
      { type: 'PERSONAL_LOAN', lender: 'Axis Bank', secured: false, opened: '2017-03-01', closed: '2020-03-01', status: 'CLOSED', sanctioned: 5e5, outstanding: 0, dpd: 0 },
      { type: 'CONSUMER_LOAN', lender: 'Bajaj Finance', secured: false, opened: '2018-10-01', closed: '2019-10-01', status: 'CLOSED', sanctioned: 80000, outstanding: 0, dpd: 0 },
      { type: 'CREDIT_CARD', lender: 'ICICI Bank', secured: false, opened: '2019-01-01', closed: '2023-05-01', status: 'CLOSED', sanctioned: 1.5e5, outstanding: 0, dpd: 0 },
    ],
    enquiries: [
      { date: '2026-05-02', lender: 'Axis Bank', purpose: 'Credit card' },
      { date: '2025-11-14', lender: 'HDFC Bank', purpose: 'Credit card limit review' },
    ],
    evidence_class: 'AUTHORIZED_THIRD_PARTY',
    source_key: 'CREDIT',
  });

  console.log('Cash flow...');
  const periods: Row[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2025, 8 + i, 1));
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const salary = 83300;
    const other = 2500 + (i % 3) * 500;
    const bonus = period === '2026-03' ? 240000 : 0;
    const debt = 49700;
    const essential = 18000;
    const discretionary = i < 6 ? 9000 : 12500;
    const cash = 2000;
    const investments = 25000;
    periods.push({
      client_id: c,
      period,
      inflows: salary + other + bonus,
      // outflows = total debits INCLUDING investment transfers (engine semantics)
      outflows: debt + essential + discretionary + cash + 1000 + investments,
      salary_credits: salary,
      other_income: other,
      investment_transfers: 25000,
      debt_payments: debt,
      essential_spend: essential,
      discretionary_spend: discretionary,
      cash_withdrawals: cash,
      large_inflows: bonus ? [{ date: '2026-03-31', amount: 240000, label: 'Annual bonus' }] : [],
      large_outflows: [],
      returned_transactions: 0,
      categories: { HOUSING: 24500, GROCERIES: 9500, DINING: 3500, TRAVEL: 2500, UTILITIES: 3200, INSURANCE: 2000, FUEL: 3000, SUBSCRIPTIONS: 900 },
      evidence_class: 'AUTHORIZED_THIRD_PARTY',
      source_key: 'AA',
      consent_id: consentId,
    });
  }
  await insert('cash_flow_periods', periods);
  await insert('bank_relationships', { client_id: c, bank_name: 'HDFC Bank', account_type: 'SAVINGS', account_masked: 'XXXXXXXXXX2345', balance: 0.9e6, avg_monthly_balance: 0.72e6, balance_date: '2026-08-31', source_key: 'AA', consent_id: consentId });

  console.log('Family, sources, timeline...');
  await insert('family_links', [
    { client_id: c, name: 'Suresh Mehta', relation: 'FATHER', evidence_class: 'CLIENT_DECLARED', confidence: 'LOW', entitlement: 'NONE_KNOWN', note: 'Holds Hosur farmland' },
    { client_id: c, name: 'Anita Mehta', relation: 'MOTHER', evidence_class: 'CLIENT_DECLARED', confidence: 'LOW', entitlement: 'NONE_KNOWN' },
  ]);
  await insert('fund_sources', [
    { client_id: c, kind: 'SOURCE_OF_FUNDS', category: 'Salary', description: 'Monthly salary from ABC Technologies', evidence_class: 'CLIENT_DECLARED', status: 'DECLARED', created_by: me },
    { client_id: c, kind: 'SOURCE_OF_WEALTH', category: 'Employment earnings', description: 'Salaried employment since 2015', evidence_class: 'CLIENT_DECLARED', status: 'DECLARED', created_by: me },
  ]);
  const ev = (occurred_on: string, event_type: string, title: string, amount: number | null, evidence_class: string, source_key: string, extra: Row = {}): Row => ({ client_id: c, occurred_on, event_type, title, amount, evidence_class, source_key, ...extra });
  await insert('wealth_events', [
    ev('2015-07-01', 'EMPLOYMENT', 'Joined XYZ Solutions LLP', null, 'VERIFIED', 'UAN'),
    ev('2018-05-14', 'EMPLOYMENT', 'Joined ABC Technologies Pvt Ltd', null, 'VERIFIED', 'UAN'),
    ev('2019-08-12', 'PROPERTY_PURCHASE', 'Purchased flat, Koramangala', 38e6, 'OFFICIAL_PUBLIC_RECORD', 'SRO', { asset_id: flatId }),
    ev('2019-08-20', 'LOAN_OPENED', 'Home loan opened with HDFC Bank', 28e6, 'AUTHORIZED_THIRD_PARTY', 'CIBIL', { liability_id: homeLoanId }),
    ev('2021-03-30', 'PROPERTY_PURCHASE', 'Purchased plot, Whitefield', 6.2e6, 'OFFICIAL_PUBLIC_RECORD', 'SRO', { asset_id: plotWhitefieldId }),
    ev('2022-06-10', 'LOAN_OPENED', 'Vehicle loan opened', 1.1e6, 'AUTHORIZED_THIRD_PARTY', 'CIBIL', { liability_id: vehicleLoanId }),
    ev('2024-01-10', 'INVESTMENT', 'Started SIPs 25,000/month', null, 'AUTHORIZED_THIRD_PARTY', 'CAMS'),
    ev('2026-08-10', 'CREDIT_REFRESH', 'Credit bureau report refreshed (CIBIL 805)', null, 'AUTHORIZED_THIRD_PARTY', 'CREDIT'),
  ]);

  console.log('CRM...');
  await insert('interactions', [
    { client_id: c, occurred_at: '2026-06-12T11:00:00+05:30', channel: 'IN_PERSON', direction: 'OUTBOUND', kind: 'MEETING', summary: 'Introductory meeting; discussed current allocation, client concerned about concentration in Koramangala flat; asked for documentation before any decision', questions: ['Can I see 3-year performance documentation?', 'What are total fees?'], objections: ['Lock-in of 5 years feels long'], interests: ['diversification', 'land near Coimbatore'], concerns: ['liquidity'], commitments: ['Send factsheet'], products_discussed: ['AIF'], outcome: 'PROGRESSED', response_time_hours: 20, author_id: me },
    { client_id: c, occurred_at: '2026-07-03T10:00:00+05:30', channel: 'EMAIL', direction: 'OUTBOUND', kind: 'PROPOSAL', summary: 'Sent AIF factsheet and fee schedule; client asked for comparison table vs direct equity', questions: ['How does this compare with direct equity after fees?'], products_discussed: ['AIF'], outcome: 'PROGRESSED', response_time_hours: 30, author_id: me },
    { client_id: c, occurred_at: '2026-07-20T18:30:00+05:30', channel: 'WHATSAPP', direction: 'INBOUND', kind: 'MESSAGE', summary: 'Client asked about DTCP-approved plots near Saravanampatti, budget around 50-60 lakh, north facing preferred', interests: ['plots Coimbatore'], outcome: 'PROGRESSED', response_time_hours: 2, author_id: me },
    { client_id: c, occurred_at: '2026-08-22T16:00:00+05:30', channel: 'PHONE', direction: 'OUTBOUND', kind: 'CALL', summary: 'Follow-up; client wants a site visit in September; asked whether the AIF has quarterly reporting', questions: ['Does the AIF report quarterly?'], follow_up_at: '2026-09-12T10:00:00+05:30', outcome: 'PENDING', response_time_hours: 24, author_id: me },
  ]);
  await upsert(
    'client_interests',
    [
      { client_id: c, category: 'AIF', stance: 'INTERESTED', evidence_class: 'CLIENT_DECLARED', source: 'meeting 2026-06-12', updated_by: me },
      { client_id: c, category: 'PLOTS', stance: 'INTERESTED', evidence_class: 'CLIENT_DECLARED', source: 'WhatsApp 2026-07-20', updated_by: me },
      { client_id: c, category: 'LAND', stance: 'INTERESTED', evidence_class: 'CLIENT_DECLARED', updated_by: me },
      { client_id: c, category: 'SHORT_TERM_TRADING', stance: 'NOT_INTERESTED', evidence_class: 'CLIENT_DECLARED', source: 'meeting 2026-06-12', updated_by: me },
      { client_id: c, category: 'HIGH_LEVERAGE', stance: 'NOT_INTERESTED', evidence_class: 'CLIENT_DECLARED', updated_by: me },
    ],
    'client_id,category',
  );
  await upsert('contact_controls', { client_id: c, preferred_channel: 'EMAIL', preferred_frequency_days: 14, marketing_permission: true, preferred_format: 'Detailed comparison table', preferred_language: 'en', last_contact_at: '2026-08-22T16:00:00+05:30' }, 'client_id', 'client_id');
  await upsert(
    'property_preferences',
    { client_id: c, buyer_type: 'INVESTOR', buyer_type_basis: 'Declared: investment purpose', purpose: 'INVESTMENT', budget_min: 4.5e6, budget_max: 6.5e6, cities: ['Coimbatore'], localities: ['Saravanampatti', 'Kalapatti'], property_types: ['PLOT'], plot_size_min_sqft: 1800, plot_size_max_sqft: 3000, facing: ['North', 'East'], road_width_min_ft: 30, corner_preferred: true, approval_required: true, proximity: ['HIGHWAY', 'IT_CORRIDOR'], horizon: '5-7 years', financing: 'CASH', field_evidence: { budget: { evidence_class: 'CLIENT_DECLARED', source: 'WhatsApp 2026-07-20' } }, declared_at: new Date().toISOString(), updated_by: me },
    'client_id',
    'client_id',
  );
  await upsert('aif_suitability', { client_id: c, stage: 'SUITABILITY', questionnaire: {}, horizon: '5-10 years', liquidity_needs: 'Low', expected_amount: 1e7, kyc_status: 'COMPLETE', sanctions_status: 'COMPLETE', pep_status: 'COMPLETE', aml_status: 'PENDING', sof_status: 'PENDING', updated_by: me }, 'client_id');
  await insert('human_inputs', [
    { client_id: c, category: 'THIRD_PARTY_SAID', source_type: 'INTRODUCER_STATEMENT', body: 'Introducer says the client owns about 20 acres near Hosur and sold a startup stake last year; unclear if proceeds still liquid', attributed_to: 'Introducer (channel partner)', author_confidence: 'MEDIUM', first_hand: false, author_id: me },
    { client_id: c, category: 'COMMERCIAL_IMPRESSION', source_type: 'RM_OPINION', body: 'Comes across as methodical; wants numbers before deciding', first_hand: true, author_confidence: 'MEDIUM', author_id: me },
    { client_id: c, category: 'MARKET_FEEDBACK', source_type: 'UNVERIFIED_MARKET_INFORMATION', body: 'Heard from a broker that the family is negotiating to sell the Hosur land', author_confidence: 'LOW', author_id: me },
  ]);

  console.log('Projects & plots...');
  const { data: existingProjects } = await db.from('projects').select('id,code').in('code', ['P-GMS', 'P-KLP']);
  const hasGms = (existingProjects ?? []).some((p) => p.code === 'P-GMS');
  if (hasGms) console.log('  projects: P-GMS already present, skipped');
  const projects: Ret[] = hasGms
    ? ((existingProjects ?? []) as unknown as Ret[])
    : await insert(
    'projects',
    [
      {
        code: 'P-GMS',
        name: 'Green Meadows Saravanampatti',
        project_type: 'PLOTTED_LAYOUT',
        approval_authority: 'DTCP',
        approval_number: 'DTCP/CBE/2025/1187',
        approval_status: 'APPROVED',
        rera_number: 'TN/29/Layout/0421/2025',
        survey_numbers: ['112/1', '112/2', '113/1A'],
        city: 'Coimbatore',
        district: 'Coimbatore',
        state: 'Tamil Nadu',
        locality: 'Saravanampatti',
        lat: 11.0788,
        lng: 77.0091,
        total_area_acres: 12.4,
        plots_total: 96,
        road_widths_ft: [30, 40],
        amenities: ['Compound wall', 'Avenue trees', 'Street lights', 'Park', 'Rainwater harvesting'],
        osr_pct: 10,
        utilities: { water: 'Borewell + corporation line applied', electricity: 'TNEB poles installed', drainage: 'Storm-water drains laid', access_road: '40 ft tar road' },
        infrastructure: [
          { name: 'NH-544', kind: 'HIGHWAY', status: 'EXISTING', distance_km: 2.1, source: 'Site survey 2026-06' },
          { name: 'Saravanampatti IT corridor (KGISL / Tidel)', kind: 'IT_CORRIDOR', status: 'EXISTING', distance_km: 3.4, source: 'Site survey' },
          { name: 'Coimbatore Airport', kind: 'AIRPORT', status: 'EXISTING', distance_km: 9, source: 'Map' },
          { name: 'Western Bypass', kind: 'HIGHWAY', status: 'PROPOSED', distance_km: 4, source: 'TN Highways press note 2025' },
          { name: 'KMCH Hospital', kind: 'HOSPITAL', status: 'EXISTING', distance_km: 5, source: 'Map' },
          { name: 'PSG Tech', kind: 'EDUCATION', status: 'EXISTING', distance_km: 4.5, source: 'Map' },
        ],
        geo: { flood_zone: 'Not in mapped flood zone (2024 CMA map)', water_bodies: 'Tank 1.2 km NE', ht_lines: 'None within 200 m', land_use: 'Residential (DTCP)' },
        price_per_sqft: 2250,
        price_history: [
          { date: '2025-06-01', price_per_sqft: 2000 },
          { date: '2026-01-01', price_per_sqft: 2150 },
          { date: '2026-07-01', price_per_sqft: 2250 },
        ],
        guideline_value_per_sqft: 1450,
        comparables: [
          { project: 'Sree Layout Ph2', price_per_sqft: 2100, date: '2026-05', source: 'registered transactions' },
          { project: 'KG Nagar', price_per_sqft: 2400, date: '2026-06', source: 'asking' },
        ],
        launch_price_per_sqft: 2000,
        thesis: 'IT-corridor demand, approved layout, 40 ft road frontage',
        documents: [
          { name: 'DTCP approval', type: 'APPROVAL', status: 'VERIFIED' },
          { name: 'EC 30 yrs', type: 'EC', status: 'VERIFIED' },
          { name: 'Parent documents', type: 'TITLE', status: 'VERIFIED' },
        ],
        status: 'ACTIVE',
        launched_on: '2025-06-01',
      },
      {
        code: 'P-KLP',
        name: 'Kalapatti Airport Enclave',
        project_type: 'PLOTTED_LAYOUT',
        approval_authority: 'DTCP',
        approval_status: 'PENDING',
        city: 'Coimbatore',
        district: 'Coimbatore',
        state: 'Tamil Nadu',
        locality: 'Kalapatti',
        lat: 11.05,
        lng: 77.06,
        total_area_acres: 6.8,
        plots_total: 64,
        road_widths_ft: [30],
        amenities: ['Compound wall', 'Street lights'],
        price_per_sqft: 1950,
        guideline_value_per_sqft: 1300,
        launch_price_per_sqft: 1900,
        infrastructure: [
          { name: 'Coimbatore Airport', kind: 'AIRPORT', status: 'EXISTING', distance_km: 3, source: 'Map' },
          { name: 'Airport metro extension', kind: 'METRO', status: 'ANNOUNCED', distance_km: 2, source: 'Press 2026' },
        ],
        geo: { land_use: 'Residential (conversion applied)' },
        documents: [],
        status: 'ACTIVE',
      },
    ],
    'id,code',
  );
  const gmsId = projects.find((p) => p.code === 'P-GMS')?.id ?? null;
  const klpId = projects.find((p) => p.code === 'P-KLP')?.id ?? null;

  const facings = ['North', 'East', 'South', 'West'];
  const gmsAreas = [1200, 1500, 1800, 2400, 3000];
  const heldUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const gmsPlots: Row[] = [];
  if (gmsId) {
    for (let n = 1; n <= 24; n++) {
      const area = gmsAreas[(n - 1) % gmsAreas.length];
      const width = area <= 1800 ? 30 : area === 2400 ? 40 : 50;
      const status = [4, 9, 15, 21].includes(n) ? 'BOOKED' : [7, 19].includes(n) ? 'REGISTERED' : n === 12 ? 'HELD' : 'AVAILABLE';
      gmsPlots.push({ project_id: gmsId, plot_number: String(n), area_sqft: area, width_ft: width, depth_ft: area / width, facing: facings[(n - 1) % 4], road_width_ft: n % 2 === 0 ? 40 : 30, corner: n % 6 === 0, park_facing: n >= 10 && n <= 12, near_entrance: n <= 3, status, price: area * 2250, release_date: '2025-06-01', held_for_client_id: status === 'HELD' ? c : null, held_until: status === 'HELD' ? heldUntil : null });
    }
  }
  const klpAreas = [1500, 1800, 2400];
  const klpPlots: Row[] = [];
  if (klpId) {
    for (let n = 1; n <= 12; n++) {
      const area = klpAreas[(n - 1) % klpAreas.length];
      const width = area === 2400 ? 40 : 30;
      klpPlots.push({ project_id: klpId, plot_number: String(n), area_sqft: area, width_ft: width, depth_ft: area / width, facing: facings[(n - 1) % 4], road_width_ft: 30, corner: n % 6 === 0, status: 'AVAILABLE', price: area * 1950 });
    }
  }
  const plots = await upsert('plots', [...gmsPlots, ...klpPlots], 'project_id,plot_number', 'id,project_id,plot_number');

  const dd: Row[] = [];
  if (gmsId) {
    for (const k of DD_KEYS) dd.push({ project_id: gmsId, item_key: k, status: 'VERIFIED', finding: 'Verified in legal review', source: 'Legal review 2026-07', reviewer_id: me, checked_at: '2026-07-15T10:00:00+05:30' });
    dd.push({ project_id: gmsId, item_key: 'CRZ', status: 'NOT_AVAILABLE', finding: 'Not applicable - inland', source: 'Legal review 2026-07', reviewer_id: me, checked_at: '2026-07-15T10:00:00+05:30' });
  }
  if (klpId) {
    const klpStatus: Record<string, [string, string | null]> = { APPROVAL: ['PENDING', 'DTCP file under scrutiny'], EC: ['VERIFIED', 'Verified in legal review'], TITLE_CHAIN: ['VERIFIED', 'Verified in legal review'], PARENT_DOCUMENTS: ['VERIFIED', 'Verified in legal review'], LITIGATION: ['POTENTIAL_ISSUE', 'Boundary dispute on adjoining survey 45/3 - not on subject land'] };
    for (const k of [...DD_KEYS, 'CRZ']) {
      const [status, finding] = klpStatus[k] ?? ['PENDING', null];
      dd.push({ project_id: klpId, item_key: k, status, finding, source: status === 'PENDING' ? null : 'Legal review 2026-08', reviewer_id: status === 'PENDING' ? null : me, checked_at: status === 'PENDING' ? null : '2026-08-20T10:00:00+05:30' });
    }
  }
  await upsert('property_due_diligence', dd, 'project_id,item_key');

  const gmsPlotId = (num: string) => plots.find((p) => p.project_id === gmsId && p.plot_number === num)?.id ?? null;
  const plot6 = gmsPlotId('6');
  const plot12 = gmsPlotId('12');
  const interestRows: Row[] = [plot6, plot12].filter((id): id is string => !!id).map((plot_id) => ({ client_id: c, plot_id, stance: 'INTERESTED', source: 'RM', reason: 'Requested north-facing corner options' }));
  if (interestRows.length) await upsert('plot_interest', interestRows, 'client_id,plot_id');
  if (gmsId) {
    await insert('site_visits', {
      client_id: c,
      project_id: gmsId,
      plot_ids: [plot6, plot12].filter(Boolean),
      scheduled_at: '2026-09-14T09:30:00+05:30',
      rm_id: me,
      status: 'SCHEDULED',
      pickup_required: true,
      pickup_point: 'Client residence, Koramangala',
      meeting_point: 'Site office, Green Meadows',
      itinerary: [
        { step: 1, text: '09:30 pickup' },
        { step: 2, text: '11:30 site office - layout & approvals' },
        { step: 3, text: '12:00 walk plots 6, 12, 18' },
      ],
      created_by: me,
    });
  }

  console.log('AIF funds & tasks...');
  const { data: existingFunds } = await db.from('aif_funds').select('id').limit(1);
  if (existingFunds?.length) console.log('  aif_funds: already present, skipped');
  else
    await insert('aif_funds', [
      { name: 'BENFILE Realty Yield AIF (Cat II)', category: 'CAT_II', strategy: 'Income-yielding commercial real estate', thesis: 'Rental-yield assets in Tier-1 IT corridors', min_commitment: 1e7, lock_in_years: 5, tenure_years: 7, target_size: 5e9, fees: { management: '1.75%', performance: '15% over 10% hurdle', setup: '1%' }, risk_factors: ['Illiquidity', 'Valuation of unlisted assets', 'Concentration', 'Manager risk'], status: 'OPEN', closing_date: '2026-12-15', documents: [{ name: 'PPM v3', type: 'PPM', status: 'CURRENT' }] },
      { name: 'BENFILE Growth Opportunities AIF (Cat III)', category: 'CAT_III', strategy: 'Long-short listed equities', min_commitment: 1e7, lock_in_years: 3, tenure_years: 5, target_size: 2e9, fees: { management: '2%', performance: '20% over hurdle' }, risk_factors: ['Market risk', 'Leverage', 'Manager risk'], status: 'OPEN' },
    ]);
  await insert('tasks', [
    { client_id: c, title: 'Send AIF comparison table vs direct equity', task_type: 'PROPOSAL', due_at: '2026-09-10T10:00:00+05:30', priority: 'HIGH', source: 'MANUAL', assigned_to: me, created_by: me },
    { client_id: c, title: 'Confirm site visit logistics', task_type: 'SITE_VISIT', due_at: '2026-09-12T10:00:00+05:30', assigned_to: me, created_by: me },
  ]);

  console.log('Landowner profile...');
  if (!priya) console.log('  landowner_profiles: client "priya%" not found, skipped');
  else
    await upsert(
      'landowner_profiles',
      { client_id: priya, stage: 'OWNERSHIP_VERIFICATION', land_location: 'Kinathukadavu, Coimbatore', survey_numbers: ['77/2', '77/3'], extent_acres: 4.2, co_owners: ['Suresh Nair'], title_documents: ['Sale deed 2009', 'Patta'], patta_status: 'Available (joint)', ec_status: 'Requested', approval_potential: 'Residential conversion likely', access: 'Panchayat road 20 ft', road_frontage_ft: 120, current_use: 'Coconut grove', expected_price: 1.9e7, negotiable: true, timeline: '6 months', development: { suitability: 'Medium', layout_potential: '~45 plots', developable_acres: 3.6, constraints: ['20 ft access road - widening needed'], comparables: [{ name: 'Kinathukadavu layout', price_per_acre: 4.2e6 }] }, updated_by: me },
      'client_id',
      'client_id',
    );

  console.log(failed ? 'Phase-2 seed finished with errors.' : 'Phase-2 seed complete.');
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
