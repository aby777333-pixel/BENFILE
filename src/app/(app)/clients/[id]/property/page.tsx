import Link from 'next/link';
import { loadClient } from '@/lib/db/load-client';
import { loadIntelligence } from '@/lib/wealth/load-context';
import { matchProjects } from '@/lib/wealth/matching-engine';
import { cr } from '@/lib/wealth/wealth-engine';
import { formatDateTime } from '@/lib/engines/normalize';
import { hasPermission } from '@/lib/security/permissions';
import type { DdItemRow, PlotRow, ProjectRow } from '@/lib/wealth/types';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, EvidenceBadge, StatusBadge } from '@/components/ui/badges';
import { ActionForm } from '@/components/ui/action-form';
import { holdPlot, saveLandowner, savePropertyPreferences, scheduleSiteVisit, siteVisitFeedback } from '@/lib/actions-wealth';
import { PreferencesForm, SiteVisitForm, FeedbackForm, LandownerForm } from '@/components/client360/property-forms';

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, role, c360 } = await loadClient(id, 'property');
  const bundle = await loadIntelligence(db, id);
  const [{ data: projects }, { data: plots }, { data: dd }, { data: interests }, { data: visits }, { data: landowner }] = await Promise.all([
    db.from('projects').select('*').eq('status', 'ACTIVE'),
    db.from('plots').select('*'),
    db.from('property_due_diligence').select('project_id,item_key,status,finding'),
    db.from('plot_interest').select('plot_id,stance,source,reason').eq('client_id', id),
    db.from('site_visits').select('*').eq('client_id', id).order('created_at', { ascending: false }),
    db.from('landowner_profiles').select('*').eq('client_id', id).maybeSingle(),
  ]);
  const minDd = (bundle.rules['property.min_dd_items'] as string[] | undefined) ?? [];
  const numericPlots = ((plots ?? []) as PlotRow[]).map((p) => ({ ...p, area_sqft: Number(p.area_sqft), price: p.price === null ? null : Number(p.price), negotiated_price: p.negotiated_price === null ? null : Number(p.negotiated_price) }));
  const projRows = ((projects ?? []) as ProjectRow[]).map((p) => ({ ...p, price_per_sqft: p.price_per_sqft === null ? null : Number(p.price_per_sqft), guideline_value_per_sqft: p.guideline_value_per_sqft === null ? null : Number(p.guideline_value_per_sqft) }));
  const matches = matchProjects({ prefs: bundle.ctx.propertyPreferences, projects: projRows, plots: numericPlots, dd: (dd ?? []) as DdItemRow[], holdings: bundle.ctx.assets, enquiredPlotIds: new Set((interests ?? []).map((i) => i.plot_id)), minimumDdItems: minDd, maxPlotsPerProject: 4 });
  const pp = bundle.ctx.propertyPreferences;
  const canWrite = hasPermission(role, 'notes:write');
  const canHold = hasPermission(role, 'clients:write');
  const plotById = new Map(numericPlots.map((p) => [p.id, p]));
  const projById = new Map(projRows.map((p) => [p.id, p]));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Property investment profile" className="xl:col-span-2" right={pp ? <Badge tone="declared">{pp.buyer_type.replace(/_/g, ' ')}</Badge> : <Badge tone="muted">No requirements</Badge>}>
          {pp ? (
            <dl className="kv text-sm">
              <dt>Buyer type</dt><dd>{pp.buyer_type.replace(/_/g, ' ')} <span className="text-[11px] text-ink-500">{pp.buyer_type_basis ?? 'basis not stated'}</span></dd>
              <dt>Purpose</dt><dd>{pp.purpose ?? 'Not stated'}</dd>
              <dt>Budget</dt><dd>{pp.budget_max ? `${pp.budget_min ? 'INR ' + cr(pp.budget_min) + ' - ' : 'up to INR '}${cr(pp.budget_max)}` : 'Not declared'} {pp.field_evidence?.budget ? <EvidenceBadge kind={pp.field_evidence.budget.evidence_class} short /> : null}</dd>
              <dt>Locations</dt><dd>{[...pp.cities, ...pp.localities].join(', ') || 'Not declared'}</dd>
              <dt>Property types</dt><dd>{pp.property_types.join(', ') || '-'}</dd>
              <dt>Plot size</dt><dd>{pp.plot_size_min_sqft ?? '?'} - {pp.plot_size_max_sqft ?? '?'} sq ft</dd>
              <dt>Facing / road</dt><dd>{pp.facing.join('/') || 'any'} / {pp.road_width_min_ft ? `>= ${pp.road_width_min_ft} ft` : 'any'}{pp.corner_preferred ? ' - corner preferred' : ''}</dd>
              <dt>Approval required</dt><dd>{pp.approval_required ? 'Yes' : 'No'}</dd>
              <dt>Proximity</dt><dd>{pp.proximity.join(', ') || '-'}</dd>
              <dt>Horizon / financing</dt><dd>{pp.horizon ?? '-'} / {pp.financing ?? '-'}</dd>
              <dt>Declared</dt><dd>{pp.declared_at ? <Badge tone="declared">Client declared {formatDateTime(pp.declared_at)}</Badge> : <Badge tone="gold">Analyst provided</Badge>}</dd>
            </dl>
          ) : <Empty>No property requirements yet. Capture them below or via the client portal. Never invent preferences the client has not expressed.</Empty>}
          <div className="mt-3 text-xs text-ink-300">Existing property holdings: {bundle.ctx.assets.filter((a) => a.category === 'REAL_ESTATE' && a.status === 'ACTIVE').map((a) => `${a.title} (${a.evidence_class.replace(/_/g, ' ').toLowerCase()})`).join('; ') || 'none recorded'}</div>
        </Panel>
        {canWrite ? <Panel title="Capture / update requirements"><PreferencesForm clientId={id} pp={pp} action={savePropertyPreferences} /></Panel> : null}
      </div>

      <Panel title="Recommended property opportunities" right={<span className="text-[11px] text-ink-400">Why it matches + possible concerns, every time</span>}>
        {matches.length ? (
          <div className="space-y-3">
            {matches.map((m) => (
              <div key={m.project.id} className={`rounded-lg border p-3 ${m.ddScore.overall === 'BLOCKED' ? 'border-danger/40' : m.score >= 60 ? 'border-verified/30' : 'border-white/[0.07]'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><Link href={`/inventory/${m.project.id}`} className="text-base font-semibold text-ink-100 hover:underline">{m.project.name}</Link><Badge tone={m.score >= 60 ? 'good' : m.score >= 40 ? 'info' : 'muted'}>match {m.score}%</Badge><Badge tone={m.ddScore.overall === 'READY' ? 'good' : m.ddScore.overall === 'REVIEW' ? 'warn' : m.ddScore.overall === 'BLOCKED' ? 'bad' : 'muted'}>DD {m.ddScore.overall}</Badge>{m.project.approval_status === 'APPROVED' ? <Badge tone="good">{m.project.approval_authority} approved</Badge> : <Badge tone="warn">approval {m.project.approval_status ?? 'unknown'}</Badge>}{m.recommendSiteVisit ? <Badge tone="gold">Site visit recommended</Badge> : null}</div>
                    <div className="text-xs text-ink-400">{m.project.locality ? `${m.project.locality}, ` : ''}{m.project.city} - {m.project.total_area_acres ?? '?'} acres - {m.availablePlots} available plot(s) - INR {m.project.price_per_sqft ?? '?'}/sq ft (guideline {m.project.guideline_value_per_sqft ?? '?'})</div>
                    {m.project.thesis ? <div className="text-xs text-ink-300">Investment thesis: {m.project.thesis}</div> : null}
                  </div>
                </div>
                <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                  <div><div className="panel-title mb-1">Why this project matches</div><ul className="space-y-0.5 text-emerald-200">{m.why.map((w) => <li key={w}>+ {w}</li>)}</ul></div>
                  <div><div className="panel-title mb-1">Possible concerns</div><ul className="space-y-0.5 text-amber-200">{m.concerns.length ? m.concerns.map((w) => <li key={w}>- {w}</li>) : <li className="text-ink-500">None identified</li>}</ul></div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-[11px]">{m.project.infrastructure.map((i) => <Badge key={i.name} tone={i.status === 'EXISTING' ? 'good' : i.status === 'UNDER_CONSTRUCTION' ? 'info' : 'warn'}>{i.name} - {i.status.replace(/_/g, ' ').toLowerCase()}{i.distance_km ? ` ${i.distance_km} km` : ''}</Badge>)}</div>
                {m.plots.length ? (
                  <table className="table mt-2"><thead><tr><th>Plot</th><th>Size</th><th>Facing / road</th><th>Price</th><th>Match</th><th>Why</th><th>Concerns</th><th></th></tr></thead><tbody>{m.plots.map((p) => <tr key={p.plot.id}><td className="mono">#{p.plot.plot_number}{p.plot.corner ? ' corner' : ''}{p.plot.park_facing ? ' park' : ''}</td><td>{p.plot.area_sqft} sq ft{p.plot.width_ft ? ` (${p.plot.width_ft}x${p.plot.depth_ft})` : ''}</td><td>{p.plot.facing ?? '-'} / {p.plot.road_width_ft ?? '?'} ft</td><td>{p.price !== null ? `INR ${cr(p.price)}` : '-'}</td><td><Badge tone={p.score >= 60 ? 'good' : 'muted'}>{p.score}%</Badge></td><td className="text-[11px] text-emerald-200">{p.why.join('; ')}</td><td className="text-[11px] text-amber-200">{p.concerns.join('; ') || '-'}</td><td>{canHold && m.ddScore.overall !== 'BLOCKED' ? <ActionForm action={holdPlot} className="flex gap-1"><input type="hidden" name="plotId" value={p.plot.id} /><input type="hidden" name="clientId" value={id} /><button className="btn btn-sm" name="action" value="HOLD">Hold 7d</button></ActionForm> : null}</td></tr>)}</tbody></table>
                ) : <p className="mt-2 text-xs text-ink-500">No plots to recommend{m.ddScore.overall === 'BLOCKED' ? ' - due diligence blocked' : ''}.</p>}
                {m.ddScore.criticalIssues.length ? <div className="mt-1 text-xs text-red-300">Critical: {m.ddScore.criticalIssues.join('; ')}</div> : null}
              </div>
            ))}
          </div>
        ) : <Empty>No active projects in inventory.</Empty>}
        <p className="mt-2 text-[11px] text-ink-500">Matching uses budget, location, plot size, purpose, horizon, declared preferences, previous enquiries and portfolio concentration only. Plots in projects without minimum legal due diligence are not recommendable. Historical / market context only - no appreciation promises.</p>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Site visits" right={<Badge tone="muted">{visits?.length ?? 0}</Badge>}>
          {visits?.length ? visits.map((v) => {
            const proj = projById.get(v.project_id);
            const fb = v.feedback as Record<string, unknown> | null;
            return (
              <div key={v.id} className="mb-2 rounded border border-white/[0.06] p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2"><StatusBadge status={v.status} /><span className="text-ink-100">{proj?.name ?? 'Project'}</span><span className="text-ink-400">{v.scheduled_at ? formatDateTime(v.scheduled_at) : 'unscheduled'}</span><span className="text-ink-500">plots {(v.plot_ids as string[]).map((p) => `#${plotById.get(p)?.plot_number ?? '?'}`).join(', ') || '-'}</span></div>
                {v.pickup_required ? <div className="text-ink-400">Pickup: {v.pickup_point} - meet at {v.meeting_point}</div> : null}
                {Array.isArray(v.itinerary) && v.itinerary.length ? <div className="text-ink-500">{(v.itinerary as Array<{ step: number; text: string }>).map((s) => `${s.step}. ${s.text}`).join(' | ')}</div> : null}
                {fb ? <div className="mt-1 rounded bg-ink-900 p-2"><span className="text-gold-300">Feedback:</span> liked {(fb.liked as string[])?.join(', ') || '-'}; disliked {(fb.disliked as string[])?.join(', ') || '-'}; preferred plots {(fb.preferred_plots as string[])?.join(', ') || '-'}; price reaction {String(fb.price_reaction ?? '-')}; decision timeline {String(fb.decision_timeline ?? '-')}</div> : v.status !== 'CANCELLED' && canWrite ? <FeedbackForm id={v.id} action={siteVisitFeedback} /> : null}
              </div>
            );
          }) : <p className="text-sm text-ink-400">No site visits yet.</p>}
          {canWrite ? <SiteVisitForm clientId={id} projects={projRows.map((p) => ({ id: p.id, name: p.name }))} plots={numericPlots.filter((p) => p.status === 'AVAILABLE' || p.status === 'HELD').map((p) => ({ id: p.id, label: `${projById.get(p.project_id)?.code ?? ''} #${p.plot_number} ${p.area_sqft} sq ft`, projectId: p.project_id }))} staff={c360.staff} action={scheduleSiteVisit} /> : null}
        </Panel>
        <div className="space-y-4">
          <Panel title="Plot interest memory">
            {interests?.length ? <ul className="space-y-1 text-xs">{interests.map((i) => { const p = plotById.get(i.plot_id); return <li key={i.plot_id} className="flex justify-between border-b border-white/[0.05] py-1"><span className="text-ink-100">{projById.get(p?.project_id ?? '')?.name} #{p?.plot_number} - {p?.area_sqft} sq ft</span><span className="flex items-center gap-1"><Badge tone={i.stance === 'INTERESTED' ? 'good' : 'bad'}>{i.stance.replace('_', ' ')}</Badge><span className="text-ink-500">{i.source}</span></span></li>; })}</ul> : <p className="text-sm text-ink-400">No plot interest recorded.</p>}
          </Panel>
          <Panel title="Landowner profile" right={landowner ? <Badge tone="gold">{String(landowner.stage).replace(/_/g, ' ')}</Badge> : <Badge tone="muted">Not a landowner lead</Badge>}>
            {landowner ? <dl className="kv text-xs"><dt>Location</dt><dd>{landowner.land_location}</dd><dt>Survey nos.</dt><dd className="mono">{(landowner.survey_numbers as string[]).join(', ')}</dd><dt>Extent</dt><dd>{landowner.extent_acres} acres</dd><dt>Co-owners</dt><dd>{(landowner.co_owners as string[]).join(', ') || '-'}</dd><dt>Patta / EC</dt><dd>{landowner.patta_status ?? '-'} / {landowner.ec_status ?? '-'}</dd><dt>Access / frontage</dt><dd>{landowner.access ?? '-'} / {landowner.road_frontage_ft ?? '?'} ft</dd><dt>Approval potential</dt><dd>{landowner.approval_potential ?? '-'}</dd><dt>Current use</dt><dd>{landowner.current_use ?? '-'}</dd><dt>Expected price</dt><dd>{landowner.expected_price ? `INR ${cr(Number(landowner.expected_price))}` : '-'} {landowner.negotiable ? '(negotiable)' : ''}</dd><dt>Timeline</dt><dd>{landowner.timeline ?? '-'}</dd></dl> : null}
            {canHold ? <details className="mt-2 text-xs"><summary className="cursor-pointer text-gold-300">{landowner ? 'Update landowner profile' : 'Create landowner profile'}</summary><LandownerForm clientId={id} lo={landowner as Record<string, unknown> | null} action={saveLandowner} /></details> : null}
            <p className="mt-2 text-[11px] text-ink-500">Landowner path: lead - ownership verification - documents - title review - EC - access - planning - location - valuation - development potential - commercial - decision - legal - execution. Never use private financial-distress information in negotiation.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
