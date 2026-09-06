/**
 * Land / layout / plot matching engine + property due-diligence scorecard.
 * Uses only legitimate factors: budget, location, plot size, purpose, horizon, declared preferences,
 * previous enquiries and portfolio concentration. Every match explains why and lists concerns.
 */
import { cr } from './wealth-engine';
import type { AssetRow, DdItemRow, PlotRow, ProjectRow, PropertyPreferencesRow } from './types';

export interface ProjectMatch {
  project: ProjectRow;
  score: number;
  why: string[];
  concerns: string[];
  ddScore: DdScorecard;
  availablePlots: number;
  plots: PlotMatch[];
  recommendSiteVisit: boolean;
}

export interface PlotMatch {
  plot: PlotRow;
  score: number;
  why: string[];
  concerns: string[];
  price: number | null;
}

export interface DdScorecard {
  overall: 'READY' | 'REVIEW' | 'BLOCKED' | 'INCOMPLETE';
  categories: Array<{ key: string; label: string; status: string; items: Array<{ key: string; status: string; finding: string | null }> }>;
  criticalIssues: string[];
  pendingItems: string[];
  minimumMet: boolean;
}

const DD_CATEGORIES: Array<{ key: string; label: string; items: string[] }> = [
  { key: 'TITLE', label: 'Title quality', items: ['TITLE_CHAIN', 'PARENT_DOCUMENTS', 'SALE_DEED', 'PATTA', 'CHITTA', 'ADANGAL'] },
  { key: 'APPROVAL', label: 'Approval status', items: ['APPROVAL', 'RERA', 'OSR', 'ROAD_WIDTH'] },
  { key: 'ENCUMBRANCE', label: 'Encumbrance', items: ['EC', 'MORTGAGE'] },
  { key: 'ACCESS', label: 'Access', items: ['ACCESS', 'RIGHT_OF_WAY'] },
  { key: 'PLANNING', label: 'Planning compliance', items: ['LAND_CLASSIFICATION', 'CONVERSION', 'CRZ', 'FOREST'] },
  { key: 'LITIGATION', label: 'Litigation', items: ['LITIGATION', 'ACQUISITION_NOTIFICATION'] },
  { key: 'READINESS', label: 'Development readiness', items: ['SURVEY', 'FMB', 'REGISTRATION', 'PROMOTER_DOCS'] },
  { key: 'INFRA', label: 'Infrastructure & utilities', items: ['UTILITIES', 'WATERBODY', 'FLOOD', 'HT_LINE'] },
];

export function ddScorecard(items: DdItemRow[], minimumItems: string[]): DdScorecard {
  const byKey = new Map(items.map((i) => [i.item_key, i]));
  const categories = DD_CATEGORIES.map((c) => {
    const rows = c.items.map((k) => ({ key: k, status: byKey.get(k)?.status ?? 'NOT_AVAILABLE', finding: byKey.get(k)?.finding ?? null }));
    const status = rows.some((r) => r.status === 'CRITICAL_ISSUE') ? 'CRITICAL_ISSUE' : rows.some((r) => r.status === 'POTENTIAL_ISSUE') ? 'POTENTIAL_ISSUE' : rows.some((r) => r.status === 'PENDING') ? 'PENDING' : rows.every((r) => r.status === 'NOT_AVAILABLE') ? 'NOT_AVAILABLE' : 'VERIFIED';
    return { key: c.key, label: c.label, status, items: rows };
  });
  const criticalIssues = items.filter((i) => i.status === 'CRITICAL_ISSUE').map((i) => `${i.item_key.replace(/_/g, ' ')}: ${i.finding ?? 'critical issue'}`);
  const pendingItems = items.filter((i) => i.status === 'PENDING' || i.status === 'POTENTIAL_ISSUE').map((i) => `${i.item_key.replace(/_/g, ' ')}${i.finding ? `: ${i.finding}` : ''}`);
  const minimumMet = minimumItems.every((k) => byKey.get(k)?.status === 'VERIFIED');
  const overall: DdScorecard['overall'] = criticalIssues.length ? 'BLOCKED' : !minimumMet ? 'INCOMPLETE' : pendingItems.length ? 'REVIEW' : 'READY';
  return { overall, categories, criticalIssues, pendingItems, minimumMet };
}

const norm = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z]/g, '');

export function matchPlot(plot: PlotRow, pp: PropertyPreferencesRow | null, project: ProjectRow, enquiredPlotIds: Set<string>): PlotMatch {
  const why: string[] = [];
  const concerns: string[] = [];
  let score = 0;
  const price = plot.negotiated_price ?? plot.price ?? (project.price_per_sqft ? project.price_per_sqft * plot.area_sqft : null);
  if (pp) {
    if (pp.plot_size_min_sqft || pp.plot_size_max_sqft) {
      const okMin = !pp.plot_size_min_sqft || plot.area_sqft >= pp.plot_size_min_sqft;
      const okMax = !pp.plot_size_max_sqft || plot.area_sqft <= pp.plot_size_max_sqft;
      if (okMin && okMax) { score += 25; why.push(`Plot size ${plot.area_sqft} sq ft within requested range`); } else concerns.push(`Plot size ${plot.area_sqft} sq ft outside requested ${pp.plot_size_min_sqft ?? '?'}-${pp.plot_size_max_sqft ?? '?'} sq ft`);
    } else score += 10;
    if (price !== null && pp.budget_max) {
      if (price <= pp.budget_max && (!pp.budget_min || price >= pp.budget_min * 0.8)) { score += 25; why.push(`Price INR ${cr(price)} within declared budget`); } else if (price <= pp.budget_max * 1.1) { score += 10; concerns.push(`Price INR ${cr(price)} slightly above declared budget INR ${cr(pp.budget_max)}`); } else concerns.push(`Price INR ${cr(price)} exceeds declared budget INR ${cr(pp.budget_max)}`);
    } else if (price === null) concerns.push('Plot price not set');
    if (pp.facing.length) { if (plot.facing && pp.facing.map(norm).includes(norm(plot.facing))) { score += 15; why.push(`${plot.facing}-facing as requested`); } else concerns.push(`Facing ${plot.facing ?? 'unknown'}; requested ${pp.facing.join('/')}`); }
    if (pp.road_width_min_ft) { if ((plot.road_width_ft ?? 0) >= pp.road_width_min_ft) { score += 10; why.push(`${plot.road_width_ft} ft road meets requested ${pp.road_width_min_ft} ft`); } else concerns.push(`Road ${plot.road_width_ft ?? '?'} ft below requested ${pp.road_width_min_ft} ft`); }
    if (pp.corner_preferred) { if (plot.corner) { score += 8; why.push('Corner plot as preferred'); } }
  } else score += 20;
  if (plot.park_facing) { score += 3; why.push('Park-facing'); }
  if (plot.near_entrance) { score += 2; why.push('Near main entrance'); }
  if (enquiredPlotIds.has(plot.id)) { score += 12; why.push('Client previously showed interest in this plot'); }
  if (plot.status !== 'AVAILABLE') { concerns.push(`Status ${plot.status.toLowerCase()}`); score = Math.min(score, 30); }
  return { plot, score: Math.min(100, score), why, concerns, price };
}

export function matchProjects(input: { prefs: PropertyPreferencesRow | null; projects: ProjectRow[]; plots: PlotRow[]; dd: DdItemRow[]; holdings: AssetRow[]; enquiredPlotIds?: Set<string>; minimumDdItems: string[]; maxPlotsPerProject?: number }): ProjectMatch[] {
  const { prefs: pp } = input;
  const enquired = input.enquiredPlotIds ?? new Set<string>();
  const holdingCities = new Map<string, number>();
  for (const h of input.holdings.filter((h) => h.category === 'REAL_ESTATE' && h.status === 'ACTIVE')) { const c = norm(String((h.details as { city?: string }).city ?? '')); if (c) holdingCities.set(c, (holdingCities.get(c) ?? 0) + 1); }
  const out: ProjectMatch[] = [];
  for (const project of input.projects.filter((p) => p.status === 'ACTIVE')) {
    const why: string[] = [];
    const concerns: string[] = [];
    let score = 0;
    const dd = ddScorecard(input.dd.filter((d) => d.project_id === project.id), input.minimumDdItems);
    const projPlots = input.plots.filter((p) => p.project_id === project.id);
    const available = projPlots.filter((p) => p.status === 'AVAILABLE');
    if (pp) {
      const cityHit = pp.cities.map(norm).includes(norm(project.city)) || pp.districts.map(norm).includes(norm(project.district));
      const localityHit = pp.localities.map(norm).some((l) => l && norm(project.locality).includes(l));
      if (localityHit) { score += 30; why.push(`Preferred locality ${project.locality}`); } else if (cityHit) { score += 22; why.push(`Preferred location ${project.city}`); } else if (pp.cities.length) concerns.push(`${project.city} is outside the client's preferred ${pp.cities.join('/')}`);
      if (pp.approval_required) { if (project.approval_status === 'APPROVED') { score += 15; why.push(`Approved layout (${project.approval_authority ?? 'authority'} ${project.approval_number ?? ''})`.trim()); } else concerns.push('Approval not confirmed; client requires an approved layout'); }
      if (pp.property_types.length) { const pt = project.project_type === 'PLOTTED_LAYOUT' ? ['PLOT', 'LAND'] : project.project_type === 'FARM' ? ['FARM', 'LAND'] : [project.project_type]; if (pp.property_types.some((t) => pt.includes(t))) { score += 10; why.push(`Property type matches (${project.project_type.replace(/_/g, ' ').toLowerCase()})`); } else concerns.push(`Project type ${project.project_type.replace(/_/g, ' ').toLowerCase()} differs from requested ${pp.property_types.join('/')}`); }
      if (pp.proximity.length) { const infra = project.infrastructure.map((i) => `${i.kind} ${i.name}`.toUpperCase()); const hits = pp.proximity.filter((p) => infra.some((i) => i.includes(p.replace(/_/g, ' ')) || i.includes(p))); if (hits.length) { score += 8; why.push(`Proximity to ${hits.join(', ').toLowerCase()}`); } }
      if (pp.budget_max && project.price_per_sqft && pp.plot_size_min_sqft) { const est = project.price_per_sqft * pp.plot_size_min_sqft; if (est <= pp.budget_max) { score += 10; why.push(`Entry price ~INR ${cr(est)} for ${pp.plot_size_min_sqft} sq ft within budget`); } else concerns.push(`Minimum plot at INR ${cr(est)} exceeds declared budget`); }
      if (pp.horizon && /5|7|10|long/i.test(pp.horizon) && project.infrastructure.some((i) => i.status !== 'EXISTING')) why.push('Long horizon aligns with infrastructure still under construction/proposed');
      if (pp.horizon && /1|2|short/i.test(pp.horizon) && project.infrastructure.some((i) => i.status === 'PROPOSED' || i.status === 'ANNOUNCED')) concerns.push('Short horizon vs infrastructure that is only proposed/announced');
    } else score += 15;
    if (dd.overall === 'BLOCKED') { concerns.push(`Due diligence blocked: ${dd.criticalIssues.join('; ')}`); score = Math.min(score, 15); } else if (dd.overall === 'INCOMPLETE') { concerns.push('Minimum legal due diligence not complete; not recommendable yet'); score = Math.min(score, 45); } else if (dd.overall === 'REVIEW') concerns.push(`Due-diligence items pending: ${dd.pendingItems.slice(0, 3).join('; ')}`); else { score += 10; why.push('Minimum legal due diligence verified'); }
    if (!available.length) { concerns.push('No available plots'); score = Math.min(score, 30); } else why.push(`${available.length} available plot(s)`);
    if (holdingCities.get(norm(project.city))) concerns.push(`Client already holds property in ${project.city} - geographic concentration`);
    const proposed = project.infrastructure.filter((i) => i.status === 'PROPOSED' || i.status === 'ANNOUNCED');
    if (proposed.length) concerns.push(`${proposed.length} infrastructure item(s) are proposed/announced, not existing`);
    if (project.guideline_value_per_sqft && project.price_per_sqft && project.price_per_sqft > project.guideline_value_per_sqft * 2.5) concerns.push(`Asking price is ${(project.price_per_sqft / project.guideline_value_per_sqft).toFixed(1)}x guideline value`);
    const plots = available.map((p) => matchPlot(p, pp, project, enquired)).sort((a, b) => b.score - a.score).slice(0, input.maxPlotsPerProject ?? 5);
    out.push({ project, score: Math.min(100, score), why, concerns, ddScore: dd, availablePlots: available.length, plots, recommendSiteVisit: score >= 60 && dd.overall !== 'BLOCKED' && available.length > 0 });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Updates a preference profile from explicit site-visit feedback (declared, never inferred). */
export function preferencesFromFeedback(pp: PropertyPreferencesRow | null, fb: { road_width_pref?: number | null; plot_size_reaction?: string | null; price_reaction?: string | null; preferred_plots?: string[]; liked?: string[]; disliked?: string[] }, source: string): Partial<PropertyPreferencesRow> {
  const patch: Partial<PropertyPreferencesRow> = {};
  const ev: PropertyPreferencesRow['field_evidence'] = { ...(pp?.field_evidence ?? {}) };
  if (fb.road_width_pref) { patch.road_width_min_ft = fb.road_width_pref; ev.road_width_min_ft = { evidence_class: 'CLIENT_DECLARED', source, date: new Date().toISOString().slice(0, 10) }; }
  if (fb.liked?.some((l) => /corner/i.test(l))) { patch.corner_preferred = true; ev.corner_preferred = { evidence_class: 'CLIENT_DECLARED', source }; }
  patch.field_evidence = ev;
  return patch;
}
