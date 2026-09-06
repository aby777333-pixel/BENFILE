import { describe, expect, it } from 'vitest';
import { computeWealth } from '@/lib/wealth/wealth-engine';
import { analyzeClient, diffAnalyses } from '@/lib/wealth/behavior-engine';
import { assertNoDarkPatterns, buildBriefs, recommendApproach } from '@/lib/wealth/approach-engine';
import { ddScorecard, matchProjects } from '@/lib/wealth/matching-engine';
import { detectAnomalies } from '@/lib/wealth/anomaly-engine';
import { extractClaims } from '@/lib/wealth/human-input-engine';
import { classifyByName, consistencyChecks, parseStructured, refreshDue } from '@/lib/wealth/documents-engine';
import { answerQuestion } from '@/lib/wealth/nlq';
import type { AssetRow, ClientIntelligenceContext, LiabilityRow, ProjectRow, PlotRow, PropertyPreferencesRow } from '@/lib/wealth/types';

const NOW = new Date('2026-09-06T00:00:00Z');
const asset = (o: Partial<AssetRow>): AssetRow => ({ id: o.id ?? Math.random().toString(36).slice(2), client_id: 'c', category: 'REAL_ESTATE', subtype: null, title: 'x', details: {}, value_low: null, value_mid: null, value_high: null, currency: 'INR', valuation_basis: 'NOT_VALUED', valuation_date: null, pricing_source: null, valuation_method: null, liquidity: 'ILLIQUID', evidence_class: 'CLIENT_DECLARED', confidence: 'LOW', ownership_scope: 'PERSONAL', ownership_pct: null, is_inherited: false, encumbered: null, linked_liability_id: null, acquired_on: null, disposed_on: null, source_key: 'ANALYST', status: 'ACTIVE', ...o });
const liab = (o: Partial<LiabilityRow>): LiabilityRow => ({ id: o.id ?? 'l', client_id: 'c', liability_type: 'HOME_LOAN', lender: 'HDFC', original_amount: null, outstanding: null, monthly_obligation: null, interest_rate: null, opened_on: null, maturity_on: null, collateral: null, linked_asset_id: null, secured: true, repayment_status: 'REGULAR', days_past_due: 0, role: 'BORROWER', evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'HIGH', source_key: 'CREDIT', status: 'ACTIVE', ...o });

const baseCtx = (over: Partial<ClientIntelligenceContext> = {}): ClientIntelligenceContext => ({
  clientId: 'c', displayName: 'Rohan Kumar Mehta', now: NOW,
  verified: { incomeAnnual: 1_000_000, incomeEvidence: 'VERIFIED', employmentCurrent: true, employmentTenureMonths: 100, employerName: 'ABC Technologies', creditScore: 805, identityConsistency: 'HIGH', addressConsistency: 'MEDIUM', contactConsistency: 'HIGH', verificationConfidence: 'HIGH', profileScore: 94, openRiskSignals: [{ title: 'Inactive SIM', severity: 'LOW', requiresReview: true }], freshness: 'FRESH', completeness: 1 },
  assets: [], liabilities: [], bureau: null, cashFlow: [], banks: [], family: [], legal: [], fundSources: [], events: [], interactions: [], interests: [], contact: null, investorProfile: null, propertyPreferences: null, aifSuitability: null, humanInputs: [], documents: [], externalPending: 0,
  ...over,
});

describe('wealth engine', () => {
  it('refuses to estimate net worth without valued assets', () => {
    const w = computeWealth({ assets: [asset({ title: 'Flat' })], liabilities: [], bureau: null, cashFlow: [], banks: [], incomeAnnual: 1e6, incomeEvidence: 'VERIFIED', now: NOW });
    expect(w.personal.netWorth.range).toBeNull();
    expect(w.personal.netWorth.confidence).toBe('INSUFFICIENT');
    expect(w.personal.netWorth.statement).toMatch(/Insufficient verified information/);
  });
  it('keeps family-linked and possible-association assets out of personal net worth and ranges values', () => {
    const w = computeWealth({
      assets: [
        asset({ title: 'Flat Koramangala', value_low: 40e6, value_mid: 42e6, value_high: 45e6, valuation_basis: 'ESTIMATED_MARKET', evidence_class: 'OFFICIAL_PUBLIC_RECORD', confidence: 'HIGH' }),
        asset({ title: 'MF portfolio', category: 'MUTUAL_FUND', value_mid: 16e6, valuation_basis: 'STATEMENT', evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'VERIFIED', liquidity: 'LIQUID' }),
        asset({ title: 'Father farmland', value_mid: 30e6, ownership_scope: 'FAMILY_LINKED', evidence_class: 'CLIENT_DECLARED' }),
        asset({ title: 'Ferrari next to him in a photo', category: 'VEHICLE', value_mid: 40e6, evidence_class: 'POSSIBLE_ASSOCIATION' }),
      ],
      liabilities: [liab({ outstanding: 20e6, monthly_obligation: 180000 })],
      bureau: null, cashFlow: [], banks: [], incomeAnnual: 1e6, incomeEvidence: 'VERIFIED', now: NOW,
    });
    expect(w.personal.netWorth.range?.mid).toBe(42e6 + 16e6 - 20e6);
    expect(w.personal.netWorth.range?.low).toBe(40e6 + 16e6 - 20e6);
    expect(w.familyLinked.range?.mid).toBe(30e6);
    expect(w.possibleAssociations.count).toBe(1);
    expect(w.personal.liquidNetWorth.range?.mid).toBe(16e6);
    expect(w.personal.investableAssets.range?.mid).toBe(16e6);
    expect(w.capitalMap.find((c) => c.key === 'UNKNOWN')?.items.length).toBe(2);
    expect(w.debtService.dti.status).toBe('ELEVATED');
    expect(w.debtService.emiToIncome.value).toBeCloseTo(180000 / (1e6 / 12), 3);
  });
  it('does not compute debt-service ratios without inputs', () => {
    const w = computeWealth({ assets: [], liabilities: [liab({ outstanding: null })], bureau: null, cashFlow: [], banks: [], incomeAnnual: null, incomeEvidence: null, now: NOW });
    expect(w.debtService.dti.status).toBe('NOT_AVAILABLE');
    expect(w.debtService.dti.missing).toContain('verified income');
  });
});

describe('analyze client', () => {
  const cf = Array.from({ length: 12 }, (_, i) => ({ period: `2025-${String(i + 1).padStart(2, '0')}`, inflows: 95000 + (i % 3) * 1000, outflows: 62000, salary_credits: 83000, other_income: 2000, investment_transfers: 15000, debt_payments: 18000, essential_spend: 30000, discretionary_spend: i < 6 ? 10000 : 13000, cash_withdrawals: 4000, large_inflows: [], large_outflows: [], returned_transactions: 0, categories: { HOUSING: 18000, GROCERIES: 9000, DINING: 4000, TRAVEL: 3000 }, evidence_class: 'AUTHORIZED_THIRD_PARTY' as const, source_key: 'AA' }));
  const ctx = baseCtx({
    assets: [
      asset({ title: 'Flat', value_mid: 42e6, valuation_basis: 'ESTIMATED_MARKET', evidence_class: 'OFFICIAL_PUBLIC_RECORD', confidence: 'HIGH', details: { city: 'Bengaluru' } }),
      asset({ title: 'Plot Whitefield', subtype: 'PLOT', value_mid: 8e6, valuation_basis: 'OFFICIAL_GUIDELINE', evidence_class: 'OFFICIAL_PUBLIC_RECORD', confidence: 'HIGH', details: { city: 'Bengaluru' }, acquired_on: '2019-01-01' }),
      asset({ title: 'MF A', category: 'MUTUAL_FUND', value_mid: 6e6, valuation_basis: 'STATEMENT', evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'VERIFIED', liquidity: 'LIQUID', acquired_on: '2020-01-01' }),
      asset({ title: 'MF B', category: 'MUTUAL_FUND', value_mid: 4e6, valuation_basis: 'STATEMENT', evidence_class: 'AUTHORIZED_THIRD_PARTY', confidence: 'VERIFIED', liquidity: 'LIQUID', acquired_on: '2021-01-01' }),
    ],
    liabilities: [liab({ outstanding: 20e6, monthly_obligation: 18000 })],
    cashFlow: cf,
    investorProfile: { objectives: ['Long-term growth'], horizon: '5-10 years', liquidity: 'Low', riskTolerance: 'Balanced', experience: 'Moderate (2-5 years)', incomeRange: '10-25 L', netWorthRange: '1-5 Cr', sourceOfFunds: 'Salary', sourceOfWealth: 'Employment', expectedAmount: 1e7, preferences: ['Mutual funds'], confirmed: true },
    interactions: [
      { id: 'i1', occurred_at: '2026-08-20T10:00:00Z', channel: 'EMAIL', direction: 'OUTBOUND', kind: 'PROPOSAL', summary: 'Sent portfolio review; client asked for detailed comparison table and fee calculation', questions: ['What are the total fees?'], objections: [], interests: ['diversification'], concerns: ['lock-in'], commitments: [], products_discussed: ['AIF'], client_declared_changes: [], follow_up_at: null, outcome: 'PROGRESSED', decline_reason: null, response_time_hours: 20 },
      { id: 'i2', occurred_at: '2026-07-02T10:00:00Z', channel: 'IN_PERSON', direction: 'OUTBOUND', kind: 'MEETING', summary: 'Meeting: discussed diversification away from real estate; client wants documentation before deciding', questions: ['Can I see the last 3 years performance documentation?'], objections: ['Lock-in is too long'], interests: ['diversification'], concerns: ['liquidity'], commitments: ['Send factsheet'], products_discussed: ['AIF'], client_declared_changes: [], follow_up_at: null, outcome: 'PROGRESSED', decline_reason: null, response_time_hours: 30 },
    ],
    humanInputs: [{ id: 'h1', category: 'THIRD_PARTY_SAID', source_type: 'INTRODUCER_STATEMENT', body: 'Introducer says he owns 20 acres near Hosur and sold his startup last year', attributed_to: 'Introducer', author_confidence: 'MEDIUM', first_hand: false, client_confirmed: false, has_evidence: false, related_company: null, related_property: null, status: 'OPEN', verification_result: null, author_id: 'u', created_at: '2026-08-01' }],
  });
  const a = analyzeClient(ctx);
  it('produces evidence-backed sections with human influence NONE', () => {
    expect(a.inputs.humanInfluenceOnFinancialProfile).toBe('NONE');
    expect(a.inputs.humanContextItems).toBe(1);
    expect(a.financialHealth.result.value).toBe('Strong');
    expect(a.saving.result.value).toBe('Consistent saver');
    expect(a.investmentBehavior.result.value).toContain('Systematic investor');
    expect(a.investmentBehavior.result.value).toContain('Real-estate-heavy investor');
    expect(a.persona?.label).toBe('Property-Led Wealth Holder');
    expect(a.riskPreference.result.value).toBe('Balanced');
    expect(a.riskPreference.result.evidenceClass).toBe('CLIENT_DECLARED');
    expect(a.liquidity.runwayMonths).not.toBeNull();
    expect(a.engagement.depth).toMatch(/Document|quantitative/);
    expect(a.priorities.some((p) => p.label === 'Diversification' && p.kind === 'OBSERVED')).toBe(true);
    expect(a.wealth.personal.netWorth.range?.mid).toBe(42e6 + 8e6 + 10e6 - 20e6);
    expect(a.humanContext.items[0].verifiable).toBe(true);
    expect(a.spending.result.value).toMatch(/discretionary expenditure increased/);
  });
  it('reports insufficient data instead of guessing', () => {
    const thin = analyzeClient(baseCtx({ verified: { ...baseCtx().verified, creditScore: null, employmentCurrent: null, incomeAnnual: null } }));
    expect(thin.financialHealth.result.evidenceClass).toBe('INSUFFICIENT_DATA');
    expect(thin.riskPreference.result.value).toMatch(/Not assessed/);
    expect(thin.resilience.result.value).toBe('Insufficient data');
    expect(thin.persona).toBeNull();
  });
  it('diffs versions', () => {
    const d = diffAnalyses(a, analyzeClient({ ...ctx, cashFlow: ctx.cashFlow.slice(0, 6), liabilities: [] }));
    expect(d.changes.some((c) => c.key === 'Net worth')).toBe(true);
  });

  describe('approach engine', () => {
    const funds = [{ id: 'f1', name: 'BENFILE Growth AIF II', category: 'CAT_II', strategy: 'Late-stage private credit', thesis: null, min_commitment: 1e7, lock_in_years: 5, tenure_years: 7, fees: {}, risk_factors: [], status: 'OPEN', closing_date: '2026-12-31' }];
    const s = recommendApproach(ctx, a, 'AIF', { funds });
    it('rates AIF relevance from evidence and demands suitability first', () => {
      expect(['HIGH', 'MEDIUM']).toContain(s.aif.relevance);
      expect(s.aif.missing).toContain('suitability questionnaire');
      expect(s.nextBestAction.action).toMatch(/suitability|diversification/i);
      expect(s.summary.avoid).toContain('Guaranteed-return language');
      expect(s.channel.depth).toMatch(/Document|quantitative/);
      expect(s.concerns).toContain('Liquidity / lock-in');
      expect(s.firstConversation.likelyObjections[0].response).not.toMatch(/hurry|limited/i);
      expect(assertNoDarkPatterns(JSON.stringify(s))).toEqual([]);
      expect(s.mode).toBe('PERSONALISED');
    });
    it('falls back to discovery mode with no history', () => {
      const fresh = recommendApproach(baseCtx(), analyzeClient(baseCtx()), 'BOTH', { funds: [] });
      expect(fresh.mode).toBe('FIRST_TIME_DISCOVERY');
      expect(fresh.nextBestAction.action).toMatch(/discovery/i);
      expect(fresh.aif.relevance).toBe('INSUFFICIENT');
    });
    it('caps relevance after an explicit decline and warns on contact pressure', () => {
      const declined = recommendApproach({ ...ctx, interests: [{ category: 'AIF', stance: 'NOT_INTERESTED', evidence_class: 'CLIENT_DECLARED', source: 'call', note: null }], interactions: Array.from({ length: 5 }, (_, i) => ({ ...ctx.interactions[0], id: `x${i}`, occurred_at: new Date(NOW.getTime() - i * 86_400_000).toISOString() })) }, a, 'AIF', { funds, maxContacts7d: 3 });
      expect(declined.aif.relevance).toBe('LOW');
      expect(declined.contactPressure.warning).toMatch(/contacted 5 times/);
      expect(declined.nextBestAction.action).toMatch(/Pause outreach/);
    });
    it('builds briefs', () => {
      const b = buildBriefs(ctx, a, s);
      expect(b.thirtySecond.length).toBe(3);
      expect(b.aifBrief.suitabilityRequired.length).toBeGreaterThan(0);
    });
  });

  it('answers NL questions from structured data only', () => {
    const s = recommendApproach(ctx, a, 'AIF', { funds: [] });
    expect(answerQuestion('What is the client\'s verified mutual-fund exposure?', ctx, a, s).answer).toMatch(/1\.00 Cr across 2/);
    expect(answerQuestion('List all active loans', ctx, a, s).items).toHaveLength(1);
    expect(answerQuestion('Which parts of the net-worth estimate are uncertain?', ctx, a, s).intent).toBe('net_worth_uncertainty');
    expect(answerQuestion('Tell me his religion', ctx, a, s).intent).toBe('unknown');
  });
});

describe('property matching', () => {
  const prefs: PropertyPreferencesRow = { buyer_type: 'INVESTOR', buyer_type_basis: 'declared', purpose: 'INVESTMENT', budget_min: 2e6, budget_max: 6e6, cities: ['Coimbatore'], districts: [], localities: [], property_types: ['PLOT'], plot_size_min_sqft: 1800, plot_size_max_sqft: 3000, facing: ['North', 'East'], road_width_min_ft: 30, corner_preferred: true, approval_required: true, proximity: ['HIGHWAY'], horizon: '5-7 years', financing: 'CASH', field_evidence: {} };
  const project = (o: Partial<ProjectRow>): ProjectRow => ({ id: 'p1', code: 'P1', name: 'Green Meadows', project_type: 'PLOTTED_LAYOUT', approval_authority: 'DTCP', approval_number: 'DTCP/1/2025', approval_status: 'APPROVED', rera_number: null, survey_numbers: [], city: 'Coimbatore', district: 'Coimbatore', state: 'Tamil Nadu', locality: 'Saravanampatti', lat: null, lng: null, total_area_acres: 12, plots_total: 120, road_widths_ft: [30, 40], amenities: [], osr_pct: 10, utilities: {}, infrastructure: [{ name: 'NH-544', kind: 'HIGHWAY', status: 'EXISTING', distance_km: 2, source: 'survey' }], geo: {}, price_per_sqft: 2200, price_history: [], guideline_value_per_sqft: 1400, comparables: [], launch_price_per_sqft: 2000, thesis: null, documents: [], status: 'ACTIVE', ...o });
  const plots: PlotRow[] = [
    { id: 'a', project_id: 'p1', plot_number: '27', area_sqft: 2400, width_ft: 40, depth_ft: 60, facing: 'North', road_width_ft: 40, corner: true, park_facing: false, near_entrance: true, status: 'AVAILABLE', price: 5.3e6, negotiated_price: null },
    { id: 'b', project_id: 'p1', plot_number: '58', area_sqft: 1200, width_ft: 30, depth_ft: 40, facing: 'South', road_width_ft: 30, corner: false, park_facing: false, near_entrance: false, status: 'AVAILABLE', price: 2.6e6, negotiated_price: null },
    { id: 'c', project_id: 'p1', plot_number: '3', area_sqft: 2400, width_ft: 40, depth_ft: 60, facing: 'East', road_width_ft: 40, corner: false, park_facing: true, near_entrance: false, status: 'BOOKED', price: 5.3e6, negotiated_price: null },
  ];
  const ddOk = ['TITLE_CHAIN', 'PARENT_DOCUMENTS', 'EC', 'PATTA', 'SURVEY', 'APPROVAL', 'ACCESS', 'LITIGATION'].map((k) => ({ project_id: 'p1', item_key: k, status: 'VERIFIED' as const, finding: null }));
  it('ranks plots with explanations and concerns', () => {
    const m = matchProjects({ prefs, projects: [project({})], plots, dd: ddOk, holdings: [], minimumDdItems: ['TITLE_CHAIN', 'EC', 'APPROVAL'] });
    expect(m[0].score).toBeGreaterThanOrEqual(60);
    expect(m[0].recommendSiteVisit).toBe(true);
    expect(m[0].plots[0].plot.plot_number).toBe('27');
    expect(m[0].plots[0].why).toContain('North-facing as requested');
    expect(m[0].plots.find((p) => p.plot.plot_number === '58')?.concerns[0]).toMatch(/outside requested/);
    expect(m[0].plots.some((p) => p.plot.plot_number === '3')).toBe(false);
  });
  it('blocks recommendation on critical due-diligence issues', () => {
    const dd = [...ddOk.filter((d) => d.item_key !== 'LITIGATION'), { project_id: 'p1', item_key: 'LITIGATION', status: 'CRITICAL_ISSUE' as const, finding: 'Pending title suit' }];
    const m = matchProjects({ prefs, projects: [project({})], plots, dd, holdings: [], minimumDdItems: ['TITLE_CHAIN', 'EC', 'APPROVAL'] });
    expect(m[0].ddScore.overall).toBe('BLOCKED');
    expect(m[0].recommendSiteVisit).toBe(false);
    expect(m[0].score).toBeLessThanOrEqual(15);
  });
  it('flags geographic concentration and proposed infrastructure', () => {
    const m = matchProjects({ prefs, projects: [project({ infrastructure: [{ name: 'Metro Phase 3', kind: 'METRO', status: 'PROPOSED', distance_km: 4, source: 'press' }] })], plots, dd: ddOk, holdings: [asset({ category: 'REAL_ESTATE', details: { city: 'Coimbatore' } })], minimumDdItems: [] });
    expect(m[0].concerns.some((c) => /concentration/.test(c))).toBe(true);
    expect(m[0].concerns.some((c) => /proposed\/announced/.test(c))).toBe(true);
  });
  it('scorecard reports incomplete when minimum items are missing', () => {
    expect(ddScorecard([], ['EC']).overall).toBe('INCOMPLETE');
  });
});

describe('anomalies, human input, documents', () => {
  it('detects shared identifiers and duplicate documents without calling them fraud', () => {
    const an = detectAnomalies({ profile: null, sharedIdentifiers: [{ kind: 'PHONE', other_client_ids: ['x'] }], documents: [], now: NOW });
    expect(an[0].type).toBe('SHARED_PHONE');
    expect(an[0].detail).not.toMatch(/fraud/i);
  });
  it('extracts verifiable claims with plans and cautions', () => {
    const c = extractClaims('Introducer says he owns 20 acres near Hosur and is a director of Mehta Family Ventures LLP');
    expect(c.map((x) => x.kind)).toContain('LAND_HOLDING');
    expect(c.map((x) => x.kind)).toContain('DIRECTORSHIP');
    expect(c.find((x) => x.kind === 'DIRECTORSHIP')?.entities).toContain('Mehta Family Ventures LLP');
    expect(c.find((x) => x.kind === 'LAND_HOLDING')?.cautions[0]).toMatch(/Never add to the asset register/);
  });
  it('classifies, parses and checks documents', () => {
    expect(classifyByName('rohan_pan_card.pdf')).toBe('PAN_CARD');
    expect(classifyByName('CAMS_statement_aug.pdf')).toBe('MUTUAL_FUND_STATEMENT');
    const f = parseStructured('application/json', 'x.json', JSON.stringify({ name: 'Rohan K Mehta', dob: '1991-03-14', number: 'ABCPM1234D' }));
    expect(f?.name).toBe('Rohan K Mehta');
    const c = consistencyChecks('PAN_CARD', f, {}, { fullName: 'Rohan Kumar Mehta', dob: '1991-03-14', addresses: [] });
    expect(c.find((x) => x.check === 'NAME_VS_PROFILE')?.status).toBe('PARTIAL_MATCH');
    expect(c.find((x) => x.check === 'DOB_VS_PROFILE')?.status).toBe('MATCH');
    expect(refreshDue('PASSPORT', '2026-01-01', '2020-01-01').flag).toBe('EXPIRED');
    expect(refreshDue('BANK_STATEMENT', '2026-01-01', null).flag).toBe('STALE');
  });
});
