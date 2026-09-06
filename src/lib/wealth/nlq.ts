/**
 * Natural-language investigation over STRUCTURED data only. Intent router + deterministic answers with sources.
 * If a question cannot be mapped to structured data, the engine says so rather than guessing.
 */
import type { ClientAnalysis } from './behavior-engine';
import type { ApproachStrategy } from './approach-engine';
import { cr } from './wealth-engine';
import type { ClientIntelligenceContext } from './types';

export interface NlqAnswer {
  intent: string;
  answer: string;
  items: Array<{ label: string; detail: string; evidenceClass?: string; source?: string }>;
  sources: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

const ev = (e: string) => e.replace(/_/g, ' ').toLowerCase();

export function answerQuestion(q: string, ctx: ClientIntelligenceContext, a: ClientAnalysis | null, s: ApproachStrategy | null): NlqAnswer {
  const t = q.toLowerCase().replace(/[-_]/g, ' ').replace(/[’']/g, "'");
  const has = (...w: string[]) => w.some((x) => t.includes(x));

  if (has('compan', 'director', 'business')) {
    const biz = ctx.assets.filter((x) => x.category === 'BUSINESS_INTEREST' && x.status === 'ACTIVE');
    return { intent: 'companies', answer: biz.length ? `${biz.length} business interest(s) are recorded. Only those marked verified or official record are registry-confirmed.` : 'No business interests are recorded. External corporate findings may be pending review.', items: biz.map((b) => ({ label: b.title, detail: `${b.subtype ?? 'interest'}${(b.details as { role?: string }).role ? ` - ${(b.details as { role?: string }).role}` : ''}${b.ownership_pct ? ` - ${b.ownership_pct}%` : ''}; value ${b.value_mid ? cr(b.value_mid) : 'not valued'}`, evidenceClass: ev(b.evidence_class), source: b.source_key })), sources: ['assets (BUSINESS_INTEREST)', 'external_findings'], confidence: 'HIGH' };
  }
  if (has('court', 'case', 'litigation', 'legal', 'proceeding', 'insolven')) {
    const open = ctx.legal.filter((l) => !/closed|disposed/i.test(l.status ?? ''));
    return { intent: 'legal', answer: ctx.legal.length ? `${ctx.legal.length} legal record(s) on file, ${open.length} not closed, ${ctx.legal.filter((l) => l.review_status === 'PENDING').length} pending identity review. Presence in a case is not evidence of wrongdoing.` : 'No legal records are attached to this client.', items: ctx.legal.map((l) => ({ label: l.case_number ?? l.case_type ?? 'Case', detail: `${l.court ?? ''} - role ${l.client_role ?? 'unknown'} - status ${l.status ?? 'unknown'} - identity match ${l.match_status ?? 'n/a'} ${l.identity_confidence ?? ''}% - ${l.subject_kind === 'ASSOCIATED_COMPANY' ? 'concerns an associated company' : 'concerns the person'}`, evidenceClass: ev(l.evidence_class), source: l.source_key })), sources: ['legal_matters'], confidence: 'HIGH' };
  }
  if (has('mortgage', 'encumber', 'charge')) {
    const m = ctx.assets.filter((x) => x.category === 'REAL_ESTATE' && (x.encumbered || x.linked_liability_id));
    return { intent: 'mortgaged_properties', answer: m.length ? `${m.length} property(ies) carry a recorded charge or linked loan.` : 'No property is recorded with an active mortgage or charge.', items: m.map((x) => ({ label: x.title, detail: `${x.value_mid ? cr(x.value_mid) : 'not valued'}; linked liability ${ctx.liabilities.find((l) => l.id === x.linked_liability_id)?.lender ?? 'recorded'}`, evidenceClass: ev(x.evidence_class), source: x.source_key })), sources: ['assets', 'liabilities'], confidence: 'HIGH' };
  }
  if (has('mutual fund', 'mf exposure', 'sip')) {
    const mf = ctx.assets.filter((x) => x.category === 'MUTUAL_FUND' && x.status === 'ACTIVE');
    const verified = mf.filter((x) => ['VERIFIED', 'AUTHORIZED_THIRD_PARTY'].includes(x.evidence_class));
    const tot = verified.reduce((s, x) => s + (x.value_mid ?? 0), 0);
    return { intent: 'mutual_funds', answer: mf.length ? `Verified mutual-fund exposure INR ${cr(tot)} across ${verified.length} holding(s); ${mf.length - verified.length} declared-only holding(s) excluded from the verified figure.` : 'No mutual-fund holdings recorded.', items: mf.map((x) => ({ label: x.title, detail: `${x.value_mid ? cr(x.value_mid) : 'n/a'} - ${x.subtype ?? ''} - valued ${x.valuation_date ?? 'n/a'} (${x.valuation_basis.toLowerCase()})`, evidenceClass: ev(x.evidence_class), source: x.source_key })), sources: ['assets (MUTUAL_FUND)'], confidence: 'HIGH' };
  }
  if (has('loan', 'liabilit', 'debt', 'emi', 'owe')) {
    const act = ctx.liabilities.filter((l) => l.status === 'ACTIVE');
    return { intent: 'loans', answer: act.length ? `${act.length} active liability(ies); total outstanding INR ${cr(act.reduce((s, l) => s + (l.outstanding ?? 0), 0))}; monthly obligations ${act.some((l) => l.monthly_obligation !== null) ? 'INR ' + cr(act.reduce((s, l) => s + (l.monthly_obligation ?? 0), 0)) : 'not fully known'}.` : 'No active liabilities recorded.', items: act.map((l) => ({ label: `${l.liability_type.replace(/_/g, ' ')} - ${l.lender ?? 'lender n/a'}`, detail: `outstanding ${l.outstanding !== null ? cr(l.outstanding) : 'n/a'}; EMI ${l.monthly_obligation !== null ? cr(l.monthly_obligation) : 'n/a'}; ${l.repayment_status ?? 'status n/a'}; role ${l.role.toLowerCase()}`, evidenceClass: ev(l.evidence_class), source: l.source_key })), sources: ['liabilities', 'credit_bureau_reports'], confidence: 'HIGH' };
  }
  if (has('net worth', 'networth', 'net-worth')) {
    if (!a) return { intent: 'net_worth', answer: 'Run Analyze Client first.', items: [], sources: [], confidence: 'LOW' };
    const nw = a.wealth.personal.netWorth;
    const uncertain = a.wealth.personal.components.filter((c) => c.range && (c.confidence === 'LOW' || c.confidence === 'MEDIUM' || c.verifiedShare < 0.5));
    if (has('uncertain', 'unsure', 'confidence', 'which part')) return { intent: 'net_worth_uncertainty', answer: uncertain.length ? `${uncertain.length} component(s) carry low/medium confidence or are mostly non-verified: ${uncertain.map((c) => c.label).join(', ')}.` : 'All valued components are backed by reliable evidence.', items: uncertain.map((c) => ({ label: c.label, detail: `${c.range ? `${cr(c.range.low)} - ${cr(c.range.high)}` : 'n/a'}; confidence ${c.confidence.toLowerCase()}; ${Math.round(c.verifiedShare * 100)}% from reliable evidence; ${c.basis}`, evidenceClass: ev(c.evidenceClass) })), sources: ['wealth engine'], confidence: 'HIGH' };
    if (has('change', 'increase', 'decrease', 'major')) return { intent: 'net_worth_changes', answer: 'Compare analysis versions in the Analyze tab; significant wealth events are listed below.', items: a.significantEvents.map((e) => ({ label: `${e.date} ${e.title}`, detail: e.amount ? cr(e.amount) : '', evidenceClass: ev(e.evidenceClass) })), sources: ['wealth_events', 'client_analyses'], confidence: 'MEDIUM' };
    return { intent: 'net_worth', answer: nw.statement, items: a.wealth.personal.components.map((c) => ({ label: c.label, detail: `${c.range ? `${cr(c.range.low)} - ${cr(c.range.high)}` : 'not valued'} - confidence ${c.confidence.toLowerCase()}`, evidenceClass: ev(c.evidenceClass) })), sources: ['wealth engine', 'assets', 'liabilities'], confidence: nw.confidence === 'INSUFFICIENT' ? 'LOW' : 'MEDIUM' };
  }
  if (has('inherit', 'ancestral')) {
    const inh = ctx.assets.filter((x) => x.is_inherited || x.ownership_scope === 'INHERITED');
    return { intent: 'inherited', answer: inh.length ? `${inh.length} asset(s) are recorded as inherited.` : 'No assets are recorded as inherited.', items: inh.map((x) => ({ label: x.title, detail: `${x.value_mid ? cr(x.value_mid) : 'not valued'}; scope ${x.ownership_scope.toLowerCase()}`, evidenceClass: ev(x.evidence_class), source: x.source_key })), sources: ['assets'], confidence: 'HIGH' };
  }
  if (has('vehicle', 'car', 'bike')) {
    const v = ctx.assets.filter((x) => x.category === 'VEHICLE' && x.status === 'ACTIVE' && x.evidence_class !== 'POSSIBLE_ASSOCIATION');
    return { intent: 'vehicles', answer: v.length ? `${v.length} vehicle(s) reliably associated (possible associations excluded).` : 'No vehicles reliably associated with the client.', items: v.map((x) => ({ label: x.title, detail: `${x.value_mid ? cr(x.value_mid) : 'n/a'}; ${(x.details as { finance?: string }).finance ?? 'finance status n/a'}`, evidenceClass: ev(x.evidence_class), source: x.source_key })), sources: ['assets (VEHICLE)'], confidence: 'HIGH' };
  }
  if (has('risk score', 'risk increase', 'why did the risk', 'risk go up', 'risk alert')) {
    const r = ctx.verified.openRiskSignals;
    return { intent: 'risk', answer: r.length ? `${r.length} open risk signal(s); ${r.filter((x) => x.requiresReview).length} need review. Each links to the rule and evidence in the Risk tab.` : 'No open risk signals.', items: r.map((x) => ({ label: x.title, detail: `${x.severity}${x.requiresReview ? ' - review required' : ''}` })), sources: ['risk_signals'], confidence: 'HIGH' };
  }
  if (has('approach', 'how should i', 'discuss first', 'first conversation', 'opening')) {
    if (!s) return { intent: 'approach', answer: 'Run Recommend Business Approach first.', items: [], sources: [], confidence: 'LOW' };
    return { intent: 'approach', answer: s.summary.lead, items: [{ label: 'Opening', detail: s.firstConversation.opening }, ...s.summary.focus.map((f) => ({ label: 'Focus', detail: f })), ...s.summary.avoid.slice(0, 3).map((f) => ({ label: 'Avoid', detail: f }))], sources: ['approach engine', 'interactions', 'investor_profiles'], confidence: s.approachConfidence };
  }
  if (has('priorit', 'care about', 'matter')) return { intent: 'priorities', answer: a?.priorities.length ? `${a.priorities.length} priority(ies) identified.` : 'No declared or observed priorities on record; ask the client.', items: (a?.priorities ?? []).map((p) => ({ label: p.label, detail: p.evidence.join('; '), evidenceClass: p.kind.toLowerCase().replace('_', ' ') })), sources: ['investor_profiles', 'interactions'], confidence: 'MEDIUM' };
  if (has('not pitch', "don't pitch", 'avoid', 'declined')) return { intent: 'avoid', answer: s ? `${s.interestMemory.notInterested.length} declined category(ies): ${s.interestMemory.notInterested.join(', ') || 'none'}.` : 'Run the approach engine first.', items: (s?.summary.avoid ?? []).map((x) => ({ label: 'Avoid', detail: x })), sources: ['client_interests', 'interactions'], confidence: 'HIGH' };
  if (has('product', 'relevant', 'suitable')) return { intent: 'products', answer: s ? `AIF ${s.aif.relevance}, property ${s.property.relevance}. Suitability status is shown per product.` : 'Run the approach engine first.', items: (s?.products ?? []).map((p) => ({ label: `${p.product} - ${p.relevance}`, detail: `${p.reason} (${p.suitabilityStatus.replace(/_/g, ' ').toLowerCase()})` })), sources: ['approach engine'], confidence: s?.approachConfidence ?? 'LOW' };
  if (has('question', 'ask')) return { intent: 'questions', answer: 'Questions grounded in what is missing and what the client has raised.', items: (s?.firstConversation.questions ?? []).map((q) => ({ label: 'Ask', detail: q })), sources: ['approach engine'], confidence: 'MEDIUM' };
  if (has('objection')) { const o = [...new Set(ctx.interactions.flatMap((i) => i.objections))]; return { intent: 'objections', answer: o.length ? `${o.length} objection(s) raised previously.` : 'No objections recorded.', items: o.map((x) => ({ label: 'Objection', detail: x })), sources: ['interactions'], confidence: 'HIGH' }; }
  if (has('changed since', 'what changed', 'since our last', 'since last meeting')) { const last = ctx.interactions[0]; const ev2 = ctx.events.filter((e) => !last || e.occurred_on >= last.occurred_at.slice(0, 10)); return { intent: 'changes', answer: last ? `Last interaction ${last.occurred_at.slice(0, 10)}. ${ev2.length} wealth event(s) since; compare analysis versions for metric changes.` : 'No prior interaction recorded.', items: ev2.map((e) => ({ label: `${e.occurred_on} ${e.title}`, detail: e.amount ? cr(e.amount) : '', evidenceClass: ev(e.evidence_class) })), sources: ['interactions', 'wealth_events', 'client_analyses'], confidence: 'MEDIUM' }; }
  if (has('next action', 'next best', 'what should my next', 'what next')) return { intent: 'next_action', answer: s ? `${s.nextBestAction.action} - ${s.nextBestAction.reason}` : 'Run the approach engine first.', items: (s?.nextBestAction.evidence ?? []).map((e) => ({ label: 'Evidence', detail: e })), sources: ['approach engine'], confidence: s?.nextBestAction.confidence ?? 'LOW' };
  if (has('brief', '2-minute', 'two minute', '2 minute', 'prepare')) return { intent: 'brief', answer: 'Use Prepare me for meeting on the Approach tab for 30-second, 2-minute and full briefs.', items: [], sources: ['approach engine'], confidence: 'HIGH' };
  if (has('directorship history', 'director history')) { const d = ctx.events.filter((e) => /DIRECTOR/i.test(e.event_type)); return { intent: 'directorships', answer: d.length ? `${d.length} directorship event(s) on the wealth timeline.` : 'No directorship events recorded.', items: d.map((e) => ({ label: `${e.occurred_on} ${e.title}`, detail: '', evidenceClass: ev(e.evidence_class), source: e.source_key })), sources: ['wealth_events', 'relationships'], confidence: 'HIGH' }; }
  if (has('propert', 'land', 'plot')) { const re = ctx.assets.filter((x) => x.category === 'REAL_ESTATE' && x.status === 'ACTIVE'); return { intent: 'properties', answer: re.length ? `${re.length} property/land record(s); ${re.filter((x) => ['VERIFIED', 'OFFICIAL_PUBLIC_RECORD'].includes(x.evidence_class)).length} with official records.` : 'No property or land recorded.', items: re.map((x) => ({ label: x.title, detail: `${(x.details as { city?: string }).city ?? ''} ${x.value_mid ? cr(x.value_mid) : 'not valued'} (${x.valuation_basis.toLowerCase().replace(/_/g, ' ')})${x.encumbered ? ' - encumbered' : ''}`, evidenceClass: ev(x.evidence_class), source: x.source_key })), sources: ['assets (REAL_ESTATE)'], confidence: 'HIGH' }; }
  return { intent: 'unknown', answer: 'That question does not map to structured data I can answer reliably. Try: companies, court proceedings, mortgaged properties, mutual-fund exposure, active loans, net worth (or which parts are uncertain), inherited assets, directorship history, vehicles, risk alerts, approach, priorities, products, questions, objections, what changed, next action.', items: [], sources: [], confidence: 'LOW' };
}
