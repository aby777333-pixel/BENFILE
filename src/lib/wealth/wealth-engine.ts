/**
 * Wealth engine: net worth (ranged, confidence-propagated), liquid net worth, investable assets,
 * wealth composition, capital map, debt-service metrics, coverage. Family-linked wealth is always separate.
 * Nothing is estimated when the inputs are missing; every figure carries its evidence class.
 */
import { COUNTABLE_EVIDENCE, RELIABLE_EVIDENCE, type AssetCategory, type AssetRow, type BureauReportRow, type CashFlowRow, type Confidence, type EvidenceClass, type LiabilityRow, type BankRelationshipRow } from './types';

export const WEALTH_ENGINE_VERSION = 'wealth-1.0.0';

export interface ValueRange {
  low: number;
  mid: number;
  high: number;
}

export interface NetWorthComponent {
  key: string;
  label: string;
  category: AssetCategory | 'LIABILITY';
  range: ValueRange | null;
  confidence: Confidence;
  evidenceClass: EvidenceClass;
  basis: string;
  count: number;
  verifiedShare: number; // 0..1 of mid value that comes from reliable evidence
}

export interface WealthSummary {
  engineVersion: string;
  computedAt: string;
  personal: {
    netWorth: { range: ValueRange | null; confidence: Confidence; coverage: number; statement: string };
    liquidNetWorth: { range: ValueRange | null; confidence: Confidence; statement: string };
    investableAssets: { range: ValueRange | null; confidence: Confidence; statement: string };
    totalAssets: ValueRange | null;
    totalLiabilities: { value: number | null; confidence: Confidence };
    monthlyObligations: { value: number | null; confidence: Confidence };
    components: NetWorthComponent[];
    composition: Array<{ key: string; label: string; mid: number; pct: number; verifiedPct: number }>;
    verifiedValueShare: number; // share of total asset mid-value from reliable evidence
    estimatedValueShare: number;
    declaredValueShare: number;
  };
  familyLinked: { range: ValueRange | null; components: NetWorthComponent[]; statement: string };
  possibleAssociations: { count: number; titles: string[]; statement: string };
  capitalMap: Array<{ key: 'LIQUID_NOW' | 'COMMITTED' | 'LONG_TERM_ILLIQUID' | 'LEVERAGED' | 'UNKNOWN'; label: string; range: ValueRange | null; items: string[]; note: string }>;
  debtService: DebtServiceMetrics;
  coverage: { overall: number; domains: Array<{ key: string; label: string; pct: number; basis: string }> };
  hniIndicator: { qualifies: boolean | null; basis: string };
}

export interface DebtServiceMetrics {
  available: boolean;
  dti: MetricValue;
  emiToIncome: MetricValue;
  utilization: MetricValue;
  securedVsUnsecured: MetricValue;
  concentration: MetricValue;
  recentBorrowing: MetricValue;
  paymentStress: MetricValue;
}
export interface MetricValue {
  value: number | null;
  display: string;
  status: 'OK' | 'WATCH' | 'ELEVATED' | 'NOT_AVAILABLE';
  basis: string;
  missing?: string[];
}

const CAT_LABEL: Record<AssetCategory, string> = {
  REAL_ESTATE: 'Real estate',
  BUSINESS_INTEREST: 'Business interests',
  FINANCIAL_INVESTMENT: 'Financial investments',
  MUTUAL_FUND: 'Mutual funds',
  SECURITY: 'Securities',
  DEPOSIT: 'Deposits',
  CASH: 'Cash & bank balances',
  RETIREMENT: 'Retirement assets',
  INSURANCE: 'Insurance (asset value)',
  VEHICLE: 'Vehicles',
  LUXURY: 'Luxury & collectibles',
  OTHER: 'Other assets',
};
const LIQUID_CATS: AssetCategory[] = ['CASH', 'DEPOSIT', 'MUTUAL_FUND', 'SECURITY', 'FINANCIAL_INVESTMENT'];
const INVESTABLE_CATS: AssetCategory[] = ['CASH', 'DEPOSIT', 'MUTUAL_FUND', 'SECURITY', 'FINANCIAL_INVESTMENT'];
const CONF_ORDER: Confidence[] = ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'];
const worst = (a: Confidence, b: Confidence): Confidence => (CONF_ORDER.indexOf(a) > CONF_ORDER.indexOf(b) ? a : b);

function rangeOf(a: AssetRow): ValueRange | null {
  const mid = a.value_mid ?? (a.value_low !== null && a.value_high !== null ? (a.value_low + a.value_high) / 2 : (a.value_low ?? a.value_high));
  if (mid === null || mid === undefined) return null;
  const pct = a.ownership_pct !== null && a.ownership_pct !== undefined ? a.ownership_pct / 100 : 1;
  return { low: (a.value_low ?? mid) * pct, mid: mid * pct, high: (a.value_high ?? mid) * pct };
}
const add = (x: ValueRange | null, y: ValueRange | null): ValueRange | null => (!x ? y : !y ? x : { low: x.low + y.low, mid: x.mid + y.mid, high: x.high + y.high });
const isReliable = (e: EvidenceClass) => RELIABLE_EVIDENCE.includes(e);

function confidenceFromEvidence(e: EvidenceClass, c: Confidence): Confidence {
  if (e === 'VERIFIED' || e === 'AUTHORIZED_THIRD_PARTY') return c === 'INSUFFICIENT' ? 'HIGH' : c;
  if (e === 'OFFICIAL_PUBLIC_RECORD') return worst(c, 'HIGH');
  if (e === 'DERIVED_ESTIMATE') return worst(c, 'MEDIUM');
  if (e === 'CLIENT_DECLARED' || e === 'ANALYST_PROVIDED') return worst(c, 'LOW');
  return 'INSUFFICIENT';
}

export function buildComponents(assets: AssetRow[]): NetWorthComponent[] {
  const groups = new Map<AssetCategory, AssetRow[]>();
  for (const a of assets) groups.set(a.category, [...(groups.get(a.category) ?? []), a]);
  const out: NetWorthComponent[] = [];
  for (const [cat, list] of groups) {
    let range: ValueRange | null = null;
    let reliableMid = 0;
    let conf: Confidence = 'VERIFIED';
    let evClass: EvidenceClass = 'VERIFIED';
    const evRank: EvidenceClass[] = ['VERIFIED', 'AUTHORIZED_THIRD_PARTY', 'OFFICIAL_PUBLIC_RECORD', 'DERIVED_ESTIMATE', 'CLIENT_DECLARED', 'ANALYST_PROVIDED', 'POSSIBLE_ASSOCIATION'];
    for (const a of list) {
      const r = rangeOf(a);
      if (r) {
        range = add(range, r);
        if (isReliable(a.evidence_class)) reliableMid += r.mid;
      }
      conf = worst(conf, confidenceFromEvidence(a.evidence_class, a.confidence));
      if (evRank.indexOf(a.evidence_class) > evRank.indexOf(evClass)) evClass = a.evidence_class;
    }
    out.push({
      key: cat,
      label: CAT_LABEL[cat],
      category: cat,
      range,
      confidence: range ? conf : 'INSUFFICIENT',
      evidenceClass: evClass,
      basis: range ? `${list.length} item(s); ${list.filter((a) => rangeOf(a)).length} valued; basis ${[...new Set(list.map((a) => a.valuation_basis))].join(', ').toLowerCase().replace(/_/g, ' ')}.` : `${list.length} item(s) recorded without a reliable value.`,
      count: list.length,
      verifiedShare: range && range.mid > 0 ? Math.round((reliableMid / range.mid) * 100) / 100 : 0,
    });
  }
  return out.sort((a, b) => (b.range?.mid ?? 0) - (a.range?.mid ?? 0));
}

export function computeWealth(input: { assets: AssetRow[]; liabilities: LiabilityRow[]; bureau: BureauReportRow | null; cashFlow: CashFlowRow[]; banks: BankRelationshipRow[]; incomeAnnual: number | null; incomeEvidence: EvidenceClass | null; now?: Date }): WealthSummary {
  const now = input.now ?? new Date();
  const active = input.assets.filter((a) => a.status === 'ACTIVE');
  const personalAssets = active.filter((a) => a.ownership_scope !== 'FAMILY_LINKED' && a.evidence_class !== 'POSSIBLE_ASSOCIATION' && COUNTABLE_EVIDENCE.includes(a.evidence_class));
  const familyAssets = active.filter((a) => a.ownership_scope === 'FAMILY_LINKED' && a.evidence_class !== 'POSSIBLE_ASSOCIATION');
  const possible = active.filter((a) => a.evidence_class === 'POSSIBLE_ASSOCIATION');
  const liabilities = input.liabilities.filter((l) => l.status === 'ACTIVE' && ['BORROWER', 'CO_BORROWER'].includes(l.role));
  const guarantees = input.liabilities.filter((l) => l.status === 'ACTIVE' && ['GUARANTOR', 'DIRECTOR_GUARANTOR'].includes(l.role));

  const components = buildComponents(personalAssets);
  const totalAssets = components.reduce<ValueRange | null>((s, c) => add(s, c.range), null);
  const reliableMid = components.reduce((s, c) => s + (c.range ? c.range.mid * c.verifiedShare : 0), 0);
  const estimatedMid = personalAssets.filter((a) => a.evidence_class === 'DERIVED_ESTIMATE').reduce((s, a) => s + (rangeOf(a)?.mid ?? 0), 0);
  const declaredMid = personalAssets.filter((a) => a.evidence_class === 'CLIENT_DECLARED' || a.evidence_class === 'ANALYST_PROVIDED').reduce((s, a) => s + (rangeOf(a)?.mid ?? 0), 0);
  const totalMid = totalAssets?.mid ?? 0;

  const liabValued = liabilities.filter((l) => l.outstanding !== null);
  const liabTotal = liabValued.length ? liabValued.reduce((s, l) => s + (l.outstanding ?? 0), 0) : null;
  const liabConf: Confidence = !liabilities.length ? 'INSUFFICIENT' : liabilities.every((l) => isReliable(l.evidence_class)) ? 'HIGH' : liabilities.some((l) => isReliable(l.evidence_class)) ? 'MEDIUM' : 'LOW';
  const liabComponent: NetWorthComponent | null = liabilities.length
    ? { key: 'LIABILITIES', label: 'Liabilities (verified + declared)', category: 'LIABILITY', range: liabTotal !== null ? { low: -liabTotal, mid: -liabTotal, high: -liabTotal } : null, confidence: liabConf, evidenceClass: liabilities.every((l) => isReliable(l.evidence_class)) ? 'VERIFIED' : 'CLIENT_DECLARED', basis: `${liabilities.length} liability record(s); ${liabValued.length} with outstanding balances.`, count: liabilities.length, verifiedShare: liabTotal ? liabValued.filter((l) => isReliable(l.evidence_class)).reduce((s, l) => s + (l.outstanding ?? 0), 0) / liabTotal : 0 }
    : null;

  const unvalued = personalAssets.filter((a) => !rangeOf(a)).length;
  const valuedCount = personalAssets.length - unvalued;
  const nwRange = totalAssets ? { low: totalAssets.low - (liabTotal ?? 0), mid: totalAssets.mid - (liabTotal ?? 0), high: totalAssets.high - (liabTotal ?? 0) } : null;
  // Value-weighted confidence: what share of the mid value sits at each confidence level.
  // Unvalued components are reported as coverage gaps, not as confidence drags.
  const valuedAssets = personalAssets.filter((a) => rangeOf(a));
  const weightAt = (levels: Confidence[]) => valuedAssets.filter((a) => levels.includes(confidenceFromEvidence(a.evidence_class, a.confidence))).reduce((s, a) => s + (rangeOf(a)?.mid ?? 0), 0) / Math.max(totalMid, 1);
  const strongShare = weightAt(['VERIFIED', 'HIGH']);
  const okShare = weightAt(['VERIFIED', 'HIGH', 'MEDIUM']);
  const assetConf: Confidence = !valuedAssets.length ? 'INSUFFICIENT' : strongShare >= 0.9 ? 'HIGH' : okShare >= 0.6 ? 'MEDIUM' : 'LOW';
  const nwConf: Confidence = !nwRange ? 'INSUFFICIENT' : worst(assetConf, liabConf === 'INSUFFICIENT' && liabilities.length ? 'LOW' : liabConf === 'INSUFFICIENT' ? 'VERIFIED' : liabConf);
  const coverage = personalAssets.length ? Math.round((valuedCount / personalAssets.length) * 100) / 100 : 0;
  const enough = valuedCount >= 1 && totalMid > 0 && (reliableMid / totalMid >= 0.4 || valuedCount >= 3);

  const liquidAssets = personalAssets.filter((a) => a.liquidity === 'LIQUID' && LIQUID_CATS.includes(a.category));
  const liquidRange = liquidAssets.reduce<ValueRange | null>((s, a) => add(s, rangeOf(a)), null);
  const shortTermLiab = liabilities.filter((l) => ['CREDIT_CARD', 'OD', 'OVERDRAFT', 'PERSONAL_LOAN', 'GOLD_LOAN', 'CREDIT_LINE'].includes(l.liability_type) && l.outstanding !== null).reduce((s, l) => s + (l.outstanding ?? 0), 0);
  const liquidNw = liquidRange ? { low: liquidRange.low - shortTermLiab, mid: liquidRange.mid - shortTermLiab, high: liquidRange.high - shortTermLiab } : null;
  const liquidConf: Confidence = liquidAssets.length ? liquidAssets.reduce<Confidence>((c, a) => worst(c, confidenceFromEvidence(a.evidence_class, a.confidence)), 'VERIFIED') : 'INSUFFICIENT';
  const investable = personalAssets.filter((a) => INVESTABLE_CATS.includes(a.category) && a.liquidity !== 'ILLIQUID' && !a.encumbered && !(a.details as { earmarked?: boolean })?.earmarked);
  const investableRange = investable.reduce<ValueRange | null>((s, a) => add(s, rangeOf(a)), null);
  const investableConf: Confidence = investable.length ? investable.reduce<Confidence>((c, a) => worst(c, confidenceFromEvidence(a.evidence_class, a.confidence)), 'VERIFIED') : 'INSUFFICIENT';

  const composition = components.filter((c) => c.range).map((c) => ({ key: c.key, label: c.label, mid: c.range!.mid, pct: totalMid ? Math.round((c.range!.mid / totalMid) * 1000) / 10 : 0, verifiedPct: Math.round(c.verifiedShare * 100) }));

  const famComponents = buildComponents(familyAssets);
  const famRange = famComponents.reduce<ValueRange | null>((s, c) => add(s, c.range), null);

  const monthly = liabilities.filter((l) => l.monthly_obligation !== null).reduce((s, l) => s + (l.monthly_obligation ?? 0), 0);
  const monthlyKnown = liabilities.some((l) => l.monthly_obligation !== null);
  const committed = personalAssets.filter((a) => (a.details as { committed?: boolean })?.committed || a.category === 'RETIREMENT');
  const leveraged = personalAssets.filter((a) => a.encumbered || a.linked_liability_id);
  const illiquid = personalAssets.filter((a) => a.liquidity === 'ILLIQUID' && !a.encumbered && !a.linked_liability_id && !committed.includes(a));
  const capitalMap: WealthSummary['capitalMap'] = [
    { key: 'LIQUID_NOW', label: 'Liquidity available now', range: liquidAssets.filter((a) => isReliable(a.evidence_class)).reduce<ValueRange | null>((s, a) => add(s, rangeOf(a)), null), items: liquidAssets.filter((a) => isReliable(a.evidence_class)).map((a) => a.title), note: 'Only cash, deposits and liquid funds supported by authorised data. Declared-only liquidity is excluded.' },
    { key: 'COMMITTED', label: 'Capital already committed', range: committed.reduce<ValueRange | null>((s, a) => add(s, rangeOf(a)), null), items: [...committed.map((a) => a.title), ...(monthlyKnown ? [`Monthly obligations INR ${Math.round(monthly).toLocaleString('en-IN')}`] : [])], note: 'Retirement assets, earmarked investments, bookings and known obligations.' },
    { key: 'LONG_TERM_ILLIQUID', label: 'Long-term / illiquid wealth', range: illiquid.reduce<ValueRange | null>((s, a) => add(s, rangeOf(a)), null), items: illiquid.map((a) => a.title), note: 'Land, property, private companies and locked investments. Never treated as investable.' },
    { key: 'LEVERAGED', label: 'Leveraged / debt-dependent capital', range: leveraged.reduce<ValueRange | null>((s, a) => add(s, rangeOf(a)), null), items: [...leveraged.map((a) => a.title), ...liabilities.map((l) => `${l.liability_type.replace(/_/g, ' ')}${l.lender ? ` - ${l.lender}` : ''}`)], note: 'Assets carrying a charge and the borrowing behind them.' },
    { key: 'UNKNOWN', label: 'Unknown / unverified capital', range: null, items: [...possible.map((a) => `${a.title} (possible association)`), ...personalAssets.filter((a) => !rangeOf(a)).map((a) => `${a.title} (not valued)`), ...familyAssets.map((a) => `${a.title} (family-linked)`)], note: 'Not counted anywhere until verified.' },
  ];

  const debtService = computeDebtService({ liabilities, bureau: input.bureau, incomeAnnual: input.incomeAnnual, cashFlow: input.cashFlow, monthly: monthlyKnown ? monthly : null, now });

  const domains = [
    { key: 'identity', label: 'Identity', pct: 100, basis: 'From verification run' },
    { key: 'employment', label: 'Employment', pct: 100, basis: 'From verification run' },
    { key: 'credit', label: 'Credit', pct: input.bureau ? 95 : 40, basis: input.bureau ? 'Bureau report with accounts' : 'Score only, no bureau report' },
    { key: 'banking', label: 'Banking', pct: input.banks.length ? Math.min(100, 40 + input.cashFlow.length * 5) : 0, basis: input.banks.length ? `${input.banks.length} account(s), ${input.cashFlow.length} month(s) of cash flow` : 'No consented banking data' },
    { key: 'investments', label: 'Investments', pct: Math.min(100, personalAssets.filter((a) => ['MUTUAL_FUND', 'SECURITY', 'FINANCIAL_INVESTMENT', 'DEPOSIT'].includes(a.category) && isReliable(a.evidence_class)).length * 25), basis: 'Verified statements / aggregator holdings' },
    { key: 'real_estate', label: 'Real estate', pct: (() => { const re = personalAssets.filter((a) => a.category === 'REAL_ESTATE'); return re.length ? Math.round((re.filter((a) => isReliable(a.evidence_class) && rangeOf(a)).length / re.length) * 100) : 0; })(), basis: 'Share of recorded properties with official records and a valuation' },
    { key: 'business', label: 'Business interests', pct: (() => { const b = personalAssets.filter((a) => a.category === 'BUSINESS_INTEREST'); return b.length ? Math.round((b.filter((a) => isReliable(a.evidence_class)).length / b.length) * 100) : 0; })(), basis: 'Share of business interests confirmed by registry' },
    { key: 'liabilities', label: 'Liabilities', pct: liabilities.length ? Math.round((liabilities.filter((l) => isReliable(l.evidence_class) && l.outstanding !== null).length / liabilities.length) * 100) : input.bureau ? 80 : 0, basis: 'Share of liabilities confirmed by bureau or lender' },
  ];
  const overallCoverage = Math.round(domains.reduce((s, d) => s + d.pct, 0) / domains.length);

  const verifiedNw = reliableMid - (liabTotal ?? 0);
  const hni = enough && nwConf !== 'INSUFFICIENT' ? { qualifies: verifiedNw >= 50_000_000 || (nwRange?.low ?? 0) >= 50_000_000, basis: `Verified-evidence net worth INR ${Math.round(verifiedNw).toLocaleString('en-IN')} against a configurable INR 5 Cr HNI threshold. Declared and estimated values do not count.` } : { qualifies: null, basis: 'Insufficient verified information to assess HNI status. Not assumed.' };

  const fmt = (r: ValueRange | null) => (r ? (Math.abs(r.high - r.low) / Math.max(Math.abs(r.mid), 1) > 0.05 ? `INR ${cr(r.low)} - ${cr(r.high)}` : `INR ${cr(r.mid)}`) : 'Not available');

  return {
    engineVersion: WEALTH_ENGINE_VERSION,
    computedAt: now.toISOString(),
    personal: {
      netWorth: { range: enough ? nwRange : null, confidence: enough ? nwConf : 'INSUFFICIENT', coverage, statement: enough ? `Estimated personal net worth ${fmt(nwRange)} (confidence ${nwConf.toLowerCase()}, ${Math.round(coverage * 100)}% of recorded assets valued, ${Math.round((totalMid ? reliableMid / totalMid : 0) * 100)}% of value from reliable evidence). Family-linked wealth and possible associations excluded.` : 'Insufficient verified information to estimate net worth. Recorded assets are listed below with their evidence class; no figure is inferred.' },
      liquidNetWorth: { range: liquidNw, confidence: liquidConf, statement: liquidNw ? `Liquid assets ${fmt(liquidRange)} less short-term liabilities INR ${cr(shortTermLiab)} (confidence ${liquidConf.toLowerCase()}). Illiquid land and private companies excluded.` : 'No liquid assets recorded from authorised or declared sources.' },
      investableAssets: { range: investableRange, confidence: investableConf, statement: investableRange ? `Potentially investable financial assets ${fmt(investableRange)} (confidence ${investableConf.toLowerCase()}). Not all liquid wealth is available for investment; confirm with the client.` : 'No investable financial assets recorded.' },
      totalAssets,
      totalLiabilities: { value: liabTotal, confidence: liabConf },
      monthlyObligations: { value: monthlyKnown ? monthly : null, confidence: monthlyKnown ? liabConf : 'INSUFFICIENT' },
      components: liabComponent ? [...components, liabComponent] : components,
      composition,
      verifiedValueShare: totalMid ? Math.round((reliableMid / totalMid) * 100) / 100 : 0,
      estimatedValueShare: totalMid ? Math.round((estimatedMid / totalMid) * 100) / 100 : 0,
      declaredValueShare: totalMid ? Math.round((declaredMid / totalMid) * 100) / 100 : 0,
    },
    familyLinked: { range: famRange, components: famComponents, statement: familyAssets.length ? `${familyAssets.length} family-linked asset(s) ${fmt(famRange)} shown separately. Not included in personal net worth; may only contribute with evidence of beneficial ownership, inheritance entitlement or trust interest.` : 'No family-linked wealth recorded.' },
    possibleAssociations: { count: possible.length, titles: possible.map((a) => a.title), statement: possible.length ? `${possible.length} possible association(s) require independent corroboration before they can be counted.` : 'None.' },
    capitalMap,
    debtService,
    coverage: { overall: overallCoverage, domains },
    hniIndicator: hni,
  };
}

export function cr(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(abs >= 1e8 ? 1 : 2)} Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(1)} L`;
  return `${sign}${Math.round(abs).toLocaleString('en-IN')}`;
}

function computeDebtService(i: { liabilities: LiabilityRow[]; bureau: BureauReportRow | null; incomeAnnual: number | null; cashFlow: CashFlowRow[]; monthly: number | null; now: Date }): DebtServiceMetrics {
  const na = (missing: string[]): MetricValue => ({ value: null, display: 'Not available', status: 'NOT_AVAILABLE', basis: 'Required inputs missing; not calculated.', missing });
  const monthlyIncome = i.incomeAnnual ? i.incomeAnnual / 12 : i.cashFlow.length ? i.cashFlow.reduce((s, c) => s + (c.salary_credits ?? 0), 0) / i.cashFlow.length : null;
  const emi = i.monthly ?? i.bureau?.emi_total ?? null;
  const outstanding = i.liabilities.filter((l) => l.outstanding !== null).reduce((s, l) => s + (l.outstanding ?? 0), 0) || i.bureau?.outstanding_total || null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const dti: MetricValue = i.incomeAnnual && outstanding !== null ? { value: outstanding / i.incomeAnnual, display: `${(outstanding / i.incomeAnnual).toFixed(2)}x`, status: outstanding / i.incomeAnnual > 4 ? 'ELEVATED' : outstanding / i.incomeAnnual > 2.5 ? 'WATCH' : 'OK', basis: `Total outstanding debt INR ${cr(outstanding)} / verified annual income INR ${cr(i.incomeAnnual)}.` } : na(['verified income', 'outstanding balances']);
  const emiRatio: MetricValue = monthlyIncome && emi !== null ? { value: emi / monthlyIncome, display: pct(emi / monthlyIncome), status: emi / monthlyIncome > 0.5 ? 'ELEVATED' : emi / monthlyIncome > 0.35 ? 'WATCH' : 'OK', basis: `Monthly obligations INR ${cr(emi)} / monthly income INR ${cr(monthlyIncome)}.` } : na(['monthly obligations', 'monthly income']);
  const util: MetricValue = i.bureau?.utilization !== null && i.bureau?.utilization !== undefined ? { value: i.bureau.utilization, display: pct(i.bureau.utilization), status: i.bureau.utilization > 0.7 ? 'ELEVATED' : i.bureau.utilization > 0.4 ? 'WATCH' : 'OK', basis: `Bureau-reported revolving utilisation (${i.bureau.bureau}, ${i.bureau.report_date ?? 'undated'}).` } : na(['bureau utilisation']);
  const sec = i.liabilities.filter((l) => l.secured === true && l.outstanding !== null).reduce((s, l) => s + (l.outstanding ?? 0), 0);
  const unsec = i.liabilities.filter((l) => l.secured === false && l.outstanding !== null).reduce((s, l) => s + (l.outstanding ?? 0), 0);
  const svu: MetricValue = sec + unsec > 0 ? { value: unsec / (sec + unsec), display: `${pct(sec / (sec + unsec))} secured / ${pct(unsec / (sec + unsec))} unsecured`, status: unsec / (sec + unsec) > 0.5 ? 'WATCH' : 'OK', basis: 'Split of outstanding balances by collateral status.' } : na(['liabilities with secured flag and balances']);
  const byLender = new Map<string, number>();
  for (const l of i.liabilities) if (l.outstanding !== null) byLender.set(l.lender ?? 'unknown', (byLender.get(l.lender ?? 'unknown') ?? 0) + (l.outstanding ?? 0));
  const top = [...byLender.entries()].sort((a, b) => b[1] - a[1])[0];
  const conc: MetricValue = top && outstanding ? { value: top[1] / outstanding, display: `${pct(top[1] / outstanding)} with ${top[0]}`, status: top[1] / outstanding > 0.8 && byLender.size > 1 ? 'WATCH' : 'OK', basis: 'Largest lender share of outstanding debt.' } : na(['lender-level balances']);
  const recentOpen = i.liabilities.filter((l) => l.opened_on && (i.now.getTime() - new Date(l.opened_on).getTime()) / 86_400_000 < 365).length;
  const enq = i.bureau?.enquiries_12m ?? null;
  const recent: MetricValue = i.bureau || i.liabilities.length ? { value: recentOpen + (enq ?? 0), display: `${recentOpen} new facility(ies) in 12 months${enq !== null ? `, ${enq} bureau enquiries` : ''}`, status: recentOpen + (enq ?? 0) >= 4 ? 'ELEVATED' : recentOpen + (enq ?? 0) >= 2 ? 'WATCH' : 'OK', basis: 'Facilities opened and bureau enquiries in the last 12 months.' } : na(['bureau enquiries', 'liability opening dates']);
  const dpd = (i.bureau?.dpd_30_count ?? 0) + (i.bureau?.dpd_60_count ?? 0) * 2 + (i.bureau?.dpd_90_count ?? 0) * 3 + i.liabilities.filter((l) => (l.days_past_due ?? 0) > 0).length;
  const stress: MetricValue = i.bureau ? { value: dpd, display: dpd === 0 ? 'No delinquency reported' : `${i.bureau.dpd_30_count ?? 0} x 30 DPD, ${i.bureau.dpd_60_count ?? 0} x 60 DPD, ${i.bureau.dpd_90_count ?? 0} x 90+ DPD`, status: (i.bureau.dpd_90_count ?? 0) > 0 || (i.bureau.write_offs ?? 0) > 0 ? 'ELEVATED' : dpd > 0 ? 'WATCH' : 'OK', basis: 'Bureau days-past-due counts, write-offs and settlements.' } : na(['bureau repayment history']);
  return { available: [dti, emiRatio, util, svu, conc, recent, stress].some((m) => m.status !== 'NOT_AVAILABLE'), dti, emiToIncome: emiRatio, utilization: util, securedVsUnsecured: svu, concentration: conc, recentBorrowing: recent, paymentStress: stress };
}
