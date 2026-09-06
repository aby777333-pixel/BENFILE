import Link from 'next/link';
import { loadClient } from '@/lib/db/load-client';
import { loadIntelligence } from '@/lib/wealth/load-context';
import { analyzeClient, type ClientAnalysis } from '@/lib/wealth/behavior-engine';
import { buildBriefs, type ApproachStrategy } from '@/lib/wealth/approach-engine';
import { cr } from '@/lib/wealth/wealth-engine';
import { formatDate, formatDateTime } from '@/lib/engines/normalize';
import { hasPermission } from '@/lib/security/permissions';
import { Panel, Empty, Stat } from '@/components/ui/panel';
import { Badge, ConfidenceBadge, RelevanceBadge, StatusBadge } from '@/components/ui/badges';
import { ActionForm } from '@/components/ui/action-form';
import { createTaskFromAction, runApproach, updateAifSuitability } from '@/lib/actions-wealth';
import { EvidenceList } from '@/components/client360/analysis-cards';
import { Briefs } from '@/components/client360/briefs';
import { AifJourney, SuitabilityForm } from '@/components/client360/aif-journey';

const OBJECTIVES: Array<[string, string]> = [['BOTH', 'AIF + Property (both verticals)'], ['AIF', 'AIF investment introduction'], ['PROPERTY', 'Land / plotted layout'], ['DISCOVERY', 'Discovery conversation'], ['WEALTH_MANAGEMENT', 'Wealth management'], ['ESTATE_PLANNING', 'Estate / succession planning'], ['INSURANCE', 'Insurance'], ['LOAN', 'Loan / credit product'], ['OTHER', 'Other']];

export default async function ApproachPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ brief?: string }> }) {
  const { id } = await params;
  const { brief } = await searchParams;
  const { db, role, c360 } = await loadClient(id, 'approach');
  const bundle = await loadIntelligence(db, id);
  const s = (bundle.latestStrategy?.result as ApproachStrategy | undefined) ?? null;
  const a = (bundle.latestAnalysis?.result as ClientAnalysis | undefined) ?? analyzeClient(bundle.ctx);
  const { data: triggers } = await db.from('opportunity_triggers').select('*').eq('client_id', id).eq('status', 'OPEN').order('event_date');
  const canApprove = hasPermission(role, 'risk:escalate');
  const canCapture = hasPermission(role, 'investor:capture');
  const staffOpts = c360.staff;
  return (
    <div className="space-y-4">
      <Panel title="Recommend business approach" right={<span className="text-[11px] text-ink-400">Relevance, suitability, clarity, timing, evidence - never pressure</span>}>
        <ActionForm action={runApproach} resetOnSuccess={false} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="clientId" value={id} />
          <label className="text-xs"><span className="label">Commercial objective</span><select name="objective" className="input w-72" defaultValue={s?.objective ?? 'BOTH'}>{OBJECTIVES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <button className="btn btn-primary">{s ? 'Re-run approach engine' : 'RECOMMEND BUSINESS APPROACH'}</button>
          {!bundle.latestAnalysis ? <span className="text-xs text-amber-300">Run Analyze Client first for the best result (a transient analysis is used otherwise).</span> : null}
        </ActionForm>
        {s ? <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-300"><span>v{bundle.latestStrategy?.version} - {formatDateTime(s.computedAt)}</span><span>Objective <span className="text-ink-100">{s.objective}</span></span><span>Mode <span className="text-ink-100">{s.mode.replace(/_/g, ' ').toLowerCase()}</span></span><span>Playbook <span className="text-ink-100">{s.playbook}</span></span><span>Approach confidence <ConfidenceBadge level={s.approachConfidence} /></span></div> : null}
      </Panel>

      {!s ? <Empty>No strategy yet. Choose the commercial objective and run the engine.</Empty> : (
        <>
          {s.contactPressure.warning ? <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-red-200">{s.contactPressure.warning}</div> : null}
          {s.mode === 'FIRST_TIME_DISCOVERY' ? <div className="rounded-lg border border-gold-500/40 bg-gold-500/10 p-3 text-sm text-gold-200">Insufficient information to personalise the approach. Conduct a discovery conversation first; do not pitch.</div> : null}

          {/* Business opportunity dashboard */}
          <div className="grid gap-4 xl:grid-cols-3">
            <Panel title="AIF" right={<RelevanceBadge level={s.aif.relevance} />}>
              <dl className="kv text-sm">
                <dt>Relevance</dt><dd><RelevanceBadge level={s.aif.relevance} /> <span className="mono text-ink-400">{s.aif.confidence}% conf</span></dd>
                <dt>Suitability status</dt><dd><StatusBadge status={s.products[0].suitabilityStatus} /></dd>
                <dt>Journey stage</dt><dd className="mono text-xs">{s.aif.journeyStage.replace(/_/g, ' ').toLowerCase()}</dd>
                <dt>Potential range</dt><dd>{bundle.ctx.aifSuitability?.expected_amount ? `Expected INR ${cr(bundle.ctx.aifSuitability.expected_amount)} (client stated)` : 'Not established - never inferred from wealth'}</dd>
              </dl>
              <details className="mt-2 text-xs"><summary className="cursor-pointer text-gold-300">Why this rating?</summary><EvidenceList items={s.aif.reasons} /><div className="mt-1 text-ink-500">Evidence: {s.aif.evidence.join('; ') || 'none'}</div><div className="mt-1 text-ink-500">What would change it: {s.aif.whatWouldChange.join('; ')}</div></details>
              {s.aif.missing.length ? <div className="mt-2 flex flex-wrap gap-1">{s.aif.missing.map((m) => <Badge key={m} tone="muted">needed: {m}</Badge>)}</div> : null}
              {s.aif.portfolioGap ? <p className="mt-2 text-xs text-ink-300">{s.aif.portfolioGap}</p> : null}
              {s.aif.fundsRelevant.length ? <div className="mt-2 text-xs"><div className="panel-title mb-1">Funds potentially relevant</div>{s.aif.fundsRelevant.map((f) => <div key={f.id} className="mb-1 rounded border border-white/[0.06] p-2"><div className="text-ink-100">{f.name}</div><div className="text-ink-400">{f.why}</div>{f.concerns.map((c) => <div key={c} className="text-amber-300">{c}</div>)}</div>)}</div> : null}
            </Panel>
            <Panel title="Property" right={<RelevanceBadge level={s.property.relevance} />}>
              <dl className="kv text-sm">
                <dt>Relevance</dt><dd><RelevanceBadge level={s.property.relevance} /> <span className="mono text-ink-400">{s.property.confidence}% conf</span></dd>
                <dt>Buyer type</dt><dd>{s.property.buyerType.replace(/_/g, ' ')} <span className="text-[11px] text-ink-500">{s.property.buyerTypeBasis}</span></dd>
                <dt>Budget</dt><dd>{bundle.ctx.propertyPreferences?.budget_max ? `${bundle.ctx.propertyPreferences.budget_min ? cr(bundle.ctx.propertyPreferences.budget_min) + ' - ' : ''}${cr(bundle.ctx.propertyPreferences.budget_max)} (declared)` : 'Not declared'}</dd>
                <dt>Locations</dt><dd>{bundle.ctx.propertyPreferences?.cities.join(', ') || 'Not declared'}</dd>
                <dt>Site visit</dt><dd>{s.property.siteVisitAdvised ? <Badge tone="good">Advised</Badge> : <Badge tone="muted">Not yet</Badge>} <span className="text-[11px] text-ink-500">{bundle.siteVisits} recorded</span></dd>
              </dl>
              <details className="mt-2 text-xs"><summary className="cursor-pointer text-gold-300">Why this rating?</summary><EvidenceList items={s.property.reasons} /><div className="mt-1 text-ink-500">Evidence: {s.property.evidence.join('; ') || 'none'}</div></details>
              {s.property.behaviourLabels.length ? <div className="mt-2 flex flex-wrap gap-1">{s.property.behaviourLabels.map((b) => <Badge key={b} tone="derived">{b}</Badge>)}</div> : null}
              {s.property.missing.length ? <div className="mt-2 flex flex-wrap gap-1">{s.property.missing.map((m) => <Badge key={m} tone="muted">needed: {m}</Badge>)}</div> : null}
              <Link href={`/clients/${id}/property`} className="mt-2 inline-block text-xs text-gold-300">Recommended projects & plots</Link>
            </Panel>
            <div className="space-y-4">
              <Panel title="Landowner" right={<Badge tone={s.landowner.relevant ? 'good' : 'muted'}>{s.landowner.relevant ? 'Relevant' : 'Not relevant'}</Badge>}>
                <p className="text-sm text-ink-200">{s.landowner.note}</p>
              </Panel>
              <Panel title="Recommended next best action" right={<ConfidenceBadge level={s.nextBestAction.confidence} />}>
                <div className="text-base font-semibold text-gold-300">{s.nextBestAction.action}</div>
                <p className="mt-1 text-sm text-ink-200">{s.nextBestAction.reason}</p>
                <EvidenceList items={s.nextBestAction.evidence} />
                <ActionForm action={createTaskFromAction} className="mt-2 flex gap-1">
                  <input type="hidden" name="clientId" value={id} />
                  <input type="hidden" name="title" value={s.nextBestAction.action} />
                  <input type="hidden" name="source" value="NEXT_BEST_ACTION" />
                  <input type="hidden" name="reason" value={s.nextBestAction.reason} />
                  <input name="dueAt" type="date" className="input w-36 py-1 text-xs" />
                  <button className="btn btn-sm btn-primary">Create follow-up task</button>
                </ActionForm>
              </Panel>
            </div>
          </div>

          <Panel title="Client opportunity matrix" right={<span className="text-[11px] text-ink-400">Every rating explained</span>}>
            <table className="table"><thead><tr><th>Vertical</th><th>Relevance</th><th>Why</th></tr></thead><tbody>{s.matrix.map((m) => <tr key={m.key}><td className="font-medium">{m.label}</td><td><RelevanceBadge level={m.relevance} /></td><td className="text-xs text-ink-300">{m.why}</td></tr>)}</tbody></table>
            {s.concentrationWarnings.length ? <div className="mt-2 text-xs text-amber-300">Concentration check: {s.concentrationWarnings.join('; ')}. Warn before cross-selling; do not automatically recommend selling existing property.</div> : null}
            {s.capitalAllocation.length ? <div className="mt-2 flex flex-wrap gap-1">{s.capitalAllocation.map((c) => <Badge key={c.label} tone="neutral">{c.label} {c.pct}%</Badge>)}</div> : null}
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Client approach summary">
              <p className="text-sm text-ink-100">{s.summary.lead}</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 text-xs">
                <div><div className="panel-title mb-1">Focus the first conversation on</div><ul className="space-y-0.5 text-ink-200">{s.summary.focus.map((f) => <li key={f}>- {f}</li>)}</ul></div>
                <div><div className="panel-title mb-1">Avoid</div><ul className="space-y-0.5 text-red-200">{s.summary.avoid.map((f) => <li key={f}>- {f}</li>)}</ul></div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">{s.summary.meetingStyle.map((m) => <Badge key={m} tone="gold">{m}</Badge>)}</div>
              <p className="mt-2 text-xs text-ink-300"><span className="text-ink-100">Suggested next step:</span> {s.summary.nextStep}</p>
              <details className="mt-2 text-xs"><summary className="cursor-pointer text-gold-300">Why this approach?</summary><EvidenceList items={s.whyThisApproach} /></details>
            </Panel>
            <Panel title="First-conversation strategy">
              <p className="text-sm text-ink-100"><span className="text-ink-400">Opening: </span>{s.firstConversation.opening}</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 text-xs">
                <div><div className="panel-title mb-1">Questions to ask</div><ul className="space-y-0.5 text-ink-200">{s.firstConversation.questions.map((q) => <li key={q}>- {q}</li>)}</ul></div>
                <div><div className="panel-title mb-1">Evidence to bring</div><ul className="space-y-0.5 text-ink-200">{s.firstConversation.evidenceToBring.map((q) => <li key={q}>- {q}</li>)}</ul></div>
              </div>
              <div className="mt-2 text-xs"><div className="panel-title mb-1">Objection preparation</div>{s.firstConversation.likelyObjections.length ? s.firstConversation.likelyObjections.map((o) => <div key={o.concern} className="mb-1 rounded border border-white/[0.06] p-2"><div className="text-ink-100">{o.concern}</div><div className="text-ink-400">Why it may matter: {o.whyItMatters}</div><div className="text-emerald-300">Response: {o.response}</div></div>) : <span className="text-ink-500">No concerns recorded yet.</span>}</div>
              <p className="mt-2 text-xs text-ink-300"><span className="text-ink-100">Next-step objective:</span> {s.firstConversation.nextStepObjective}</p>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-4">
            <Panel title="Channel & format"><dl className="kv text-sm"><dt>Channel</dt><dd>{s.channel.recommended}</dd><dt>Format</dt><dd>{s.channel.format}</dd><dt>Depth</dt><dd>{s.channel.depth}</dd></dl><p className="mt-2 text-[11px] text-ink-500">{s.channel.reason}</p></Panel>
            <Panel title="Motivations & concerns">{s.motivations.map((m) => <div key={m.label} className="mb-1 text-sm"><Badge tone={m.kind === 'CLIENT_DECLARED' ? 'declared' : 'derived'}>{m.kind.replace('_', ' ')}</Badge> <span className="text-ink-100">{m.label}</span><div className="text-[11px] text-ink-500">{m.evidence}</div></div>)}<div className="mt-2 flex flex-wrap gap-1">{s.concerns.map((c) => <Badge key={c} tone="warn">{c}</Badge>)}</div>{!s.motivations.length && !s.concerns.length ? <p className="text-sm text-ink-400">Nothing declared or observed.</p> : null}</Panel>
            <Panel title="Timing & triggers">{s.timing.length ? <ul className="space-y-0.5 text-xs text-ink-200">{s.timing.map((t) => <li key={t}>- {t}</li>)}</ul> : <p className="text-sm text-ink-400">No timing signals.</p>}{triggers?.length ? <div className="mt-2 space-y-1 text-xs">{triggers.map((t) => <div key={t.id} className={`rounded border p-2 ${t.sensitive ? 'border-danger/30' : 'border-white/[0.06]'}`}><div className="flex items-center justify-between"><span className="text-ink-100">{t.title}</span><ConfidenceBadge level={t.confidence} /></div><div className="text-ink-400">{t.recommended_action}</div><div className="text-ink-500">Source {t.source_key}{t.event_date ? ` - ${formatDate(t.event_date)}` : ''}{t.sensitive ? ' - sensitive: do not initiate contact' : ''}</div></div>)}</div> : null}</Panel>
            <Panel title="Interest memory & engagement"><div className="text-xs"><div className="text-emerald-300">Interested: {s.interestMemory.interested.join(', ') || '-'}</div><div className="text-red-300">Not interested: {s.interestMemory.notInterested.join(', ') || '-'}</div><div className="text-ink-400">Unknown: {s.interestMemory.unknown.join(', ')}</div></div><div className="mt-2 text-sm"><Badge tone={s.relationshipEngagement.level === 'ACTIVE' ? 'good' : s.relationshipEngagement.level === 'DORMANT' ? 'warn' : 'neutral'}>Relationship engagement: {s.relationshipEngagement.level}</Badge></div><EvidenceList items={s.relationshipEngagement.basis} /><div className="mt-2 flex gap-1 text-[11px]"><Badge tone="muted">AIF score {s.scores.aif ?? 'n/a'}</Badge><Badge tone="muted">Property {s.scores.property ?? 'n/a'}</Badge><Badge tone="muted">Engagement {s.scores.engagement ?? 'n/a'}</Badge></div></Panel>
          </div>

          <Panel title="Product relevance (suitability-aware)">
            <table className="table"><thead><tr><th>Product</th><th>Relevance</th><th>Suitability</th><th>Reason</th></tr></thead><tbody>{s.products.map((p) => <tr key={p.product}><td className="font-medium">{p.product}</td><td><RelevanceBadge level={p.relevance} /></td><td><StatusBadge status={p.suitabilityStatus} /></td><td className="text-xs text-ink-300">{p.reason}</td></tr>)}</tbody></table>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{s.opportunities.map((o) => <div key={o.key} className="rounded border border-white/[0.06] p-2 text-xs"><div className="flex items-center justify-between"><span className="text-ink-100">{o.label}</span><Badge tone={o.classification === 'VERIFIED_NEED' ? 'good' : o.classification === 'CLIENT_DECLARED_INTEREST' ? 'declared' : o.classification === 'POTENTIAL_OPPORTUNITY' ? 'info' : 'muted'}>{o.classification.replace(/_/g, ' ')}</Badge></div><div className="text-ink-400">{o.why}</div></div>)}</div>
            <p className="mt-2 text-[11px] text-ink-500">Products are never recommended because they generate more revenue. Suitability takes priority.</p>
          </Panel>

          <Briefs briefs={buildBriefs(bundle.ctx, a, s)} active={brief ?? '2min'} base={`/clients/${id}/approach`} />

          <div className="grid gap-4 xl:grid-cols-2">
            <AifJourney suit={bundle.ctx.aifSuitability} funds={bundle.funds} rules={bundle.rules} />
            {canCapture ? <SuitabilityForm clientId={id} suit={bundle.ctx.aifSuitability} funds={bundle.funds} canApprove={canApprove} staff={staffOpts} action={updateAifSuitability} /> : null}
          </div>
          <Panel title="Data gaps to close before any recommendation"><div className="flex flex-wrap gap-1">{s.dataGaps.map((g) => <Badge key={g} tone="muted">{g}</Badge>)}{!s.dataGaps.length ? <span className="text-sm text-ink-400">None.</span> : null}</div></Panel>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="panel p-3"><Stat label="Contacts (7 days)" value={s.contactPressure.contacts7d} tone={s.contactPressure.warning ? 'bad' : undefined} /></div>
            <div className="panel p-3"><Stat label="Marketing permission" value={s.contactPressure.marketingPermission ? 'Yes' : 'No'} /></div>
            <div className="panel p-3"><Stat label="Do not contact" value={s.contactPressure.doNotContact ? 'YES' : 'No'} tone={s.contactPressure.doNotContact ? 'bad' : 'good'} /></div>
            <div className="panel p-3"><Stat label="Approach confidence" value={s.approachConfidence} sub={s.confidenceBasis.join(' - ')} /></div>
          </div>
        </>
      )}
    </div>
  );
}
