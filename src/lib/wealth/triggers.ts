/** Opportunity-trigger engine: legitimate financial/business events that create a reason for contact. */
import { cr } from './wealth-engine';
import type { AifFundRow, ClientIntelligenceContext } from './types';

export interface Trigger {
  type: string;
  title: string;
  sourceKey: string;
  evidence: Record<string, unknown>;
  eventDate: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendedAction: string;
  sensitive: boolean;
}

export function detectTriggers(ctx: ClientIntelligenceContext, funds: AifFundRow[], siteVisitsCompleted: number): Trigger[] {
  const out: Trigger[] = [];
  const now = ctx.now.getTime();
  const within = (d: string | null | undefined, days: number) => !!d && (new Date(d).getTime() - now) / 86_400_000 <= days && new Date(d).getTime() >= now;
  for (const a of ctx.assets) {
    const m = (a.details as { maturity_on?: string }).maturity_on;
    if (a.category === 'DEPOSIT' && within(m, 60)) out.push({ type: 'FD_MATURITY', title: `${a.title} matures ${m}`, sourceKey: a.source_key, evidence: { assetId: a.id, value: a.value_mid, evidenceClass: a.evidence_class }, eventDate: m!, confidence: a.evidence_class === 'CLIENT_DECLARED' ? 'LOW' : 'HIGH', recommendedAction: 'Ask whether the client has plans for the maturing amount before suggesting anything.', sensitive: false });
  }
  for (const l of ctx.liabilities) {
    if (l.status === 'ACTIVE' && within(l.maturity_on, 90)) out.push({ type: 'LOAN_CLOSURE', title: `${l.liability_type.replace(/_/g, ' ')} with ${l.lender ?? 'lender'} matures ${l.maturity_on}`, sourceKey: l.source_key, evidence: { liabilityId: l.id, emi: l.monthly_obligation }, eventDate: l.maturity_on, confidence: 'MEDIUM', recommendedAction: 'Monthly obligation will fall; discuss priorities, not products.', sensitive: false });
  }
  for (const e of ctx.events) {
    if (/SALE|DISPOSAL/i.test(e.event_type) && (now - new Date(e.occurred_on).getTime()) / 86_400_000 <= 120) out.push({ type: 'PROPERTY_SALE', title: e.title, sourceKey: e.source_key, evidence: { eventId: e.id, amount: e.amount }, eventDate: e.occurred_on, confidence: e.evidence_class === 'VERIFIED' ? 'HIGH' : 'MEDIUM', recommendedAction: 'Ask about intended use of proceeds before suggesting reinvestment. Do not assume proceeds are available.', sensitive: false });
    if (/INHERIT/i.test(e.event_type) && (now - new Date(e.occurred_on).getTime()) / 86_400_000 <= 365) out.push({ type: 'INHERITANCE', title: e.title, sourceKey: e.source_key, evidence: { eventId: e.id }, eventDate: e.occurred_on, confidence: 'MEDIUM', recommendedAction: 'Sensitive event: do not initiate contact about it; respond only if the client raises it.', sensitive: true });
    if (/DISTRIBUTION|MATURITY/i.test(e.event_type) && (now - new Date(e.occurred_on).getTime()) / 86_400_000 <= 60) out.push({ type: 'AIF_DISTRIBUTION', title: e.title, sourceKey: e.source_key, evidence: { eventId: e.id, amount: e.amount }, eventDate: e.occurred_on, confidence: 'HIGH', recommendedAction: '"Do you already have plans for these funds?" before any property discussion.', sensitive: false });
  }
  for (const f of funds) if (f.status !== 'CLOSED' && within(f.closing_date, 45)) out.push({ type: 'FUND_CLOSING', title: `${f.name} closing ${f.closing_date}`, sourceKey: 'AIF_FUNDS', evidence: { fundId: f.id }, eventDate: f.closing_date, confidence: 'HIGH', recommendedAction: 'State the closing date plainly only to clients with established suitability; never as pressure.', sensitive: false });
  if (siteVisitsCompleted) out.push({ type: 'SITE_VISIT_DONE', title: `${siteVisitsCompleted} site visit(s) completed`, sourceKey: 'SITE_VISITS', evidence: { count: siteVisitsCompleted }, eventDate: null, confidence: 'HIGH', recommendedAction: 'Capture structured feedback and follow up on preferred plots.', sensitive: false });
  const fu = ctx.interactions.find((i) => i.follow_up_at && within(i.follow_up_at, 14));
  if (fu) out.push({ type: 'CALLBACK_DATE', title: `Client-requested follow-up ${fu.follow_up_at!.slice(0, 10)}`, sourceKey: 'INTERACTIONS', evidence: { interactionId: fu.id }, eventDate: fu.follow_up_at!.slice(0, 10), confidence: 'HIGH', recommendedAction: 'Call on the requested date.', sensitive: false });
  if (ctx.aifSuitability?.kyc_status === 'COMPLETE' && ctx.aifSuitability.stage !== 'FUNDING') out.push({ type: 'KYC_COMPLETE', title: 'KYC complete for AIF journey', sourceKey: 'AIF_SUITABILITY', evidence: { stage: ctx.aifSuitability.stage }, eventDate: null, confidence: 'HIGH', recommendedAction: 'Proceed to the next journey stage.', sensitive: false });
  const re = ctx.assets.filter((a) => a.category === 'REAL_ESTATE' && a.status === 'ACTIVE').reduce((s, a) => s + (a.value_mid ?? 0), 0);
  const tot = ctx.assets.filter((a) => a.status === 'ACTIVE' && a.ownership_scope !== 'FAMILY_LINKED').reduce((s, a) => s + (a.value_mid ?? 0), 0);
  if (tot && re / tot >= 0.7) out.push({ type: 'CONCENTRATION', title: `Real estate is ${Math.round((re / tot) * 100)}% of known assets (INR ${cr(re)})`, sourceKey: 'ASSETS', evidence: { reShare: re / tot }, eventDate: null, confidence: 'MEDIUM', recommendedAction: 'Offer a diversification review only if the client has raised diversification or declared it as an objective.', sensitive: false });
  return out;
}
