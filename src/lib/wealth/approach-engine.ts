/**
 * RECOMMEND BUSINESS APPROACH engine (AIF + Land/Property specialisation).
 * Converts verified profile + declared preferences + interaction history into a relationship strategy.
 * Suitability beats revenue. No dark patterns: the engine never emits urgency, scarcity or fear language,
 * and never uses sensitive personal characteristics. Every recommendation cites its evidence.
 */
import type { ClientAnalysis } from './behavior-engine';
import { cr } from './wealth-engine';
import type { AifFundRow, ClientIntelligenceContext, Confidence } from './types';

export const APPROACH_ENGINE_VERSION = 'approach-1.0.0';

export type Objective = 'AIF' | 'PROPERTY' | 'BOTH' | 'DISCOVERY' | 'WEALTH_MANAGEMENT' | 'INSURANCE' | 'LOAN' | 'ESTATE_PLANNING' | 'OTHER';
export type Relevance = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface Reasoned {
  relevance: Relevance;
  confidence: number; // 0..100
  reasons: string[];
  evidence: string[];
  missing: string[];
  whatWouldChange: string[];
}

export interface OpportunityItem {
  key: string;
  label: string;
  classification: 'VERIFIED_NEED' | 'CLIENT_DECLARED_INTEREST' | 'POTENTIAL_OPPORTUNITY' | 'INSUFFICIENT_INFORMATION';
  why: string;
  evidence: string[];
}

export interface ProductRelevance {
  product: string;
  relevance: Relevance;
  reason: string;
  suitabilityStatus: 'SUITABILITY_PENDING' | 'SUITABILITY_ESTABLISHED' | 'NOT_SUITABLE_ON_CURRENT_DATA';
  evidence: string[];
}

export interface ApproachStrategy {
  engineVersion: string;
  computedAt: string;
  objective: Objective;
  mode: 'FIRST_TIME_DISCOVERY' | 'PERSONALISED';
  playbook: string;
  approachConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceBasis: string[];
  aif: Reasoned & { portfolioGap: string | null; requiredBeforeRecommendation: string[]; journeyStage: string; fundsRelevant: Array<{ id: string; name: string; why: string; concerns: string[] }> };
  property: Reasoned & { buyerType: string; buyerTypeBasis: string; behaviourLabels: string[]; preferenceSummary: string[]; siteVisitAdvised: boolean };
  landowner: { relevant: boolean; stage: string | null; note: string };
  matrix: Array<{ key: string; label: string; relevance: Relevance; why: string }>;
  products: ProductRelevance[];
  opportunities: OpportunityItem[];
  concentrationWarnings: string[];
  capitalAllocation: Array<{ label: string; pct: number }>;
  summary: { lead: string; focus: string[]; avoid: string[]; meetingStyle: string[]; nextStep: string };
  firstConversation: { opening: string; topics: string[]; questions: string[]; evidenceToBring: string[]; avoid: string[]; likelyObjections: Array<{ concern: string; whyItMatters: string; response: string }>; nextStepObjective: string };
  channel: { recommended: string; format: string; depth: string; reason: string };
  motivations: Array<{ label: string; kind: 'CLIENT_DECLARED' | 'OBSERVED'; evidence: string }>;
  concerns: string[];
  timing: string[];
  nextBestAction: { action: string; reason: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; evidence: string[] };
  nextConversation: { objective: string; startWith: string; ask: string; show: string; avoid: string; goal: string };
  contactPressure: { contacts7d: number; warning: string | null; doNotContact: boolean; marketingPermission: boolean };
  interestMemory: { interested: string[]; notInterested: string[]; unknown: string[] };
  relationshipEngagement: { level: 'ACTIVE' | 'MODERATE' | 'DORMANT' | 'NEW'; basis: string[] };
  scores: { aif: number | null; property: number | null; engagement: number | null };
  dataGaps: string[];
  whyThisApproach: string[];
}

const HIGH = 'HIGH' as const;
const AIF_MIN_DEFAULT = 10_000_000;

function relevanceFromScore(s: number, enough: boolean): Relevance {
  if (!enough) return 'INSUFFICIENT';
  return s >= 70 ? 'HIGH' : s >= 40 ? 'MEDIUM' : 'LOW';
}

export function recommendApproach(ctx: ClientIntelligenceContext, analysis: ClientAnalysis, objective: Objective, opts: { funds: AifFundRow[]; aifMinCommitment?: number; maxContacts7d?: number; landownerStage?: string | null; siteVisits?: number; plotInterests?: number } = { funds: [] }): ApproachStrategy {
  const now = ctx.now;
  const w = analysis.wealth;
  const ix = [...ctx.interactions].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const interestsOf = (stance: string) => ctx.interests.filter((i) => i.stance === stance).map((i) => i.category);
  const interested = interestsOf('INTERESTED');
  const notInterested = interestsOf('NOT_INTERESTED');
  const declaredAifInterest = interested.includes('AIF') || interested.includes('PMS') || interested.includes('PRIVATE_EQUITY');
  const declinedAif = notInterested.includes('AIF');
  const declaredPropInterest = interested.some((i) => ['REAL_ESTATE', 'LAND', 'PLOTS', 'COMMERCIAL_PROPERTY'].includes(i));
  const declinedProp = notInterested.some((i) => ['REAL_ESTATE', 'LAND', 'PLOTS'].includes(i));
  const textAll = ix.flatMap((i) => [i.summary, ...i.questions, ...i.interests, ...i.concerns, ...i.objections]).join(' ');
  const aifMin = opts.aifMinCommitment ?? AIF_MIN_DEFAULT;
  const comp = w.personal.composition;
  const reShare = comp.find((c) => c.key === 'REAL_ESTATE')?.pct ?? 0;
  const finShare = comp.filter((c) => ['MUTUAL_FUND', 'SECURITY', 'FINANCIAL_INVESTMENT'].includes(c.key)).reduce((s, c) => s + c.pct, 0);
  const aifShare = ctx.assets.filter((a) => a.status === 'ACTIVE' && /AIF|PMS/i.test(`${a.subtype} ${a.title}`)).length;
  const investable = w.personal.investableAssets.range?.mid ?? null;
  const liquid = w.personal.liquidNetWorth.range?.mid ?? null;
  const suit = ctx.aifSuitability;
  const horizonLong = /5|7|10|long/i.test(`${suit?.horizon ?? ''} ${ctx.investorProfile?.horizon ?? ''}`);

  /* ---------------- AIF opportunity engine ---------------- */
  const aifReasons: string[] = [];
  const aifEv: string[] = [];
  const aifMissing: string[] = [];
  let aifScore = 0;
  let aifEnough = false;
  if (investable !== null) {
    aifEnough = true;
    if (investable >= aifMin) { aifScore += 30; aifReasons.push(`Verified/declared investable financial assets INR ${cr(investable)} exceed the configured minimum commitment INR ${cr(aifMin)}.`); aifEv.push(`Investable assets ${cr(investable)} (${w.personal.investableAssets.confidence.toLowerCase()} confidence)`); }
    else if (investable >= aifMin * 0.5) { aifScore += 12; aifReasons.push(`Investable assets INR ${cr(investable)} are below the minimum commitment; capacity would need confirmation.`); }
    else { aifReasons.push(`Investable assets INR ${cr(investable)} are well below the minimum commitment INR ${cr(aifMin)}.`); }
  } else aifMissing.push('investable assets (statements / account aggregation)');
  if (reShare >= 50) { aifScore += 15; aifReasons.push(`Known wealth is concentrated in direct real estate (${reShare}%), so an alternative-investment diversification discussion may be legitimate.`); aifEv.push(`Real estate ${reShare}% of known assets`); }
  if (aifShare) { aifScore += 10; aifReasons.push(`Existing AIF/PMS exposure (${aifShare} holding(s)) indicates experience with managed alternative structures.`); aifEv.push(`${aifShare} AIF/PMS holding(s)`); }
  if (finShare >= 15) { aifScore += 8; aifReasons.push('Existing market-linked investments indicate experience with financial products.'); }
  if (horizonLong) { aifScore += 12; aifReasons.push('Client-declared investment horizon is long enough for a locked structure.'); aifEv.push(`Declared horizon: ${suit?.horizon ?? ctx.investorProfile?.horizon}`); } else aifMissing.push('investment horizon confirmation');
  if (liquid !== null && liquid > 0) { aifScore += 8; aifReasons.push(`Liquidity appears sufficient on currently verified information (liquid net worth INR ${cr(liquid)}).`); } else aifMissing.push('liquidity requirements');
  if (declaredAifInterest) { aifScore += 12; aifReasons.push('Client has declared interest in AIF/PMS/private-equity products.'); aifEv.push('Interest memory: AIF'); }
  if (/aif|alternative|pms|private equity/i.test(textAll)) { aifScore += 5; aifEv.push('AIF discussed in prior interactions'); }
  if (declinedAif) { aifScore = Math.min(aifScore, 20); aifReasons.push('Client previously declined AIF products; do not re-pitch without a legitimate new reason.'); }
  if (!suit || suit.stage === 'CLIENT_INTELLIGENCE') aifMissing.push('suitability questionnaire');
  if (!suit?.expected_amount && !ctx.investorProfile?.expectedAmount) aifMissing.push('expected investment amount');
  if (!ctx.fundSources.some((f) => f.kind === 'SOURCE_OF_FUNDS')) aifMissing.push('source-of-funds documentation');
  if (!ctx.investorProfile?.objectives?.length) aifMissing.push('investment objective confirmation');
  if (analysis.riskPreference.result.confidence === 'INSUFFICIENT') aifMissing.push('risk profile');
  const aifRel = relevanceFromScore(aifScore, aifEnough || declaredAifInterest);
  const aifConf = Math.max(20, Math.min(95, 40 + aifEv.length * 12 - aifMissing.length * 5));
  const fundsRelevant = opts.funds.filter((f) => f.status !== 'CLOSED').map((f) => ({ id: f.id, name: f.name, why: `${f.category.replace('_', ' ')} - ${f.strategy ?? 'strategy on file'}; min commitment INR ${cr(f.min_commitment)}${investable !== null ? (investable >= f.min_commitment ? ' (within investable assets)' : ' (above current investable assets)') : ''}.`, concerns: [...(f.lock_in_years ? [`Lock-in ${f.lock_in_years} years vs declared liquidity needs ${suit?.liquidity_needs ?? ctx.investorProfile?.liquidity ?? 'unknown'}`] : []), ...(f.closing_date ? [`Closing date ${f.closing_date} - state it plainly, never as pressure`] : [])] }));
  const aif: ApproachStrategy['aif'] = { relevance: aifRel, confidence: aifConf, reasons: aifReasons, evidence: aifEv, missing: aifMissing, whatWouldChange: ['Verified investable assets via statements or account aggregation', 'Completed suitability questionnaire', 'Explicit client declaration of interest or decline'], portfolioGap: comp.length ? `Current known allocation: ${comp.map((c) => `${c.label} ${c.pct}%`).join(', ')}; AIF ${aifShare ? 'present' : '0%'}.${reShare >= 50 ? ' Potential alternative-investment diversification discussion - not a recommendation to invest a fixed share.' : ''}` : null, requiredBeforeRecommendation: ['Investor classification', 'Minimum investment check', 'Suitability', 'Risk profiling', 'Investment experience', 'Horizon', 'Liquidity requirements', 'Source of funds', 'Source of wealth', 'KYC', 'AML', 'Sanctions', 'PEP where applicable', 'Disclosures', 'Consent', 'Documentation'], journeyStage: suit?.stage ?? 'CLIENT_INTELLIGENCE', fundsRelevant };

  /* ---------------- Property opportunity engine ---------------- */
  const pp = ctx.propertyPreferences;
  const reAssets = ctx.assets.filter((a) => a.status === 'ACTIVE' && a.category === 'REAL_ESTATE');
  const pReasons: string[] = [];
  const pEv: string[] = [];
  const pMissing: string[] = [];
  let pScore = 0;
  let pEnough = false;
  if (pp) {
    pEnough = true;
    pScore += 20;
    pReasons.push(`Property requirements declared: ${[pp.purpose, pp.property_types.join('/'), pp.cities.join('/'), pp.budget_max ? `budget up to INR ${cr(pp.budget_max)}` : null].filter(Boolean).join(', ')}.`);
    pEv.push('Declared property preferences');
    if (pp.budget_max) { pScore += 15; pEv.push(`Budget ${pp.budget_min ? cr(pp.budget_min) + ' - ' : ''}${cr(pp.budget_max)}`); } else pMissing.push('budget');
    if (pp.cities.length) pScore += 10; else pMissing.push('location preference');
  } else { pMissing.push('property requirements (budget, location, purpose)'); }
  if (reAssets.length) { pScore += 10; pReasons.push(`${reAssets.length} property holding(s) on record${reAssets.some((a) => /PLOT|LAND/i.test(`${a.subtype}`)) ? ', including land/plots' : ''}.`); pEv.push(`${reAssets.length} property holding(s)`); pEnough = true; }
  if (declaredPropInterest) { pScore += 15; pReasons.push('Client has declared interest in land/plots/property.'); pEv.push('Interest memory: property'); pEnough = true; }
  if (/plot|land|layout|site visit|acre|sq\.? ?ft|dtcp|cmda/i.test(textAll)) { pScore += 10; pEv.push('Property discussed in prior interactions'); pEnough = true; }
  if ((opts.siteVisits ?? 0) > 0) { pScore += 10; pEv.push(`${opts.siteVisits} site visit(s)`); }
  if ((opts.plotInterests ?? 0) > 0) { pScore += 8; pEv.push(`${opts.plotInterests} plot interest(s)`); }
  if (liquid !== null && liquid > 0) { pScore += 7; pReasons.push('Liquidity appears available for a booking on currently verified information.'); }
  if (declinedProp) { pScore = Math.min(pScore, 20); pReasons.push('Client previously declined property; do not re-pitch without a new reason.'); }
  const behaviourLabels: string[] = [];
  const plots = reAssets.filter((a) => /PLOT|LAND/i.test(`${a.subtype} ${a.title}`));
  if (plots.length >= 2) behaviourLabels.push('Plot accumulator');
  if (reAssets.some((a) => (a.details as { rental?: boolean }).rental)) behaviourLabels.push('Rental-income investor');
  if (reAssets.some((a) => /COMMERCIAL/i.test(`${a.subtype}`))) behaviourLabels.push('Commercial-property investor');
  if (reAssets.some((a) => /AGRI|FARM/i.test(`${a.subtype}`))) behaviourLabels.push('Agricultural-land investor');
  if (reAssets.length && reAssets.every((a) => a.acquired_on && (now.getTime() - new Date(a.acquired_on).getTime()) / (365.25 * 86_400_000) >= 5)) behaviourLabels.push('Long-term land/property holder');
  if (!reAssets.length && pp) behaviourLabels.push('First-time buyer (no holdings on record)');
  const buyerType = pp?.buyer_type ?? 'MIXED_UNKNOWN';
  const buyerTypeBasis = pp?.buyer_type_basis ?? (pp?.purpose === 'SELF_USE' ? 'Declared purpose: self-use' : pp?.purpose === 'INVESTMENT' ? 'Declared purpose: investment' : 'Not determined - ask explicitly; never assumed');
  const property: ApproachStrategy['property'] = { relevance: relevanceFromScore(pScore, pEnough), confidence: Math.max(20, Math.min(95, 40 + pEv.length * 10 - pMissing.length * 8)), reasons: pReasons, evidence: pEv, missing: pMissing, whatWouldChange: ['Declared budget and location', 'A site visit with structured feedback', 'Explicit decline'], buyerType, buyerTypeBasis, behaviourLabels, preferenceSummary: pp ? [pp.plot_size_min_sqft || pp.plot_size_max_sqft ? `Plot size ${pp.plot_size_min_sqft ?? '?'}-${pp.plot_size_max_sqft ?? '?'} sq ft` : null, pp.facing.length ? `Facing ${pp.facing.join('/')}` : null, pp.road_width_min_ft ? `Road width >= ${pp.road_width_min_ft} ft` : null, pp.approval_required ? 'Approved layout required' : null, pp.proximity.length ? `Proximity: ${pp.proximity.join(', ')}` : null, pp.horizon ? `Horizon ${pp.horizon}` : null, pp.financing ? `Financing ${pp.financing}` : null].filter((x): x is string => !!x) : [], siteVisitAdvised: pScore >= 50 && !declinedProp };

  /* ---------------- Landowner ---------------- */
  const landowner = { relevant: !!opts.landownerStage, stage: opts.landownerStage ?? null, note: opts.landownerStage ? `Landowner journey at stage ${opts.landownerStage.replace(/_/g, ' ').toLowerCase()}. Never use private financial-distress information in negotiation.` : 'No landowner profile.' };

  /* ---------------- Matrix, products, opportunities ---------------- */
  const matrix: ApproachStrategy['matrix'] = [
    { key: 'AIF', label: 'AIF', relevance: aif.relevance, why: aifReasons[0] ?? 'Insufficient information.' },
    { key: 'LAND', label: 'Land investment', relevance: pp?.purpose === 'SELF_USE' ? 'LOW' : property.relevance, why: pp?.purpose === 'SELF_USE' ? 'Declared purpose is self-use.' : (pReasons[0] ?? 'Insufficient information.') },
    { key: 'END_USE', label: 'Residential end-use', relevance: buyerType === 'END_USER' ? property.relevance : buyerType === 'INVESTOR' ? 'LOW' : 'INSUFFICIENT', why: buyerTypeBasis },
    { key: 'COMMERCIAL', label: 'Commercial property', relevance: pp?.property_types.includes('COMMERCIAL') || behaviourLabels.includes('Commercial-property investor') ? 'MEDIUM' : 'LOW', why: pp?.property_types.includes('COMMERCIAL') ? 'Declared property type includes commercial.' : 'No declared or observed commercial interest.' },
    { key: 'PREMIUM', label: 'Premium layout', relevance: pp && pp.budget_max && pp.budget_max >= 5_000_000 ? property.relevance : 'INSUFFICIENT', why: pp?.budget_max ? `Declared budget INR ${cr(pp.budget_max)}.` : 'Budget not declared.' },
  ];
  const suitEstablished = !!suit && suit.stage !== 'CLIENT_INTELLIGENCE' && !!suit.risk_profile;
  const products: ProductRelevance[] = [
    { product: 'AIF', relevance: aif.relevance, reason: aifReasons.slice(0, 2).join(' ') || 'Insufficient information.', suitabilityStatus: declinedAif ? 'NOT_SUITABLE_ON_CURRENT_DATA' : suitEstablished ? 'SUITABILITY_ESTABLISHED' : 'SUITABILITY_PENDING', evidence: aifEv },
    { product: 'Plotted layout / land', relevance: matrix[1].relevance, reason: pReasons.slice(0, 2).join(' ') || 'Insufficient information.', suitabilityStatus: declinedProp ? 'NOT_SUITABLE_ON_CURRENT_DATA' : pp ? 'SUITABILITY_ESTABLISHED' : 'SUITABILITY_PENDING', evidence: pEv },
    { product: 'PMS', relevance: finShare >= 20 && aif.relevance !== 'INSUFFICIENT' ? 'MEDIUM' : 'LOW', reason: finShare >= 20 ? 'Existing equity exposure and market-linked experience.' : 'Limited verified market-linked exposure.', suitabilityStatus: 'SUITABILITY_PENDING', evidence: [`Financial investments ${finShare}%`] },
    { product: 'Short-term speculative trading', relevance: 'LOW', reason: analysis.investmentBehavior.result.value.includes('Long-term investor') ? 'Observed portfolio behaviour indicates long holding periods.' : 'Not aligned with a due-diligence-led relationship; never recommended by default.', suitabilityStatus: 'NOT_SUITABLE_ON_CURRENT_DATA', evidence: [] },
  ];
  const opportunities: OpportunityItem[] = [];
  if (reShare >= 60) opportunities.push({ key: 'diversification', label: 'Portfolio diversification', classification: analysis.priorities.some((p) => p.label === 'Diversification') ? 'VERIFIED_NEED' : 'POTENTIAL_OPPORTUNITY', why: `Real estate is ${reShare}% of known assets.`, evidence: [`Composition: real estate ${reShare}%`, ...analysis.priorities.filter((p) => p.label === 'Diversification').flatMap((p) => p.evidence)] });
  if (analysis.liquidity.runwayMonths && analysis.liquidity.runwayMonths[1] < 6) opportunities.push({ key: 'liquidity', label: 'Liquidity optimisation', classification: 'POTENTIAL_OPPORTUNITY', why: `Estimated runway ${analysis.liquidity.runwayMonths[0]}-${analysis.liquidity.runwayMonths[1]} months.`, evidence: [analysis.liquidity.result.basis] });
  if (!ctx.assets.some((a) => a.category === 'INSURANCE' && a.status === 'ACTIVE')) opportunities.push({ key: 'insurance', label: 'Insurance gap', classification: 'INSUFFICIENT_INFORMATION', why: 'No insurance recorded; may be held elsewhere.', evidence: [] });
  if (!ctx.assets.some((a) => a.category === 'RETIREMENT' && a.status === 'ACTIVE') && ctx.verified.employmentCurrent) opportunities.push({ key: 'retirement', label: 'Retirement planning', classification: 'INSUFFICIENT_INFORMATION', why: 'EPF exists via employment but no retirement assets are recorded.', evidence: ['Current EPFO employment'] });
  for (const i of interested) opportunities.push({ key: `interest:${i}`, label: i.replace(/_/g, ' '), classification: 'CLIENT_DECLARED_INTEREST', why: 'Recorded in interest memory.', evidence: [ctx.interests.find((x) => x.category === i)?.source ?? 'client declared'] });
  if (pp && property.relevance !== 'LOW') opportunities.push({ key: 'property_match', label: 'Property / plot matching', classification: 'CLIENT_DECLARED_INTEREST', why: 'Declared requirements can be matched to current inventory.', evidence: pEv });

  const concentrationWarnings = analysis.concentration.result.value.filter((x) => !x.startsWith('No material'));
  const capitalAllocation = comp.map((c) => ({ label: c.label, pct: c.pct }));

  /* ---------------- Engagement, channel, concerns, timing ---------------- */
  const eng = analysis.engagement;
  const objections = [...new Set(ix.flatMap((i) => i.objections))];
  const concerns = [...new Set([...ix.flatMap((i) => i.concerns), ...(/lock-?in|liquidity/i.test(textAll) ? ['Liquidity / lock-in'] : []), ...(/fee|charges|expense ratio/i.test(textAll) ? ['Fees'] : []), ...(/tax/i.test(textAll) ? ['Tax treatment'] : []), ...(/title|approval|dtcp|encumbrance|litigation/i.test(textAll) ? ['Title / approval clarity'] : []), ...(/exit|resale|liquid/i.test(textAll) ? ['Exit options'] : [])])];
  const likelyObjections = concerns.slice(0, 4).map((c) => ({ concern: c, whyItMatters: c === 'Liquidity / lock-in' ? 'Client has raised liquidity in prior interactions and holds liquid reserves.' : c === 'Fees' ? 'Client asked about fees or costs previously.' : c === 'Title / approval clarity' ? 'Client asked about documentation before progressing.' : 'Raised explicitly by the client.', response: c === 'Liquidity / lock-in' ? 'Explain liquidity terms plainly and compare the commitment period with the client\'s stated horizon.' : c === 'Fees' ? 'Present the full fee schedule with a worked example; do not minimise.' : c === 'Title / approval clarity' ? 'Bring approval documents, EC and the title chain summary; show the due-diligence scorecard.' : 'Acknowledge, answer with evidence, and record the answer.' }));
  const timing: string[] = [];
  const fu = ix.find((i) => i.follow_up_at && new Date(i.follow_up_at) >= now);
  if (fu) timing.push(`Client-requested follow-up on ${fu.follow_up_at!.slice(0, 10)}.`);
  for (const l of ctx.liabilities) if (l.maturity_on && l.status === 'ACTIVE' && (new Date(l.maturity_on).getTime() - now.getTime()) / 86_400_000 < 90) timing.push(`Loan maturity approaching (${l.liability_type.replace(/_/g, ' ')}, ${l.maturity_on}).`);
  for (const a of ctx.assets) { const m = (a.details as { maturity_on?: string }).maturity_on; if (m && (new Date(m).getTime() - now.getTime()) / 86_400_000 < 90 && (new Date(m).getTime() - now.getTime()) > 0) timing.push(`${a.title} matures ${m}.`); }
  for (const f of opts.funds) if (f.closing_date && f.status !== 'CLOSED') timing.push(`${f.name} closes ${f.closing_date} (state plainly; not a pressure tactic).`);
  const rt = ix.filter((i) => i.response_time_hours !== null);
  if (rt.length) timing.push(`Client typically responds ${eng.responsiveness?.toLowerCase() ?? 'within a few days'}.`);

  const contacts7d = ix.filter((i) => i.direction === 'OUTBOUND' && (now.getTime() - new Date(i.occurred_at).getTime()) / 86_400_000 <= 7).length;
  const maxC = opts.maxContacts7d ?? 3;
  const contactPressure = { contacts7d, warning: ctx.contact?.do_not_contact ? 'Do-not-contact instruction on file. No outreach.' : contacts7d > maxC ? `Client contacted ${contacts7d} times during the previous 7 days. Consider reducing contact frequency.` : null, doNotContact: !!ctx.contact?.do_not_contact, marketingPermission: !!ctx.contact?.marketing_permission };

  /* ---------------- Mode, playbook, confidence ---------------- */
  const dataPoints = [ctx.verified.incomeAnnual !== null, ctx.assets.length > 0, ctx.investorProfile !== null, !!pp, ix.length > 0, ctx.cashFlow.length >= 3, ctx.bureau !== null].filter(Boolean).length;
  const mode: ApproachStrategy['mode'] = ix.length === 0 && !ctx.investorProfile && !pp ? 'FIRST_TIME_DISCOVERY' : 'PERSONALISED';
  const playbook = mode === 'FIRST_TIME_DISCOVERY' ? 'New client - discovery' : w.hniIndicator.qualifies ? 'HNI' : reShare >= 50 ? 'Real-estate-heavy investor' : analysis.investmentBehavior.result.value.includes('High cash allocation') ? 'Liquidity-focused investor' : analysis.investmentExperience.result.value === 'Advanced' ? 'Experienced investor' : ix.length && (now.getTime() - new Date(ix[0].occurred_at).getTime()) / 86_400_000 > 180 ? 'Dormant client' : 'Existing client';
  const approachConfidence: ApproachStrategy['approachConfidence'] = dataPoints >= 5 && ix.length >= 3 ? 'HIGH' : dataPoints >= 3 ? 'MEDIUM' : 'LOW';
  const confidenceBasis = [`${dataPoints}/7 data domains populated`, `${ix.length} recorded interaction(s)`, `${ctx.investorProfile ? 'investor profile declared' : 'no investor profile'}`, `verification confidence ${ctx.verified.verificationConfidence ?? 'n/a'}`, `data recency: ${ctx.verified.freshness ?? 'n/a'}`];

  /* ---------------- Summary / first conversation / NBA ---------------- */
  const wantsAif = objective === 'AIF' || objective === 'BOTH';
  const wantsProp = objective === 'PROPERTY' || objective === 'BOTH';
  const dataDriven = eng.depth?.startsWith('Document') || eng.depth?.startsWith('Moderate');
  const focus: string[] = [];
  const avoid: string[] = ['Guaranteed-return language', 'Artificial urgency or scarcity', 'Opening with a specific product before establishing suitability', 'Comparisons unsupported by evidence', 'Minimising risk, fees or lock-in'];
  if (declinedAif) avoid.push('Re-pitching AIF (previously declined)');
  if (declinedProp) avoid.push('Re-pitching property (previously declined)');
  if (mode === 'FIRST_TIME_DISCOVERY') focus.push('Financial objectives', 'Investment horizon', 'Liquidity needs', 'Existing investments', 'Risk tolerance (questionnaire)', 'Decision-making process', 'Expected investment size', 'Past experience', 'Reporting expectations');
  else {
    if (reShare >= 50) focus.push('Current asset allocation and whether diversification is an objective');
    if (concerns.includes('Liquidity / lock-in')) focus.push('Liquidity and lock-in terms, documented');
    if (wantsAif && !declinedAif) focus.push('Fund structure, governance, reporting and fees', 'Downside scenarios and exit framework');
    if (wantsProp && !declinedProp) focus.push('Location, title and approval documentation first', 'Plot selection against declared preferences', 'Payment structure and site visit');
    if (concerns.includes('Fees')) focus.push('Transparent fee schedule');
    if (!focus.length) focus.push('Client-declared objectives and what is missing to establish suitability');
  }
  const lead = mode === 'FIRST_TIME_DISCOVERY' ? 'Do not pitch. Run a discovery conversation to establish objectives, horizon, liquidity, experience and suitability before any product is discussed.' : dataDriven ? 'Lead with evidence, numbers and documented outcomes. The client has historically requested documentation and compared alternatives before deciding.' : 'Lead with the client\'s declared objectives and current allocation; keep the first conversation short and confirm what matters before any product detail.';
  const meetingStyle = dataDriven ? ['Structured', 'Data-driven', 'Concise', 'Evidence-rich'] : ['Structured', 'Objective-led', 'Concise'];
  const opening = mode === 'FIRST_TIME_DISCOVERY' ? 'Ask about the client\'s priorities over the next three to five years and how they currently hold their wealth.' : wantsProp && !wantsAif ? 'Discuss the client\'s existing property holdings and what a further purchase should achieve (use, income or long-term holding).' : reShare >= 50 ? 'Discuss the client\'s existing portfolio allocation and ask whether current investments are meeting liquidity and diversification requirements.' : 'Review what has changed since the last interaction and confirm the client\'s current objectives.';
  const questions = mode === 'FIRST_TIME_DISCOVERY' ? ['What are your priorities over the next three to five years?', 'How much liquidity do you want to maintain?', 'What investments and property do you hold today, broadly?', 'Are you looking primarily for growth, income or capital preservation?', 'How do you usually make investment decisions, and who is involved?', 'What size of investment are you considering?'] : [...(reShare >= 50 ? ['Are there areas of your portfolio you feel are overly concentrated?'] : []), 'How much liquidity do you want to maintain over the next few years?', ...(wantsAif ? ['Would you like to explore how a professionally managed alternative investment could complement the rest of your portfolio?', 'What reporting and governance would you expect from a fund manager?'] : []), ...(wantsProp ? ['Is this purchase for your own use, investment, or both?', 'Which locations and plot sizes are you considering, and is an approved layout essential?', 'How would you fund a purchase - cash, loan or a mix?'] : []), ...(analysis.missing.includes('source of funds / wealth declaration') ? ['Could you walk us through the source of funds you would use?'] : [])];
  const evidenceToBring = [...(wantsAif ? ['Client\'s current allocation chart (from verified data)', 'Fund fact sheet, fee schedule and risk disclosures', 'Liquidity/lock-in comparison against declared horizon'] : []), ...(wantsProp ? ['Master layout and approval documents', 'Encumbrance certificate and title-chain summary', 'Due-diligence scorecard', 'Price comparison with guideline value and comparables', 'Available plot map'] : []), 'Verification & reliability profile', 'List of missing information to close suitability'];
  const nextStepObjective = mode === 'FIRST_TIME_DISCOVERY' ? 'Complete the suitability questionnaire and record declared objectives.' : wantsProp && property.siteVisitAdvised ? 'Agree a site visit for the best-matching project and plots.' : wantsAif ? 'Secure permission to prepare a personalised diversification proposal after the suitability questionnaire.' : 'Agree the next concrete action and the information the client will supply.';

  const nba = (() => {
    if (contactPressure.doNotContact) return { action: 'No action - do-not-contact instruction', reason: 'Client has opted out of contact.', confidence: 'HIGH' as const, evidence: ['contact_controls.do_not_contact'] };
    if (contactPressure.warning) return { action: 'Pause outreach for a week', reason: contactPressure.warning, confidence: 'HIGH' as const, evidence: [`${contacts7d} outbound contacts in 7 days`] };
    if (mode === 'FIRST_TIME_DISCOVERY') return { action: 'Schedule a discovery conversation', reason: 'No interaction history or declared preferences; personalisation would be guesswork.', confidence: 'HIGH' as const, evidence: ['0 interactions', 'no investor profile', 'no property requirements'] };
    if (fu) return { action: `Call client on requested follow-up date ${fu.follow_up_at!.slice(0, 10)}`, reason: 'Client asked for a follow-up.', confidence: 'HIGH' as const, evidence: [`Interaction ${fu.occurred_at.slice(0, 10)}: ${fu.summary.slice(0, 80)}`] };
    if (wantsProp && property.siteVisitAdvised && (opts.siteVisits ?? 0) === 0) return { action: 'Propose a site visit to the best-matching project', reason: 'Declared property requirements and demonstrated interest; no visit yet.', confidence: 'MEDIUM' as const, evidence: pEv };
    if (wantsAif && aif.relevance === 'HIGH' && aifMissing.includes('suitability questionnaire')) return { action: 'Request risk-profile / suitability questionnaire', reason: 'AIF relevance is high but suitability is not established; no recommendation may be made before it.', confidence: 'HIGH' as const, evidence: aifEv };
    if (reShare >= 60 && analysis.priorities.some((p) => p.label === 'Diversification')) return { action: 'Schedule portfolio diversification review', reason: `Real estate represents ${reShare}% of known assets and the client previously raised diversification.`, confidence: 'HIGH' as const, evidence: [`Real estate ${reShare}%`, ...analysis.priorities.filter((p) => p.label === 'Diversification').flatMap((p) => p.evidence)] };
    if (analysis.missing.includes('source of funds / wealth declaration')) return { action: 'Request source-of-funds documentation', reason: 'Required for any AIF or high-value property transaction.', confidence: 'MEDIUM' as const, evidence: ['fund_sources empty'] };
    if (ctx.verified.freshness === 'STALE') return { action: 'Re-verify financial information', reason: 'Verification data is stale.', confidence: 'HIGH' as const, evidence: ['freshness STALE'] };
    return { action: 'Send a short portfolio review and ask for current priorities', reason: 'Maintain relationship with a low-pressure, evidence-based touchpoint.', confidence: 'LOW' as const, evidence: [] };
  })();

  const nextConversation = { objective: reShare >= 50 && wantsAif ? 'Understand whether the client wants to reduce property concentration.' : wantsProp ? 'Confirm purpose, budget and location to shortlist plots.' : 'Confirm current objectives and what information is still missing.', startWith: reShare >= 50 ? 'Current portfolio composition.' : 'What has changed since the last conversation.', ask: questions[0] ?? 'What matters most to you over the next few years?', show: wantsProp ? 'Master layout, approval documents and the plot map.' : 'Asset allocation report from verified data.', avoid: 'Opening with a specific product before establishing suitability.', goal: nextStepObjective };

  const level: ApproachStrategy['relationshipEngagement']['level'] = !ix.length ? 'NEW' : (now.getTime() - new Date(ix[0].occurred_at).getTime()) / 86_400_000 <= 30 && ix.length >= 3 ? 'ACTIVE' : (now.getTime() - new Date(ix[0].occurred_at).getTime()) / 86_400_000 <= 120 ? 'MODERATE' : 'DORMANT';
  const pending = ix.filter((i) => i.outcome === 'PENDING').length;
  const relationshipEngagement = { level, basis: [`${ix.length} interaction(s)`, ix.length ? `last contact ${ix[0].occurred_at.slice(0, 10)}` : 'no contact yet', `${pending} pending response(s)`, `${ix.filter((i) => i.outcome === 'DECLINED').length} decline(s)`] };
  const motivations: ApproachStrategy['motivations'] = [...analysis.priorities.map((p) => ({ label: p.label, kind: p.kind, evidence: p.evidence.join('; ') }))];

  const engagementScore = Math.min(100, ix.length * 8 + (level === 'ACTIVE' ? 30 : level === 'MODERATE' ? 15 : 0) + (ctx.investorProfile ? 10 : 0) + (pp ? 10 : 0) + ((opts.siteVisits ?? 0) ? 15 : 0) + (rt.length && eng.responsiveness?.startsWith('Responds within a day') ? 10 : 0));
  const dataGaps = [...new Set([...aifMissing, ...pMissing, ...analysis.missing])];
  const whyThisApproach = [lead, ...aifReasons.slice(0, 2), ...pReasons.slice(0, 2), ...(concerns.length ? [`Client concerns on record: ${concerns.join(', ')}.`] : []), `Approach confidence ${approachConfidence.toLowerCase()}: ${confidenceBasis.join('; ')}.`];

  return {
    engineVersion: APPROACH_ENGINE_VERSION,
    computedAt: now.toISOString(),
    objective,
    mode,
    playbook,
    approachConfidence,
    confidenceBasis,
    aif,
    property,
    landowner,
    matrix,
    products,
    opportunities,
    concentrationWarnings,
    capitalAllocation,
    summary: { lead, focus, avoid, meetingStyle, nextStep: nextStepObjective },
    firstConversation: { opening, topics: focus, questions, evidenceToBring, avoid, likelyObjections, nextStepObjective },
    channel: { recommended: eng.channel ?? 'Discovery call, then confirm preference', format: eng.format ?? 'One-page summary', depth: eng.depth ?? 'Executive summary until preferences are known', reason: eng.basis.join(' ') || 'No interaction history; ask the client how they prefer to receive information.' },
    motivations,
    concerns,
    timing,
    nextBestAction: nba,
    nextConversation,
    contactPressure,
    interestMemory: { interested, notInterested, unknown: ['INSURANCE', 'ESTATE_PLANNING', 'RETIREMENT', 'AIF', 'REAL_ESTATE', 'FIXED_INCOME'].filter((k) => !ctx.interests.some((i) => i.category === k)) },
    relationshipEngagement,
    scores: { aif: aifEnough || declaredAifInterest ? Math.min(100, aifScore) : null, property: pEnough ? Math.min(100, pScore) : null, engagement: engagementScore },
    dataGaps,
    whyThisApproach,
  };
}

/** Meeting briefs at three depths, built from the analysis + strategy. */
export function buildBriefs(ctx: ClientIntelligenceContext, a: ClientAnalysis, s: ApproachStrategy) {
  const nw = a.wealth.personal.netWorth.range ? `net worth INR ${cr(a.wealth.personal.netWorth.range.low)}-${cr(a.wealth.personal.netWorth.range.high)} (${a.wealth.personal.netWorth.confidence.toLowerCase()})` : 'net worth not estimable';
  const thirty = [`${ctx.displayName}: ${ctx.verified.employerName ? `${ctx.verified.employerName}, ` : ''}${ctx.verified.creditScore ? `credit ${ctx.verified.creditScore}, ` : ''}${nw}.`, `AIF ${s.aif.relevance}, property ${s.property.relevance}. Next: ${s.nextBestAction.action}.`, s.contactPressure.warning ?? (s.concerns.length ? `Concerns: ${s.concerns.join(', ')}.` : 'No recorded concerns.')];
  const twoMin = [...thirty, `Financial health ${a.financialHealth.result.value}; ${a.saving.result.value}; ${a.investmentBehavior.result.value.join(', ')}.`, a.wealth.personal.composition.length ? `Allocation: ${a.wealth.personal.composition.map((c) => `${c.label} ${c.pct}%`).join(', ')}.` : 'No valued assets on record.', `Declared: ${ctx.investorProfile ? `${ctx.investorProfile.objectives.join(', ') || 'no objectives'}; horizon ${ctx.investorProfile.horizon ?? 'n/a'}; risk ${ctx.investorProfile.riskTolerance ?? 'n/a'}` : 'no investor profile'}${ctx.propertyPreferences ? `; property: ${ctx.propertyPreferences.purpose ?? 'purpose n/a'}, ${ctx.propertyPreferences.cities.join('/') || 'location n/a'}, budget ${ctx.propertyPreferences.budget_max ? cr(ctx.propertyPreferences.budget_max) : 'n/a'}` : ''}.`, `Opportunities: ${s.opportunities.map((o) => `${o.label} (${o.classification.replace(/_/g, ' ').toLowerCase()})`).join('; ') || 'none identified'}.`, `Open: ${a.risksRequiringReview.length} risk item(s); missing ${a.missing.slice(0, 4).join(', ') || 'nothing material'}.`, `Approach: ${s.summary.lead}`];
  const full = { who: thirty[0], relationship: s.relationshipEngagement, financialPosition: a.wealth.personal.netWorth.statement, businessInterests: ctx.assets.filter((x) => x.category === 'BUSINESS_INTEREST').map((x) => `${x.title} (${x.evidence_class.replace(/_/g, ' ').toLowerCase()})`), investments: ctx.assets.filter((x) => ['MUTUAL_FUND', 'SECURITY', 'FINANCIAL_INVESTMENT', 'DEPOSIT'].includes(x.category)).map((x) => `${x.title} - ${x.value_mid ? cr(x.value_mid) : 'n/a'} (${x.evidence_class.replace(/_/g, ' ').toLowerCase()})`), riskProfile: a.riskPreference.result.value, opportunities: s.opportunities, previousDiscussions: ctx.interactions.slice(0, 8).map((i) => `${i.occurred_at.slice(0, 10)} ${i.channel}: ${i.summary}`), objections: [...new Set(ctx.interactions.flatMap((i) => i.objections))], pendingActions: [...ctx.interactions.flatMap((i) => i.commitments)], recommendedApproach: s.summary, meetingObjective: s.firstConversation.nextStepObjective, questions: s.firstConversation.questions, evidenceToBring: s.firstConversation.evidenceToBring, dataGaps: s.dataGaps };
  const aifBrief = { snapshot: thirty[0], knownPortfolio: a.wealth.personal.composition, liquidity: a.wealth.personal.liquidNetWorth.statement, propertyExposure: `${a.wealth.personal.composition.find((c) => c.key === 'REAL_ESTATE')?.pct ?? 0}% of known assets`, experience: a.investmentExperience.result.value, declaredObjectives: ctx.investorProfile?.objectives ?? [], riskProfileStatus: a.riskPreference.result.value, existingAifPms: ctx.assets.filter((x) => /AIF|PMS/i.test(`${x.subtype} ${x.title}`)).map((x) => x.title), portfolioGap: s.aif.portfolioGap, suitabilityRequired: s.aif.missing, questions: s.firstConversation.questions.filter((q) => /portfolio|liquidity|managed|reporting|source of funds|concentrated/i.test(q)), fundsRelevant: s.aif.fundsRelevant, risksToExplain: ['Lock-in and illiquidity', 'Capital at risk / no guaranteed returns', 'Fees and performance fees', 'Valuation of unlisted holdings', 'Concentration and manager risk'], documents: ['PPM / fund documents', 'Fee schedule', 'Risk disclosures', 'Suitability questionnaire', 'Source-of-funds declaration'], nextStep: s.nextBestAction };
  const propertyBrief = { buyerType: `${s.property.buyerType} - ${s.property.buyerTypeBasis}`, budget: ctx.propertyPreferences?.budget_max ? `${ctx.propertyPreferences.budget_min ? cr(ctx.propertyPreferences.budget_min) + ' - ' : ''}${cr(ctx.propertyPreferences.budget_max)}` : 'Not declared', locations: ctx.propertyPreferences?.cities ?? [], holdings: ctx.assets.filter((x) => x.category === 'REAL_ESTATE').map((x) => `${x.title} (${x.evidence_class.replace(/_/g, ' ').toLowerCase()})`), previousEnquiries: ctx.interactions.filter((i) => /plot|land|layout|property/i.test(i.summary)).map((i) => `${i.occurred_at.slice(0, 10)}: ${i.summary}`), preferences: s.property.preferenceSummary, behaviour: s.property.behaviourLabels, documentsToShow: ['Master layout', 'Approval documents', 'EC and title summary', 'Plot map with availability', 'Price comparison'], questions: s.firstConversation.questions.filter((q) => /use|location|fund|plot|approved/i.test(q)), siteVisitAdvised: s.property.siteVisitAdvised, nextStep: s.nextBestAction };
  return { thirtySecond: thirty, twoMinute: twoMin, full, aifBrief, propertyBrief };
}

export const DARK_PATTERN_RE = /(last chance|only \d+ left|act now|limited time|hurry|don't miss|guaranteed return|assured return|risk-?free|double your money|before it's too late)/i;
export function assertNoDarkPatterns(text: string): string[] {
  const hits = text.match(new RegExp(DARK_PATTERN_RE.source, 'gi')) ?? [];
  return [...new Set(hits.map((h) => h.toLowerCase()))];
}
export type { Confidence };
export const _h = HIGH;
