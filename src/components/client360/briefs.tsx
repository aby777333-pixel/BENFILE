import Link from 'next/link';
import type { buildBriefs } from '@/lib/wealth/approach-engine';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badges';
import { PrintButton } from './print-button';

type B = ReturnType<typeof buildBriefs>;

export function Briefs({ briefs, active, base }: { briefs: B; active: string; base: string }) {
  const tabs: Array<[string, string]> = [['30s', '30-second brief'], ['2min', '2-minute brief'], ['full', 'Full briefing'], ['aif', 'Prepare AIF meeting'], ['property', 'Prepare property meeting']];
  return (
    <Panel title="Prepare me for meeting" right={<div className="flex items-center gap-2"><div className="no-print flex gap-1">{tabs.map(([k, l]) => <Link key={k} href={`${base}?brief=${k}`} className={`rounded border px-2 py-1 text-[11px] ${active === k ? 'border-gold-500/40 text-gold-300' : 'border-white/10 text-ink-300'}`}>{l}</Link>)}</div><PrintButton /></div>}>
      {active === '30s' ? <ul className="space-y-1 text-sm">{briefs.thirtySecond.map((l, i) => <li key={i} className="text-ink-100">{l}</li>)}</ul> : null}
      {active === '2min' ? <ul className="space-y-1.5 text-sm">{briefs.twoMinute.map((l, i) => <li key={i} className="text-ink-100">{l}</li>)}</ul> : null}
      {active === 'full' ? (
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <Block title="Who" items={[briefs.full.who]} />
          <Block title="Relationship" items={[`${briefs.full.relationship.level}: ${briefs.full.relationship.basis.join(', ')}`]} />
          <Block title="Financial position" items={[briefs.full.financialPosition]} />
          <Block title="Business interests" items={briefs.full.businessInterests} />
          <Block title="Investments" items={briefs.full.investments} />
          <Block title="Risk profile" items={[briefs.full.riskProfile]} />
          <Block title="Current opportunities" items={briefs.full.opportunities.map((o) => `${o.label} (${o.classification.replace(/_/g, ' ').toLowerCase()})`)} />
          <Block title="Previous discussions" items={briefs.full.previousDiscussions} />
          <Block title="Objections" items={briefs.full.objections} />
          <Block title="Pending actions / commitments" items={briefs.full.pendingActions} />
          <Block title="Recommended approach" items={[briefs.full.recommendedApproach.lead, ...briefs.full.recommendedApproach.focus.map((f) => `Focus: ${f}`)]} />
          <Block title="Meeting objective" items={[briefs.full.meetingObjective]} />
          <Block title="Questions" items={briefs.full.questions} />
          <Block title="Evidence to bring" items={briefs.full.evidenceToBring} />
          <Block title="Data gaps" items={briefs.full.dataGaps} />
        </div>
      ) : null}
      {active === 'aif' ? (
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <Block title="Investor snapshot" items={[briefs.aifBrief.snapshot]} />
          <Block title="Known portfolio" items={briefs.aifBrief.knownPortfolio.map((c) => `${c.label} ${c.pct}% (${c.verifiedPct}% verified)`)} />
          <Block title="Liquidity" items={[briefs.aifBrief.liquidity]} />
          <Block title="Property exposure" items={[briefs.aifBrief.propertyExposure]} />
          <Block title="Investment experience" items={[briefs.aifBrief.experience]} />
          <Block title="Client-declared objectives" items={briefs.aifBrief.declaredObjectives} />
          <Block title="Risk-profile status" items={[briefs.aifBrief.riskProfileStatus]} />
          <Block title="Existing AIF / PMS exposure" items={briefs.aifBrief.existingAifPms} />
          <Block title="Potential portfolio gap" items={[briefs.aifBrief.portfolioGap ?? 'Not assessable']} />
          <Block title="Suitability information still required" items={briefs.aifBrief.suitabilityRequired} tone="warn" />
          <Block title="Questions to ask" items={briefs.aifBrief.questions} />
          <Block title="Relevant funds" items={briefs.aifBrief.fundsRelevant.map((f) => `${f.name}: ${f.why}`)} />
          <Block title="Risks to explain" items={briefs.aifBrief.risksToExplain} />
          <Block title="Documents to bring" items={briefs.aifBrief.documents} />
          <Block title="Recommended next step" items={[`${briefs.aifBrief.nextStep.action} - ${briefs.aifBrief.nextStep.reason}`]} />
        </div>
      ) : null}
      {active === 'property' ? (
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <Block title="Buyer / investor type" items={[briefs.propertyBrief.buyerType]} />
          <Block title="Budget" items={[briefs.propertyBrief.budget]} />
          <Block title="Location preferences" items={briefs.propertyBrief.locations} />
          <Block title="Known property holdings" items={briefs.propertyBrief.holdings} />
          <Block title="Previous enquiries" items={briefs.propertyBrief.previousEnquiries} />
          <Block title="Preferences" items={briefs.propertyBrief.preferences} />
          <Block title="Observed behaviour" items={briefs.propertyBrief.behaviour} />
          <Block title="Documents to show" items={briefs.propertyBrief.documentsToShow} />
          <Block title="Questions to ask" items={briefs.propertyBrief.questions} />
          <Block title="Site visit" items={[briefs.propertyBrief.siteVisitAdvised ? 'Advised - see Property tab for recommended projects and plots' : 'Not yet advised']} />
          <Block title="Next action" items={[`${briefs.propertyBrief.nextStep.action} - ${briefs.propertyBrief.nextStep.reason}`]} />
        </div>
      ) : null}
      <p className="mt-3 text-[11px] text-ink-500">Briefs are assembled from structured, authorised data only. <Badge tone="muted">printable</Badge></p>
    </Panel>
  );
}

function Block({ title, items, tone }: { title: string; items: string[]; tone?: 'warn' }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-ink-900 p-3">
      <div className="panel-title mb-1">{title}</div>
      {items.length ? <ul className={`space-y-0.5 text-xs ${tone === 'warn' ? 'text-amber-200' : 'text-ink-200'}`}>{items.map((i, k) => <li key={k}>{i}</li>)}</ul> : <div className="text-xs text-ink-500">None recorded</div>}
    </div>
  );
}
