import { loadClient } from '@/lib/db/load-client';
import { loadIntelligence } from '@/lib/wealth/load-context';
import type { ClientAnalysis } from '@/lib/wealth/behavior-engine';
import { cr } from '@/lib/wealth/wealth-engine';
import { formatDateTime } from '@/lib/engines/normalize';
import { Panel, Empty, Stat } from '@/components/ui/panel';
import { Badge, ConfidenceBadge, EvidenceBadge } from '@/components/ui/badges';
import { runAnalyze } from '@/lib/actions-wealth';
import { ActionForm } from '@/components/ui/action-form';
import { EvidenceList, SectionCard } from '@/components/client360/analysis-cards';
import { SpendingChart } from '@/components/charts/spending-chart';

export default async function AnalyzePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await loadClient(id, 'analyze');
  const bundle = await loadIntelligence(db, id);
  const a = (bundle.latestAnalysis?.result as ClientAnalysis | undefined) ?? null;
  const diff = bundle.latestAnalysis?.diff as { first?: boolean; changes: Array<{ key: string; from: string; to: string }>; newRisks: string[]; resolvedRisks: string[]; newDataSets: string[] } | null;
  const { data: versions } = await db.from('client_analyses').select('version,computed_at,engine_version').eq('client_id', id).order('version', { ascending: false }).limit(10);
  const { data: anomalies } = await db.from('anomalies').select('*').eq('client_id', id).order('detected_at', { ascending: false });
  return (
    <div className="space-y-4">
      <Panel title="Analyze client" right={<ActionForm action={runAnalyze} resetOnSuccess={false}><input type="hidden" name="clientId" value={id} /><button className="btn btn-primary">{a ? 'Re-run analysis' : 'ANALYZE CLIENT'}</button></ActionForm>}>
        <p className="text-xs text-ink-400">Combines verified data, authorised data sets and client declarations into an evidence-based behavioural & financial profile. Behaviour is analysed from financial behaviour, finances from financial data, identity from reliable evidence. Human input never influences a score. Every conclusion shows its evidence class, confidence, basis and what is missing. Versioned and timestamped; each run is compared with the previous one.</p>
        {a ? (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-300">
            <span>Version <span className="mono text-ink-100">v{bundle.latestAnalysis?.version}</span></span>
            <span>Computed {formatDateTime(a.computedAt)}</span>
            <span>Engine {a.engineVersion}</span>
            <span>Data used: <span className="text-ink-100">{a.inputs.verifiedSources} verified sources</span>, {a.inputs.authorizedDataSets} authorised data sets, {a.inputs.declaredSources} client-declared sources, {a.inputs.humanContextItems} human-context items</span>
            <span className="text-emerald-300">Human-context influence on financial profile: NONE</span>
          </div>
        ) : null}
      </Panel>
      {!a ? (
        <Empty>No analysis yet. Click ANALYZE CLIENT to generate the first versioned profile.</Empty>
      ) : (
        <>
          {diff && !diff.first ? (
            <Panel title="What changed since the previous analysis">
              {diff.changes.length || diff.newRisks.length || diff.resolvedRisks.length || diff.newDataSets.length ? (
                <div className="grid gap-3 md:grid-cols-3 text-xs">
                  <div>
                    <div className="panel-title mb-1">Metrics changed</div>
                    {diff.changes.length ? diff.changes.map((c) => <div key={c.key} className="border-b border-white/[0.05] py-1"><span className="text-ink-300">{c.key}:</span> <span className="text-ink-400">{c.from}</span> <span className="text-ink-500">to</span> <span className="text-gold-300">{c.to}</span></div>) : <div className="text-ink-500">None</div>}
                  </div>
                  <div>
                    <div className="panel-title mb-1">Risks</div>
                    {diff.newRisks.map((r) => <div key={r} className="text-red-300">+ {r}</div>)}
                    {diff.resolvedRisks.map((r) => <div key={r} className="text-emerald-300">- {r}</div>)}
                    {!diff.newRisks.length && !diff.resolvedRisks.length ? <div className="text-ink-500">No change</div> : null}
                  </div>
                  <div>
                    <div className="panel-title mb-1">New data received</div>
                    {diff.newDataSets.length ? diff.newDataSets.map((d) => <div key={d} className="text-ink-200">{d}</div>) : <div className="text-ink-500">None</div>}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink-400">No material change versus the previous version.</p>
              )}
            </Panel>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <div className="panel p-3"><Stat label="Financial health" value={a.financialHealth.result.value} sub={<ConfidenceBadge level={a.financialHealth.result.confidence} />} /></div>
            <div className="panel p-3"><Stat label="Saving pattern" value={a.saving.result.value} sub={<ConfidenceBadge level={a.saving.result.confidence} />} /></div>
            <div className="panel p-3"><Stat label="Income stability" value={a.income.result.value.split(';')[0]} sub={<ConfidenceBadge level={a.income.result.confidence} />} /></div>
            <div className="panel p-3"><Stat label="Resilience" value={a.resilience.result.value} sub={<ConfidenceBadge level={a.resilience.result.confidence} />} /></div>
            <div className="panel p-3"><Stat label="Liquidity" value={a.liquidity.runwayMonths ? `${a.liquidity.runwayMonths[0]}-${a.liquidity.runwayMonths[1]} mo runway` : 'Insufficient data'} sub={<ConfidenceBadge level={a.liquidity.result.confidence} />} /></div>
            <div className="panel p-3"><Stat label="Verification confidence" value={a.reliability.verificationConfidence !== null ? `${a.reliability.verificationConfidence}%` : 'N/A'} sub="data-consistency score, not character" /></div>
          </div>

          <Panel title="AI executive profile" right={<Badge tone="muted">Every sentence cites its section</Badge>}>
            <ul className="space-y-2">
              {a.narrative.map((n, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink-100"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" /><span>{n.text} <span className="text-[10.5px] text-ink-500">[{n.evidence.join(', ')}]</span></span></li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-500">Neutral, professional language only. No claims about trustworthiness, intelligence, personality, health or any protected characteristic are generated.</p>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard s={a.financialHealth} />
            <SectionCard s={a.income} />
            <SectionCard s={a.saving} />
            <SectionCard s={{ ...a.investmentBehavior, result: { ...a.investmentBehavior.result, value: a.investmentBehavior.result.value.join(' - ') } }} />
            <SectionCard s={a.investmentExperience} />
            <SectionCard s={a.riskPreference} extra="Primarily from questionnaire / explicit declaration / verified investment choices. Never inferred from age, appearance, gender, occupation or social content." />
            <SectionCard s={a.resilience} />
            <SectionCard s={a.liquidity} />
            <SectionCard s={a.debtBehavior} />
            <SectionCard s={a.creditHealth} />
            <SectionCard s={{ ...a.concentration, result: { ...a.concentration.result, value: a.concentration.result.value.join(' - ') } }} />
          </div>

          {a.spending.monthly.length ? (
            <Panel title="Spending, saving & investment trends" right={<EvidenceBadge kind="AUTHORIZED_THIRD_PARTY" />}>
              <SpendingChart data={a.spending.monthly} />
              <p className="mt-2 text-sm text-ink-200">{a.spending.result.value}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{a.spending.categories.map((c) => <Badge key={c.key} tone="neutral">{c.key.replace(/_/g, ' ').toLowerCase()} {c.pct}%</Badge>)}</div>
              <p className="mt-2 text-[11px] text-ink-500">Categories describe financial behaviour only. No moral, social, religious or lifestyle judgement is derived from purchases.</p>
            </Panel>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-3">
            <Panel title="Financial persona" right={a.persona ? <ConfidenceBadge level={a.persona.confidence} /> : null}>
              {a.persona ? (
                <>
                  <div className="text-lg font-semibold text-gold-300">{a.persona.label}</div>
                  <p className="mt-1 text-sm text-ink-200">{a.persona.why}</p>
                  <EvidenceList items={a.persona.evidence} />
                  <p className="mt-2 text-xs text-ink-400">Alternative classification: {a.persona.alternative}</p>
                  <p className="mt-1 text-[11px] text-ink-500">Represents financial behaviour, not psychological personality.</p>
                </>
              ) : <p className="text-sm text-ink-400">Insufficient verified behaviour to classify.</p>}
            </Panel>
            <Panel title="Observed decision patterns">
              {a.decisionPatterns.length ? a.decisionPatterns.map((p) => (
                <div key={p.pattern} className="mb-2 border-b border-white/[0.05] pb-2 text-sm">
                  <div className="flex items-center justify-between"><span className="text-ink-100">{p.pattern}</span><ConfidenceBadge level={p.confidence} /></div>
                  <EvidenceList items={p.evidence} />
                </div>
              )) : <p className="text-sm text-ink-400">No measurable decision patterns yet.</p>}
              <p className="text-[11px] text-ink-500">Observed decision pattern followed by evidence. Never translated into psychological diagnoses.</p>
            </Panel>
            <Panel title="Financial priorities & interest map">
              {a.priorities.length ? a.priorities.map((p) => (
                <div key={p.label} className="mb-1.5 text-sm"><Badge tone={p.kind === 'CLIENT_DECLARED' ? 'declared' : 'derived'}>{p.kind.replace('_', ' ')}</Badge> <span className="ml-1 text-ink-100">{p.label}</span><div className="text-[11px] text-ink-500">{p.evidence.join('; ')}</div></div>
              )) : <p className="text-sm text-ink-400">No priorities declared or observed.</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">{a.interestMap.map((i) => <Badge key={i.category} tone={i.stance === 'INTERESTED' ? 'good' : i.stance === 'NOT_INTERESTED' ? 'bad' : 'muted'} title={i.basis}>{i.category.replace(/_/g, ' ')}</Badge>)}</div>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Panel title="Verification & reliability profile" right={a.reliability.verificationConfidence !== null ? <Badge tone="gold">{a.reliability.verificationConfidence}%</Badge> : null}>
              <table className="table"><tbody>{a.reliability.components.map((c) => <tr key={c.label}><td className="text-xs">{c.label}</td><td><Badge tone={['High', 'Strong'].includes(c.level) ? 'good' : c.level === 'Medium' ? 'info' : c.level === 'Pending' ? 'warn' : c.level === 'Not available' ? 'muted' : 'bad'}>{c.level}</Badge></td><td className="text-[11px] text-ink-500">{c.basis}</td></tr>)}</tbody></table>
              <p className="mt-2 text-[11px] text-ink-500">{a.reliability.statement}</p>
            </Panel>
            <Panel title="Client engagement profile">
              <dl className="kv text-sm">
                <dt>Channel</dt><dd>{a.engagement.channel ?? 'Not observed'}</dd>
                <dt>Format</dt><dd>{a.engagement.format ?? 'Not observed'}</dd>
                <dt>Depth</dt><dd>{a.engagement.depth ?? 'Not observed'}</dd>
                <dt>Responsiveness</dt><dd>{a.engagement.responsiveness ?? 'Not observed'}</dd>
              </dl>
              <EvidenceList items={a.engagement.basis} />
              {a.engagement.decisionJourney.length ? <div className="mt-2 text-xs text-ink-300">Decision journey: {a.engagement.decisionJourney.join(' -> ')}</div> : null}
              <p className="mt-1 text-[11px] text-ink-500">Based on actual interactions, not personality stereotypes.</p>
            </Panel>
            <Panel title="Unverified human context" right={<Badge tone="warn">Not fact</Badge>}>
              <p className="text-xs text-amber-300">{a.humanContext.statement}</p>
              <ul className="mt-2 space-y-1 text-xs">{a.humanContext.items.map((h) => <li key={h.id} className="rounded border border-dashed border-amber-400/30 p-2"><Badge tone="warn">{h.sourceType.replace(/_/g, ' ')}</Badge> <Badge tone="muted">{h.status.replace(/_/g, ' ')}</Badge> <span className="text-ink-200">{h.summary}</span>{h.verifiable ? <span className="ml-1 text-gold-300">verifiable</span> : null}</li>)}</ul>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Panel title="Risks requiring review" right={<Badge tone={a.risksRequiringReview.length ? 'warn' : 'good'}>{a.risksRequiringReview.length}</Badge>}>
              <ul className="space-y-1 text-sm">{a.risksRequiringReview.map((r) => <li key={r} className="text-ink-200">{r}</li>)}</ul>
              {anomalies?.length ? <><div className="panel-title mt-3 mb-1">Anomalies detected - review required</div><ul className="space-y-1 text-xs">{anomalies.map((x) => <li key={x.id}><Badge tone={x.severity === 'HIGH' ? 'bad' : 'warn'}>{x.anomaly_type.replace(/_/g, ' ')}</Badge> <span className="text-ink-300">{x.detail}</span></li>)}</ul></> : null}
            </Panel>
            <Panel title="Missing information" right={<Badge tone="muted">{a.missing.length}</Badge>}>
              <ul className="space-y-1 text-sm">{a.missing.map((m) => <li key={m} className="text-ink-300">{m}</li>)}</ul>
              <p className="mt-2 text-[11px] text-ink-500">Absence of data is never treated as negative.</p>
            </Panel>
            <Panel title="Significant financial events">
              <ul className="space-y-1 text-xs">{a.significantEvents.map((e, i) => <li key={i} className="flex justify-between gap-2 border-b border-white/[0.05] py-1"><span className="text-ink-200">{e.date} {e.title}</span><span className="flex items-center gap-1 text-ink-400">{e.amount ? cr(e.amount) : ''}<EvidenceBadge kind={e.evidenceClass} short /></span></li>)}</ul>
            </Panel>
          </div>
          <Panel title="Analysis versions">
            <ul className="flex flex-wrap gap-2 text-xs">{versions?.map((v) => <li key={v.version} className="rounded border border-white/10 px-2 py-1"><span className="mono text-gold-300">v{v.version}</span> <span className="text-ink-400">{formatDateTime(v.computed_at)}</span></li>)}</ul>
          </Panel>
        </>
      )}
    </div>
  );
}
