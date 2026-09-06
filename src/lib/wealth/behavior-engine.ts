/**
 * ANALYZE CLIENT engine.
 * Behaviour is analysed from financial behaviour, finances from financial data, identity from reliable evidence.
 * Human input never influences any conclusion here; it is listed separately as unverified context.
 * Every conclusion carries: evidence class, confidence, basis, evidence, and what is missing.
 */
import { computeWealth, cr, type WealthSummary } from './wealth-engine';
import type { CashFlowRow, ClientIntelligenceContext, Confidence, Evidenced, InteractionRow } from './types';

export const ANALYSIS_ENGINE_VERSION = 'analyze-1.0.0';

export interface AnalysisSection<T = string> {
  key: string;
  label: string;
  result: Evidenced<T>;
  detail?: string;
}

export interface ClientAnalysis {
  engineVersion: string;
  computedAt: string;
  inputs: { verifiedSources: number; declaredSources: number; authorizedDataSets: number; humanContextItems: number; humanInfluenceOnFinancialProfile: 'NONE'; cashFlowMonths: number; interactions: number };
  wealth: WealthSummary;
  financialHealth: AnalysisSection;
  income: AnalysisSection;
  spending: AnalysisSection & { monthly: Array<{ period: string; inflows: number; outflows: number; essential: number; discretionary: number; investments: number; debt: number }>; categories: Array<{ key: string; total: number; pct: number }> };
  saving: AnalysisSection;
  investmentBehavior: AnalysisSection<string[]>;
  investmentExperience: AnalysisSection;
  riskPreference: AnalysisSection;
  resilience: AnalysisSection;
  liquidity: AnalysisSection & { runwayMonths: [number, number] | null };
  debtBehavior: AnalysisSection;
  creditHealth: AnalysisSection;
  concentration: AnalysisSection<string[]>;
  decisionPatterns: Array<{ pattern: string; evidence: string[]; confidence: Confidence }>;
  persona: { label: string; why: string; evidence: string[]; confidence: Confidence; alternative: string } | null;
  priorities: Array<{ label: string; kind: 'OBSERVED' | 'CLIENT_DECLARED'; evidence: string[] }>;
  interestMap: Array<{ category: string; stance: string; basis: string }>;
  engagement: { channel: string | null; format: string | null; depth: string | null; responsiveness: string | null; basis: string[]; decisionJourney: string[] };
  reliability: { components: Array<{ label: string; level: string; basis: string }>; verificationConfidence: number | null; statement: string };
  humanContext: { items: Array<{ id: string; sourceType: string; category: string; summary: string; status: string; verifiable: boolean }>; statement: string };
  risksRequiringReview: string[];
  missing: string[];
  significantEvents: Array<{ date: string; title: string; amount: number | null; evidenceClass: string }>;
  narrative: Array<{ text: string; evidence: string[] }>;
}

const conf = (v: Confidence): Confidence => v;
const insufficient = <T,>(value: T, missing: string[], basis = 'Required data is not available.'): Evidenced<T> => ({ value, confidence: 'INSUFFICIENT', basis, evidence: [], evidenceClass: 'INSUFFICIENT_DATA', missing });

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function analyzeCashFlow(cf: CashFlowRow[]) {
  const rows = [...cf].sort((a, b) => a.period.localeCompare(b.period));
  const months = rows.map((r) => ({ period: r.period, inflows: r.inflows ?? 0, outflows: r.outflows ?? 0, essential: r.essential_spend ?? 0, discretionary: r.discretionary_spend ?? 0, investments: r.investment_transfers ?? 0, debt: r.debt_payments ?? 0, salary: r.salary_credits ?? 0, other: r.other_income ?? 0 }));
  const n = months.length;
  const avg = (k: keyof (typeof months)[number]) => (n ? months.reduce((s, m) => s + (m[k] as number), 0) / n : 0);
  // `outflows` = total debits including investment transfers. Net saving = what was not consumed
  // (retained cash + investment transfers). A month "saves" when net saving is positive.
  const surplus = months.map((m) => m.inflows - m.outflows + m.investments);
  const positive = surplus.filter((s) => s > 0).length;
  const savingsRate = avg('inflows') ? (avg('inflows') - avg('outflows') + avg('investments')) / avg('inflows') : 0;
  const investRate = avg('inflows') ? avg('investments') / avg('inflows') : 0;
  const salaryCv = avg('salary') ? stdev(months.map((m) => m.salary)) / avg('salary') : null;
  const incomeCv = avg('inflows') ? stdev(months.map((m) => m.inflows)) / avg('inflows') : null;
  const half = Math.floor(n / 2);
  const discTrend = n >= 6 && half ? (months.slice(half).reduce((s, m) => s + m.discretionary, 0) / (n - half)) / Math.max(1, months.slice(0, half).reduce((s, m) => s + m.discretionary, 0) / half) - 1 : null;
  const cats = new Map<string, number>();
  for (const r of rows) for (const [k, v] of Object.entries(r.categories ?? {})) cats.set(k, (cats.get(k) ?? 0) + (v ?? 0));
  const catTotal = [...cats.values()].reduce((s, v) => s + v, 0);
  const categories = [...cats.entries()].map(([key, total]) => ({ key, total, pct: catTotal ? Math.round((total / catTotal) * 1000) / 10 : 0 })).sort((a, b) => b.total - a.total);
  return { months, n, avg, savingsRate, investRate, positive, salaryCv, incomeCv, discTrend, categories, largeInflows: rows.flatMap((r) => r.large_inflows ?? []), largeOutflows: rows.flatMap((r) => r.large_outflows ?? []) };
}

function engagementFrom(ix: InteractionRow[], contact: ClientIntelligenceContext['contact']) {
  const basis: string[] = [];
  if (!ix.length) return { channel: contact?.preferred_channel ?? null, format: contact?.preferred_format ?? null, depth: null, responsiveness: null, basis: contact?.preferred_channel ? ['Preferred channel recorded in contact controls.'] : [], decisionJourney: [] };
  const byChannel = new Map<string, number>();
  for (const i of ix) byChannel.set(i.channel, (byChannel.get(i.channel) ?? 0) + 1);
  const progressed = ix.filter((i) => i.outcome === 'PROGRESSED' || i.outcome === 'CONVERTED');
  const progChannel = new Map<string, number>();
  for (const i of progressed) progChannel.set(i.channel, (progChannel.get(i.channel) ?? 0) + 1);
  const topProg = [...progChannel.entries()].sort((a, b) => b[1] - a[1])[0];
  const top = [...byChannel.entries()].sort((a, b) => b[1] - a[1])[0];
  const channel = contact?.preferred_channel ?? topProg?.[0] ?? top?.[0] ?? null;
  basis.push(contact?.preferred_channel ? `Client-declared preferred channel: ${contact.preferred_channel}.` : topProg ? `${topProg[1]} of ${progressed.length} progressed interactions happened via ${topProg[0]}.` : `Most frequent channel: ${top?.[0]} (${top?.[1]} of ${ix.length}).`);
  const docReq = ix.filter((i) => /document|statement|factsheet|brochure|calculation|numbers|comparison|term sheet/i.test([i.summary, ...i.questions].join(' '))).length;
  const quant = ix.filter((i) => /return|yield|irr|fee|tax|calculation|price per|sq\.? ?ft|valuation|comparable/i.test([i.summary, ...i.questions].join(' '))).length;
  const depth = docReq / ix.length >= 0.4 || quant / ix.length >= 0.4 ? 'Document-heavy / highly quantitative' : quant / ix.length >= 0.2 ? 'Moderate detail with numbers' : 'Executive summary';
  basis.push(`${docReq} of ${ix.length} interactions involved document requests; ${quant} involved quantitative questions.`);
  const format = contact?.preferred_format ?? (depth.startsWith('Document') ? 'Detailed comparison table / proposal with supporting documents' : depth.startsWith('Moderate') ? 'One-page summary followed by a proposal' : 'Short briefing');
  const rt = ix.filter((i) => i.response_time_hours !== null).map((i) => i.response_time_hours as number);
  const responsiveness = rt.length ? (rt.reduce((s, x) => s + x, 0) / rt.length <= 24 ? 'Responds within a day' : rt.reduce((s, x) => s + x, 0) / rt.length <= 72 ? 'Responds within three days' : 'Slow to respond (more than three days)') : null;
  if (rt.length) basis.push(`Average recorded response time ${Math.round(rt.reduce((s, x) => s + x, 0) / rt.length)} hours over ${rt.length} interactions.`);
  const journey: string[] = ['Initial enquiry'];
  if (docReq) journey.push('Requests documentation');
  if (ix.some((i) => /compar|alternative|option/i.test(i.summary))) journey.push('Compares alternatives');
  if (ix.some((i) => /family|spouse|wife|husband|father|consult/i.test([i.summary, ...i.client_declared_changes].join(' ')))) journey.push('Consults family (client stated)');
  if (quant) journey.push('Requests return / risk calculations');
  if (ix.some((i) => i.kind === 'SITE_VISIT')) journey.push('Site visit');
  journey.push(progressed.length ? 'Makes decision' : 'Decision pending');
  return { channel, format, depth, responsiveness, basis, decisionJourney: journey };
}

export function analyzeClient(ctx: ClientIntelligenceContext): ClientAnalysis {
  const now = ctx.now;
  const wealth = computeWealth({ assets: ctx.assets, liabilities: ctx.liabilities, bureau: ctx.bureau, cashFlow: ctx.cashFlow, banks: ctx.banks, incomeAnnual: ctx.verified.incomeAnnual, incomeEvidence: ctx.verified.incomeEvidence, now });
  const cf = analyzeCashFlow(ctx.cashFlow);
  const v = ctx.verified;
  const reliableAssets = ctx.assets.filter((a) => a.status === 'ACTIVE' && ['VERIFIED', 'AUTHORIZED_THIRD_PARTY', 'OFFICIAL_PUBLIC_RECORD'].includes(a.evidence_class));

  /* ---- Financial health ---- */
  const fhParts: string[] = [];
  let fhScore = 0;
  let fhMax = 0;
  if (v.creditScore !== null) { fhMax += 3; fhScore += v.creditScore >= 750 ? 3 : v.creditScore >= 700 ? 2 : v.creditScore >= 650 ? 1 : 0; fhParts.push(`credit score ${v.creditScore}`); }
  if (v.employmentCurrent !== null) { fhMax += 2; fhScore += v.employmentCurrent ? (v.employmentTenureMonths && v.employmentTenureMonths >= 24 ? 2 : 1) : 0; fhParts.push(v.employmentCurrent ? `current employment ${v.employmentTenureMonths ?? '?'} months` : 'no current employment on record'); }
  if (wealth.debtService.emiToIncome.status !== 'NOT_AVAILABLE') { fhMax += 2; fhScore += wealth.debtService.emiToIncome.status === 'OK' ? 2 : wealth.debtService.emiToIncome.status === 'WATCH' ? 1 : 0; fhParts.push(`EMI/income ${wealth.debtService.emiToIncome.display}`); }
  if (cf.n >= 3) { fhMax += 2; fhScore += cf.savingsRate >= 0.2 ? 2 : cf.savingsRate > 0 ? 1 : 0; fhParts.push(`savings rate ${Math.round(cf.savingsRate * 100)}% over ${cf.n} months`); }
  if (wealth.personal.liquidNetWorth.range) { fhMax += 1; fhScore += wealth.personal.liquidNetWorth.range.mid > 0 ? 1 : 0; fhParts.push('positive liquid net worth'); }
  const fhLabel = fhMax === 0 ? 'Insufficient data' : fhScore / fhMax >= 0.75 ? 'Strong' : fhScore / fhMax >= 0.5 ? 'Adequate' : fhScore / fhMax >= 0.3 ? 'Under pressure' : 'Weak';
  const financialHealth: AnalysisSection = { key: 'financialHealth', label: 'Financial health', result: fhMax === 0 ? insufficient('Insufficient data', ['credit score', 'employment', 'obligations', 'cash flow']) : { value: fhLabel, confidence: fhMax >= 7 ? 'HIGH' : fhMax >= 4 ? 'MEDIUM' : 'LOW', basis: `Composite of ${fhParts.join('; ')} (${fhScore}/${fhMax} points).`, evidence: fhParts.map((p) => ({ label: p, source: 'VERIFIED/AA/CREDIT' })), evidenceClass: 'OBSERVED_PATTERN', missing: [...(v.creditScore === null ? ['credit score'] : []), ...(cf.n < 3 ? ['3+ months of consented cash flow'] : []), ...(wealth.debtService.emiToIncome.status === 'NOT_AVAILABLE' ? ['monthly obligations'] : [])] } };

  /* ---- Income ---- */
  const income: AnalysisSection = { key: 'income', label: 'Income stability', result: cf.n >= 3 ? { value: cf.salaryCv !== null && cf.salaryCv < 0.1 ? 'Stable salaried income' : cf.salaryCv !== null && cf.salaryCv < 0.3 ? 'Mostly stable income with some variation' : cf.incomeCv !== null && cf.incomeCv < 0.3 ? 'Moderately stable mixed income' : 'Variable income', confidence: cf.n >= 12 ? 'HIGH' : cf.n >= 6 ? 'MEDIUM' : 'LOW', basis: `Average monthly inflows INR ${cr(cf.avg('inflows'))}; salary credits INR ${cr(cf.avg('salary'))} with coefficient of variation ${cf.salaryCv === null ? 'n/a' : cf.salaryCv.toFixed(2)}; ${cf.avg('other') ? `other income INR ${cr(cf.avg('other'))}/month` : 'no other regular income identified'}. Not every credit is treated as income.`, evidence: [{ label: 'Cash-flow months', source: 'AA', value: String(cf.n) }, ...(v.incomeAnnual ? [{ label: 'Verified annual income', source: 'PAN', value: cr(v.incomeAnnual) }] : [])], evidenceClass: 'OBSERVED_PATTERN' } : v.incomeAnnual ? { value: `Verified annual income INR ${cr(v.incomeAnnual)}; stability not observable`, confidence: 'MEDIUM', basis: 'Income figure comes from the verification run; monthly consistency requires consented banking data.', evidence: [{ label: 'Income', source: 'PAN', value: cr(v.incomeAnnual) }], evidenceClass: 'VERIFIED', missing: ['consented bank cash flow'] } : insufficient('Insufficient data', ['verified income', 'consented bank cash flow']) };

  /* ---- Spending ---- */
  const spending: ClientAnalysis['spending'] = { key: 'spending', label: 'Spending pattern', monthly: cf.months.map(({ period, inflows, outflows, essential, discretionary, investments, debt }) => ({ period, inflows, outflows, essential, discretionary, investments, debt })), categories: cf.categories, result: cf.n >= 3 ? { value: `Average monthly spend INR ${cr(cf.avg('outflows'))} (essential INR ${cr(cf.avg('essential'))}, discretionary INR ${cr(cf.avg('discretionary'))})${cf.discTrend !== null ? `; discretionary expenditure ${cf.discTrend >= 0 ? 'increased' : 'decreased'} ${Math.abs(Math.round(cf.discTrend * 100))}% in the latter half of the period` : ''}.`, confidence: cf.n >= 12 ? 'HIGH' : 'MEDIUM', basis: 'Category totals from consented transaction categorisation. No moral or social classification is applied.', evidence: cf.categories.slice(0, 5).map((c) => ({ label: c.key, source: 'AA', value: `${c.pct}%` })), evidenceClass: 'OBSERVED_PATTERN' } : insufficient('Insufficient data', ['consented transaction data']) };

  /* ---- Saving ---- */
  const saving: AnalysisSection = { key: 'saving', label: 'Saving pattern', result: cf.n >= 3 ? { value: cf.positive / cf.n >= 0.8 && cf.savingsRate >= 0.15 ? 'Consistent saver' : cf.positive / cf.n >= 0.6 ? 'Generally positive surplus' : cf.positive / cf.n >= 0.4 ? 'Irregular surplus' : 'Frequent deficit months', confidence: cf.n >= 12 ? 'HIGH' : cf.n >= 6 ? 'MEDIUM' : 'LOW', basis: `Estimated savings rate ${Math.round(cf.savingsRate * 100)}% (retained cash plus investment transfers); investment rate ${Math.round(cf.investRate * 100)}%; net saving positive in ${cf.positive} of ${cf.n} months; average retained cash after all debits INR ${cr(cf.avg('inflows') - cf.avg('outflows'))} per month.`, evidence: [{ label: 'Positive months', source: 'AA', value: `${cf.positive}/${cf.n}` }, { label: 'Savings rate', source: 'AA', value: `${Math.round(cf.savingsRate * 100)}%` }], evidenceClass: 'OBSERVED_PATTERN' } : insufficient('Insufficient data', ['consented bank cash flow (3+ months)']) };

  /* ---- Investment behaviour ---- */
  const invAssets = reliableAssets.filter((a) => ['MUTUAL_FUND', 'SECURITY', 'FINANCIAL_INVESTMENT', 'DEPOSIT'].includes(a.category));
  const declaredInv = ctx.assets.filter((a) => a.status === 'ACTIVE' && ['MUTUAL_FUND', 'SECURITY', 'FINANCIAL_INVESTMENT', 'DEPOSIT'].includes(a.category) && a.evidence_class === 'CLIENT_DECLARED');
  const labels: string[] = [];
  const invEv: Evidenced<string[]>['evidence'] = [];
  const sipMonths = cf.months.filter((m) => m.investments > 0).length;
  if (cf.n >= 6 && sipMonths / cf.n >= 0.8) { labels.push('Systematic investor'); invEv.push({ label: 'Months with investment transfers', source: 'AA', value: `${sipMonths}/${cf.n}` }); }
  const mfCount = invAssets.filter((a) => a.category === 'MUTUAL_FUND').length;
  const eqCount = invAssets.filter((a) => a.category === 'SECURITY').length;
  const comp = wealth.personal.composition;
  const reShare = comp.find((c) => c.key === 'REAL_ESTATE')?.pct ?? 0;
  const bizShare = comp.find((c) => c.key === 'BUSINESS_INTEREST')?.pct ?? 0;
  const finShare = comp.filter((c) => ['MUTUAL_FUND', 'SECURITY', 'FINANCIAL_INVESTMENT'].includes(c.key)).reduce((s, c) => s + c.pct, 0);
  const cashShare = comp.filter((c) => ['CASH', 'DEPOSIT'].includes(c.key)).reduce((s, c) => s + c.pct, 0);
  if (reShare >= 50) { labels.push('Real-estate-heavy investor'); invEv.push({ label: 'Real estate share of known assets', source: 'ASSETS', value: `${reShare}%` }); }
  if (bizShare >= 40) { labels.push('Business-heavy wealth'); invEv.push({ label: 'Business interests share', source: 'ASSETS', value: `${bizShare}%` }); }
  if (cashShare >= 30) { labels.push('High cash allocation'); invEv.push({ label: 'Cash & deposits share', source: 'ASSETS', value: `${cashShare}%` }); }
  if (mfCount + eqCount >= 6) { labels.push('Diversified investor'); invEv.push({ label: 'Distinct funds/securities', source: 'STATEMENTS', value: String(mfCount + eqCount) }); }
  else if (mfCount + eqCount > 0 && mfCount + eqCount <= 2 && finShare >= 20) { labels.push('Concentrated investor'); invEv.push({ label: 'Distinct funds/securities', source: 'STATEMENTS', value: String(mfCount + eqCount) }); }
  const holding = invAssets.filter((a) => a.acquired_on).map((a) => (now.getTime() - new Date(a.acquired_on!).getTime()) / (365.25 * 86_400_000));
  if (holding.length && holding.reduce((s, x) => s + x, 0) / holding.length >= 3) { labels.push('Long-term investor'); invEv.push({ label: 'Average holding period', source: 'STATEMENTS', value: `${(holding.reduce((s, x) => s + x, 0) / holding.length).toFixed(1)} yrs` }); }
  const altCount = invAssets.filter((a) => /AIF|PMS|PRIVATE|ANGEL|VENTURE|STRUCTURED/i.test(`${a.subtype} ${a.title}`)).length;
  if (altCount) { labels.push('Alternative-investment exposure'); invEv.push({ label: 'Alternative holdings', source: 'STATEMENTS', value: String(altCount) }); }
  const investmentBehavior: AnalysisSection<string[]> = { key: 'investmentBehavior', label: 'Investment behaviour', result: invAssets.length || cf.n >= 6 ? { value: labels.length ? labels : ['No distinct pattern identified'], confidence: invAssets.length >= 3 && cf.n >= 6 ? 'HIGH' : invAssets.length || cf.n >= 6 ? 'MEDIUM' : 'LOW', basis: `Classified from ${invAssets.length} verified holding(s) and ${cf.n} month(s) of cash flow. ${declaredInv.length ? `${declaredInv.length} declared-only holding(s) excluded from the classification.` : ''}`.trim(), evidence: invEv, evidenceClass: 'OBSERVED_PATTERN' } : insufficient(['Insufficient data'], ['verified holdings or 6+ months of cash flow']) };

  /* ---- Experience ---- */
  const classes = new Set(invAssets.map((a) => a.subtype ?? a.category));
  const years = holding.length ? Math.max(...holding) : null;
  const intl = invAssets.some((a) => /INTERNATIONAL|US |GLOBAL/i.test(`${a.subtype} ${a.title}`));
  const expLevel = !invAssets.length && !ctx.investorProfile?.experience ? null : classes.size >= 4 && (years ?? 0) >= 5 ? 'Advanced' : classes.size >= 2 && (years ?? 0) >= 2 ? 'Intermediate' : invAssets.length ? 'Basic' : 'Declared only';
  const investmentExperience: AnalysisSection = { key: 'investmentExperience', label: 'Investment experience', result: expLevel ? { value: expLevel, confidence: invAssets.length ? (classes.size >= 3 ? 'HIGH' : 'MEDIUM') : 'LOW', basis: invAssets.length ? `Verified portfolio spans ${classes.size} asset class(es)${years ? ` over about ${Math.round(years)} year(s)` : ''}${altCount ? ', including alternatives' : ''}${intl ? ' and international holdings' : ''}.` : `Client-declared experience: ${ctx.investorProfile?.experience}. No verified holdings to corroborate.`, evidence: [...[...classes].map((c) => ({ label: String(c), source: 'STATEMENTS' })), ...(ctx.investorProfile?.experience ? [{ label: 'Declared experience', source: 'CLIENT', value: ctx.investorProfile.experience }] : [])], evidenceClass: invAssets.length ? 'OBSERVED_PATTERN' : 'CLIENT_DECLARED' } : insufficient('Insufficient data', ['verified holdings', 'suitability questionnaire']) };

  /* ---- Risk preference: declared / mandate / portfolio only ---- */
  const declaredRisk = ctx.aifSuitability?.risk_profile ?? ctx.investorProfile?.riskTolerance ?? null;
  const portfolioBasis = finShare + reShare + bizShare > 0 ? `Portfolio composition: ${reShare}% real estate, ${finShare}% financial, ${cashShare}% cash/deposits, ${bizShare}% business.` : null;
  const riskPreference: AnalysisSection = { key: 'riskPreference', label: 'Risk preference', result: declaredRisk ? { value: declaredRisk, confidence: ctx.aifSuitability?.risk_profile ? 'HIGH' : ctx.investorProfile?.confirmed ? 'HIGH' : 'MEDIUM', basis: `Basis of classification: ${ctx.aifSuitability?.risk_profile_basis ?? (ctx.aifSuitability?.risk_profile ? 'suitability questionnaire' : 'client declaration in investor profile')}.${portfolioBasis ? ` ${portfolioBasis}` : ''} Never inferred from age, occupation, appearance or social content.`, evidence: [{ label: 'Declared risk tolerance', source: 'CLIENT', value: declaredRisk }], evidenceClass: 'CLIENT_DECLARED' } : insufficient('Not assessed - questionnaire required', ['suitability questionnaire or explicit client declaration'], portfolioBasis ? `${portfolioBasis} Composition alone is not used to assign a risk tolerance.` : 'No declaration or questionnaire on file.') };

  /* ---- Resilience ---- */
  const resFactors: Array<{ label: string; ok: boolean | null }> = [
    { label: 'Stable income', ok: cf.n >= 3 ? (cf.salaryCv !== null ? cf.salaryCv < 0.3 : null) : v.employmentCurrent },
    { label: 'Multiple income sources', ok: cf.n >= 3 ? cf.avg('other') > 0.1 * cf.avg('inflows') : null },
    { label: 'Liquid reserves', ok: wealth.personal.liquidNetWorth.range ? wealth.personal.liquidNetWorth.range.mid > 0 : null },
    { label: 'Debt burden manageable', ok: wealth.debtService.emiToIncome.status === 'NOT_AVAILABLE' ? null : wealth.debtService.emiToIncome.status === 'OK' },
    { label: 'Insurance cover recorded', ok: ctx.assets.some((a) => a.category === 'INSURANCE' && a.status === 'ACTIVE') ? true : null },
    { label: 'Employment stability', ok: v.employmentCurrent === null ? null : v.employmentCurrent && (v.employmentTenureMonths ?? 0) >= 24 },
  ];
  const known = resFactors.filter((f) => f.ok !== null);
  const okCount = known.filter((f) => f.ok).length;
  const resilience: AnalysisSection = { key: 'resilience', label: 'Financial resilience', result: known.length >= 3 ? { value: okCount / known.length >= 0.75 ? 'Strong' : okCount / known.length >= 0.5 ? 'Moderate' : 'Limited', confidence: known.length >= 5 ? 'HIGH' : 'MEDIUM', basis: `${okCount} of ${known.length} assessable factors favourable: ${known.map((f) => `${f.label}: ${f.ok ? 'yes' : 'no'}`).join('; ')}.`, evidence: known.map((f) => ({ label: f.label, source: 'DERIVED', value: f.ok ? 'favourable' : 'unfavourable' })), evidenceClass: 'OBSERVED_PATTERN', missing: resFactors.filter((f) => f.ok === null).map((f) => f.label) } : insufficient('Insufficient data', resFactors.filter((f) => f.ok === null).map((f) => f.label)) };

  /* ---- Liquidity runway ---- */
  const liquidMid = wealth.personal.liquidNetWorth.range?.mid ?? null;
  const monthlyOut = cf.n >= 3 ? cf.avg('outflows') : wealth.personal.monthlyObligations.value;
  const runway: [number, number] | null = liquidMid !== null && monthlyOut && monthlyOut > 0 ? [Math.floor((wealth.personal.liquidNetWorth.range!.low) / monthlyOut), Math.floor((wealth.personal.liquidNetWorth.range!.high) / monthlyOut)] : null;
  const liquidity: ClientAnalysis['liquidity'] = { key: 'liquidity', label: 'Liquidity', runwayMonths: runway, result: runway ? { value: `Estimated liquid runway ${runway[0] === runway[1] ? `about ${runway[0]}` : `${runway[0]}-${runway[1]}`} months`, confidence: cf.n >= 6 ? wealth.personal.liquidNetWorth.confidence : 'LOW', basis: `Liquid net worth ${wealth.personal.liquidNetWorth.range ? `INR ${cr(wealth.personal.liquidNetWorth.range.low)} - ${cr(wealth.personal.liquidNetWorth.range.high)}` : ''} divided by ${cf.n >= 3 ? `average monthly outflows INR ${cr(monthlyOut!)}` : `known monthly obligations INR ${cr(monthlyOut!)} (spending not observed)`}. Assumes no further income.`, evidence: [{ label: 'Liquid net worth (mid)', source: 'ASSETS', value: cr(liquidMid!) }, { label: 'Monthly outflows', source: cf.n >= 3 ? 'AA' : 'LIABILITIES', value: cr(monthlyOut!) }], evidenceClass: 'DERIVED_ESTIMATE' } : insufficient('Insufficient data', ['liquid asset balances', 'monthly outflows or obligations']) };

  /* ---- Debt behaviour & credit health ---- */
  const ds = wealth.debtService;
  const debtBehavior: AnalysisSection = { key: 'debtBehavior', label: 'Debt behaviour', result: ds.available ? { value: [ds.paymentStress.status === 'OK' && ds.paymentStress.value !== null ? 'Consistent repayment' : ds.paymentStress.status !== 'NOT_AVAILABLE' ? 'Repayment irregularities reported' : null, ds.utilization.status === 'ELEVATED' ? 'High revolving utilisation' : ds.utilization.status === 'OK' && ds.utilization.value !== null ? 'Low revolving utilisation' : null, ds.recentBorrowing.status !== 'OK' && ds.recentBorrowing.status !== 'NOT_AVAILABLE' ? 'Active recent borrowing' : null, ctx.liabilities.some((l) => l.status === 'CLOSED' && l.maturity_on && l.opened_on && new Date(l.maturity_on) > now) ? 'Early loan closure observed' : null].filter(Boolean).join('; ') || 'No notable debt pattern', confidence: ctx.bureau ? 'HIGH' : 'MEDIUM', basis: [ds.paymentStress.basis, ds.utilization.basis, ds.recentBorrowing.basis].filter((b) => !b.startsWith('Required')).join(' '), evidence: [{ label: 'DTI', source: 'DERIVED', value: ds.dti.display }, { label: 'EMI/income', source: 'DERIVED', value: ds.emiToIncome.display }, { label: 'Utilisation', source: 'CREDIT', value: ds.utilization.display }, { label: 'Payment stress', source: 'CREDIT', value: ds.paymentStress.display }], evidenceClass: 'OBSERVED_PATTERN' } : insufficient('Insufficient data', ['bureau report', 'liability register with balances']) };
  const b = ctx.bureau;
  const creditHealth: AnalysisSection = { key: 'creditHealth', label: 'Credit health', result: b ? { value: `${b.bureau} ${b.score ?? 'n/a'}; ${b.active_accounts ?? '?'} active / ${b.total_accounts ?? '?'} total accounts; utilisation ${b.utilization !== null ? Math.round(b.utilization * 100) + '%' : 'n/a'}; ${b.dpd_90_count ? `${b.dpd_90_count} x 90+ DPD` : 'no 90+ DPD'}; ${b.enquiries_12m ?? 0} enquiries in 12 months`, confidence: 'HIGH', basis: `Bureau report dated ${b.report_date ?? 'unknown'} with ${b.accounts.length} account(s); credit age ${b.credit_age_months ?? '?'} months. Not reduced to a single score.`, evidence: [{ label: 'Report', source: b.bureau, value: b.report_date }], evidenceClass: 'AUTHORIZED_THIRD_PARTY' } : v.creditScore !== null ? { value: `Score ${v.creditScore} only; no account-level report`, confidence: 'MEDIUM', basis: 'Score from the verification run; obligations, utilisation and repayment history require a bureau report.', evidence: [{ label: 'Score', source: 'CREDIT', value: String(v.creditScore) }], evidenceClass: 'AUTHORIZED_THIRD_PARTY', missing: ['bureau report'] } : insufficient('Insufficient data', ['credit score', 'bureau report']) };

  /* ---- Concentration ---- */
  const concList: string[] = [];
  if (reShare >= 60) concList.push(`Real estate ${reShare}% of known assets`);
  const cities = new Map<string, number>();
  for (const a of ctx.assets.filter((a) => a.category === 'REAL_ESTATE' && a.status === 'ACTIVE')) { const c = String((a.details as { city?: string }).city ?? 'unknown'); cities.set(c, (cities.get(c) ?? 0) + (a.value_mid ?? 0)); }
  const reTotal = [...cities.values()].reduce((s, x) => s + x, 0);
  for (const [c, val] of cities) if (reTotal && val / reTotal >= 0.7 && cities.size >= 1 && reTotal > 0) concList.push(`Property concentrated in ${c} (${Math.round((val / reTotal) * 100)}% of property value)`);
  if (bizShare >= 40) concList.push(`Private business interests ${bizShare}% of known assets`);
  if (ds.concentration.status === 'WATCH') concList.push(`Debt concentration: ${ds.concentration.display}`);
  const illiquidShare = comp.filter((c) => ['REAL_ESTATE', 'BUSINESS_INTEREST', 'LUXURY'].includes(c.key)).reduce((s, c) => s + c.pct, 0);
  if (illiquidShare >= 70) concList.push(`Illiquid assets ${illiquidShare}% of known assets`);
  const concentration: AnalysisSection<string[]> = { key: 'concentration', label: 'Concentration risks', result: comp.length ? { value: concList.length ? concList : ['No material concentration identified'], confidence: wealth.personal.verifiedValueShare >= 0.5 ? 'HIGH' : 'MEDIUM', basis: 'Shares computed from valued personal assets (family-linked excluded).', evidence: comp.map((c) => ({ label: c.label, source: 'ASSETS', value: `${c.pct}%` })), evidenceClass: 'OBSERVED_PATTERN' } : insufficient(['Insufficient data'], ['valued assets']) };

  /* ---- Decision patterns ---- */
  const decisionPatterns: ClientAnalysis['decisionPatterns'] = [];
  if (cf.n >= 6 && sipMonths / cf.n >= 0.8) decisionPatterns.push({ pattern: 'Regular systematic investing', evidence: [`Investment transfers in ${sipMonths} of ${cf.n} months`], confidence: 'HIGH' });
  if (ds.utilization.status === 'ELEVATED') decisionPatterns.push({ pattern: 'High revolving credit utilisation', evidence: [ds.utilization.basis], confidence: 'HIGH' });
  if (ds.paymentStress.status === 'OK' && ds.paymentStress.value !== null) decisionPatterns.push({ pattern: 'Consistent debt repayment', evidence: [ds.paymentStress.display], confidence: 'HIGH' });
  if (cashShare >= 30) decisionPatterns.push({ pattern: 'Large cash retention', evidence: [`Cash & deposits ${cashShare}% of known assets`], confidence: 'MEDIUM' });
  if (cf.largeOutflows.filter((o) => /redemption|withdraw/i.test(o.label)).length >= 3) decisionPatterns.push({ pattern: 'Frequent investment withdrawals', evidence: cf.largeOutflows.filter((o) => /redemption|withdraw/i.test(o.label)).map((o) => `${o.date}: ${o.label} INR ${cr(o.amount)}`), confidence: 'MEDIUM' });
  if (ctx.liabilities.filter((l) => l.status === 'CLOSED' && l.maturity_on && l.opened_on && new Date(l.maturity_on) > now).length) decisionPatterns.push({ pattern: 'Early loan prepayment', evidence: ctx.liabilities.filter((l) => l.status === 'CLOSED' && l.maturity_on && new Date(l.maturity_on) > now).map((l) => `${l.liability_type} closed before maturity ${l.maturity_on}`), confidence: 'MEDIUM' });

  /* ---- Persona (financial behaviour only) ---- */
  let persona: ClientAnalysis['persona'] = null;
  if (labels.length || reShare >= 50) {
    if (reShare >= 50) persona = { label: 'Property-Led Wealth Holder', why: 'Majority of known assets are direct real estate.', evidence: [`Real estate ${reShare}% of known assets`], confidence: wealth.personal.verifiedValueShare >= 0.5 ? 'HIGH' : 'MEDIUM', alternative: labels.includes('Systematic investor') ? 'Systematic Accumulator' : 'Long-Term Wealth Builder' };
    else if (labels.includes('Systematic investor') && labels.includes('Long-term investor')) persona = { label: 'Systematic Accumulator', why: 'Regular investment transfers and multi-year holding periods.', evidence: invEv.map((e) => `${e.label}: ${e.value}`), confidence: 'HIGH', alternative: 'Long-Term Wealth Builder' };
    else if (labels.includes('Diversified investor')) persona = { label: 'Diversified Growth Investor', why: 'Holdings span multiple funds and securities.', evidence: invEv.map((e) => `${e.label}: ${e.value}`), confidence: 'MEDIUM', alternative: 'Systematic Accumulator' };
    else if (labels.includes('High cash allocation')) persona = { label: 'Liquidity-Focused Investor', why: 'Cash and deposits dominate known financial assets.', evidence: [`Cash & deposits ${cashShare}%`], confidence: 'MEDIUM', alternative: 'Long-Term Wealth Builder' };
    else if (labels.includes('Business-heavy wealth')) persona = { label: 'Entrepreneurial Investor', why: 'Business interests dominate known assets.', evidence: [`Business interests ${bizShare}%`], confidence: 'MEDIUM', alternative: 'Property-Led Wealth Holder' };
    else persona = { label: 'Long-Term Wealth Builder', why: 'Verified holdings with multi-year tenure and no short-term trading pattern.', evidence: invEv.map((e) => `${e.label}: ${e.value}`), confidence: 'LOW', alternative: 'Diversified Growth Investor' };
  }

  /* ---- Priorities & interests ---- */
  const priorities: ClientAnalysis['priorities'] = [];
  for (const o of ctx.investorProfile?.objectives ?? []) priorities.push({ label: o, kind: 'CLIENT_DECLARED', evidence: ['Investor profile declaration'] });
  const askedDiversify = ctx.interactions.filter((i) => /diversif/i.test([i.summary, ...i.questions, ...i.interests].join(' '))).length;
  if (askedDiversify >= 2) priorities.push({ label: 'Diversification', kind: 'OBSERVED', evidence: [`Raised in ${askedDiversify} interactions`] });
  const askedLiquidity = ctx.interactions.filter((i) => /liquidity|lock-?in|exit/i.test([i.summary, ...i.questions, ...i.concerns].join(' '))).length;
  if (askedLiquidity >= 2) priorities.push({ label: 'Liquidity / exit flexibility', kind: 'OBSERVED', evidence: [`Raised in ${askedLiquidity} interactions`] });
  if (cf.n >= 6 && sipMonths / cf.n >= 0.8) priorities.push({ label: 'Capital growth via systematic investing', kind: 'OBSERVED', evidence: [`Investment transfers in ${sipMonths}/${cf.n} months`] });
  const interestMap = ctx.interests.map((i) => ({ category: i.category, stance: i.stance, basis: `${i.evidence_class.replace(/_/g, ' ').toLowerCase()}${i.source ? ` - ${i.source}` : ''}` }));

  /* ---- Engagement, reliability, human context ---- */
  const engagement = engagementFrom(ctx.interactions, ctx.contact);
  const lvl = (x: string) => (x === 'HIGH' ? 'High' : x === 'MEDIUM' ? 'Medium' : x === 'LOW' ? 'Low' : 'Not available');
  const relComponents = [
    { label: 'Identity consistency', level: lvl(v.identityConsistency), basis: 'Cross-source name/identifier checks' },
    { label: 'Employment verification', level: v.employmentCurrent === null ? 'Not available' : 'High', basis: 'EPFO record' },
    { label: 'Contact consistency', level: lvl(v.contactConsistency), basis: 'Phone/e-mail cross-source' },
    { label: 'Address verification', level: lvl(v.addressConsistency), basis: 'Address cross-source' },
    { label: 'Credit repayment history', level: b ? (ds.paymentStress.status === 'OK' ? 'Strong' : 'Irregular') : 'Not available', basis: 'Bureau DPD history' },
    { label: 'Source-of-funds evidence', level: ctx.fundSources.some((f) => f.kind === 'SOURCE_OF_FUNDS' && ['EVIDENCED', 'VERIFIED'].includes(f.status)) ? 'High' : ctx.fundSources.some((f) => f.kind === 'SOURCE_OF_FUNDS') ? 'Pending' : 'Not available', basis: 'Declared vs evidenced' },
    { label: 'Declared vs verified consistency', level: ctx.investorProfile?.incomeRange && v.incomeAnnual ? 'Medium' : 'Not available', basis: 'Investor profile vs verified income' },
    { label: 'External record consistency', level: ctx.externalPending ? 'Medium' : 'Not available', basis: `${ctx.externalPending} external findings pending review` },
  ];
  const scored = relComponents.filter((c) => c.level !== 'Not available' && c.level !== 'Pending');
  const relPts = scored.reduce((s, c) => s + (c.level === 'High' || c.level === 'Strong' ? 1 : c.level === 'Medium' ? 0.6 : 0.2), 0);
  const reliability = { components: relComponents, verificationConfidence: scored.length ? Math.round((relPts / scored.length) * 100) : null, statement: 'A data-consistency score answering "how consistent and verifiable is the information supplied?" - not a character, honesty or personality score.' };
  const humanContext = { items: ctx.humanInputs.map((h) => ({ id: h.id, sourceType: h.source_type, category: h.category, summary: h.body.length > 160 ? `${h.body.slice(0, 157)}...` : h.body, status: h.status, verifiable: /own|director|sold|bought|compan|acre|property|land|inherit|loan|invest|business/i.test(h.body) })), statement: ctx.humanInputs.length ? `${ctx.humanInputs.length} human-context item(s) on file. They influenced none of the conclusions above; they only generate verification and follow-up questions.` : 'No human-context items.' };

  const risksRequiringReview = [...v.openRiskSignals.filter((s) => s.requiresReview).map((s) => `${s.severity}: ${s.title}`), ...ctx.legal.filter((l) => l.review_status === 'PENDING').map((l) => `Legal record pending review: ${l.case_number ?? l.case_type} (${l.client_role ?? 'role unknown'})`), ...(ctx.externalPending ? [`${ctx.externalPending} external finding(s) pending review`] : [])];
  const missing = [...new Set([...(financialHealth.result.missing ?? []), ...(income.result.missing ?? []), ...(saving.result.missing ?? []), ...(riskPreference.result.missing ?? []), ...(resilience.result.missing ?? []), ...(liquidity.result.missing ?? []), ...(creditHealth.result.missing ?? []), ...(ctx.fundSources.length ? [] : ['source of funds / wealth declaration']), ...(ctx.investorProfile ? [] : ['investor profile / suitability questionnaire']), ...(ctx.propertyPreferences ? [] : ['property requirements'])])];
  const significantEvents = [...ctx.events].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)).slice(0, 12).map((e) => ({ date: e.occurred_on, title: e.title, amount: e.amount, evidenceClass: e.evidence_class }));

  const narrative: ClientAnalysis['narrative'] = [];
  if (fhMax) narrative.push({ text: `Financial health is assessed as ${fhLabel.toLowerCase()} on ${fhParts.length} observable factor(s): ${fhParts.join(', ')}.`, evidence: ['financialHealth'] });
  if (cf.n >= 3) narrative.push({ text: `Approximately ${Math.round(cf.investRate * 100)}% of observed monthly inflows was directed to investments over the available ${cf.n}-month period, with net saving positive in ${cf.positive} of ${cf.n} months.`, evidence: ['saving', 'spending'] });
  if (comp.length) narrative.push({ text: `${wealth.personal.netWorth.statement}`, evidence: ['wealth.netWorth'] });
  if (concList.length) narrative.push({ text: `Concentration to note: ${concList.join('; ')}.`, evidence: ['concentration'] });
  if (ds.available) narrative.push({ text: `Credit obligations: EMI-to-income ${ds.emiToIncome.display}; ${ds.paymentStress.display.toLowerCase()}.`, evidence: ['debtBehavior', 'creditHealth'] });
  if (wealth.familyLinked.components.length) narrative.push({ text: 'Family-associated assets are displayed separately and are not included in personal net worth.', evidence: ['wealth.familyLinked'] });
  if (missing.length) narrative.push({ text: `Not available: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' and more' : ''}. Absence of data is not treated as negative.`, evidence: ['missing'] });

  return {
    engineVersion: ANALYSIS_ENGINE_VERSION,
    computedAt: now.toISOString(),
    inputs: { verifiedSources: reliableAssets.length + (ctx.bureau ? 1 : 0) + (v.creditScore !== null ? 1 : 0) + (v.employmentCurrent !== null ? 1 : 0) + ctx.legal.filter((l) => l.evidence_class === 'OFFICIAL_PUBLIC_RECORD').length, declaredSources: ctx.assets.filter((a) => a.evidence_class === 'CLIENT_DECLARED').length + (ctx.investorProfile ? 1 : 0) + (ctx.propertyPreferences ? 1 : 0) + ctx.fundSources.length, authorizedDataSets: (ctx.cashFlow.length ? 1 : 0) + ctx.banks.length + (ctx.bureau ? 1 : 0), humanContextItems: ctx.humanInputs.length, humanInfluenceOnFinancialProfile: 'NONE', cashFlowMonths: ctx.cashFlow.length, interactions: ctx.interactions.length },
    wealth,
    financialHealth,
    income,
    spending,
    saving,
    investmentBehavior,
    investmentExperience,
    riskPreference,
    resilience,
    liquidity,
    debtBehavior,
    creditHealth,
    concentration,
    decisionPatterns,
    persona,
    priorities,
    interestMap,
    engagement,
    reliability,
    humanContext,
    risksRequiringReview,
    missing,
    significantEvents,
    narrative,
  };
}

/** Compares two analyses: what changed, metrics up/down, new/resolved risks. */
export function diffAnalyses(prev: ClientAnalysis | null, next: ClientAnalysis) {
  if (!prev) return { first: true, changes: [] as Array<{ key: string; from: string; to: string }>, newRisks: next.risksRequiringReview, resolvedRisks: [] as string[], newDataSets: [] as string[] };
  const changes: Array<{ key: string; from: string; to: string }> = [];
  const cmp = (key: string, a: unknown, b: unknown) => {
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    if (sa !== sb) changes.push({ key, from: typeof a === 'string' ? a : String(Array.isArray(a) ? a.join(', ') : sa), to: typeof b === 'string' ? b : String(Array.isArray(b) ? b.join(', ') : sb) });
  };
  cmp('Net worth', prev.wealth.personal.netWorth.range ? `${cr(prev.wealth.personal.netWorth.range.low)}-${cr(prev.wealth.personal.netWorth.range.high)}` : 'n/a', next.wealth.personal.netWorth.range ? `${cr(next.wealth.personal.netWorth.range.low)}-${cr(next.wealth.personal.netWorth.range.high)}` : 'n/a');
  cmp('Liquid net worth', prev.wealth.personal.liquidNetWorth.range?.mid ? cr(prev.wealth.personal.liquidNetWorth.range.mid) : 'n/a', next.wealth.personal.liquidNetWorth.range?.mid ? cr(next.wealth.personal.liquidNetWorth.range.mid) : 'n/a');
  cmp('Financial health', prev.financialHealth.result.value, next.financialHealth.result.value);
  cmp('Saving pattern', prev.saving.result.value, next.saving.result.value);
  cmp('Investment behaviour', prev.investmentBehavior.result.value, next.investmentBehavior.result.value);
  cmp('Risk preference', prev.riskPreference.result.value, next.riskPreference.result.value);
  cmp('Resilience', prev.resilience.result.value, next.resilience.result.value);
  cmp('Credit health', prev.creditHealth.result.value, next.creditHealth.result.value);
  cmp('Persona', prev.persona?.label ?? 'none', next.persona?.label ?? 'none');
  cmp('Coverage', `${prev.wealth.coverage.overall}%`, `${next.wealth.coverage.overall}%`);
  const newRisks = next.risksRequiringReview.filter((r) => !prev.risksRequiringReview.includes(r));
  const resolvedRisks = prev.risksRequiringReview.filter((r) => !next.risksRequiringReview.includes(r));
  const newDataSets: string[] = [];
  if (next.inputs.cashFlowMonths > prev.inputs.cashFlowMonths) newDataSets.push(`${next.inputs.cashFlowMonths - prev.inputs.cashFlowMonths} more cash-flow month(s)`);
  if (next.inputs.verifiedSources > prev.inputs.verifiedSources) newDataSets.push(`${next.inputs.verifiedSources - prev.inputs.verifiedSources} more verified source(s)`);
  if (next.inputs.interactions > prev.inputs.interactions) newDataSets.push(`${next.inputs.interactions - prev.inputs.interactions} new interaction(s)`);
  return { first: false, changes, newRisks, resolvedRisks, newDataSets };
}
