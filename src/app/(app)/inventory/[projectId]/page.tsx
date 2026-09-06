import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getStaff } from '@/lib/db/server';
import { hasPermission } from '@/lib/security/permissions';
import { holdPlot, updatePlotPrice, upsertDdItem } from '@/lib/actions-wealth';
import { ddScorecard, type DdScorecard } from '@/lib/wealth/matching-engine';
import type { DdItemRow, PlotRow, ProjectRow } from '@/lib/wealth/types';
import { cr } from '@/lib/wealth/wealth-engine';
import { formatDate, formatDateTime } from '@/lib/engines/normalize';
import { Panel, Empty, Kv, Stat } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badges';
import { ActionForm } from '@/components/ui/action-form';

export const dynamic = 'force-dynamic';

/* ---------------- Row shapes (numerics may arrive as strings from PostgREST) ---------------- */
type Numeric = string | number | null;
type ProjectDetail = Omit<ProjectRow, 'lat' | 'lng' | 'total_area_acres' | 'plots_total' | 'osr_pct' | 'price_per_sqft' | 'guideline_value_per_sqft' | 'launch_price_per_sqft' | 'road_widths_ft' | 'price_history' | 'comparables'> & {
  lat: Numeric;
  lng: Numeric;
  total_area_acres: Numeric;
  plots_total: Numeric;
  osr_pct: Numeric;
  price_per_sqft: Numeric;
  guideline_value_per_sqft: Numeric;
  launch_price_per_sqft: Numeric;
  road_widths_ft: Array<string | number>;
  price_history: Array<{ date: string; price_per_sqft: Numeric }>;
  comparables: Array<{ project: string; price_per_sqft: Numeric; date: string; source: string }>;
  launched_on: string | null;
  district: string | null;
  state: string;
};
type PlotDetail = Omit<PlotRow, 'area_sqft' | 'width_ft' | 'depth_ft' | 'price' | 'negotiated_price'> & {
  survey_number: string | null;
  area_sqft: Numeric;
  width_ft: Numeric;
  depth_ft: Numeric;
  price: Numeric;
  negotiated_price: Numeric;
  release_date: string | null;
  held_for_client_id: string | null;
  held_until: string | null;
  notes: string | null;
};
interface DdDetailRow extends DdItemRow {
  source: string | null;
  reviewer_id: string | null;
  checked_at: string | null;
}
interface InterestRow {
  plot_id: string;
  stance: string;
  clients: { id: string; client_code: string } | Array<{ id: string; client_code: string }> | null;
}
interface VisitRow {
  id: string;
  client_id: string;
  plot_ids: string[];
  scheduled_at: string | null;
  status: string;
  rm_id: string | null;
  pickup_required: boolean;
  pickup_point: string | null;
  completed_at: string | null;
  clients: { client_code: string } | Array<{ client_code: string }> | null;
}
interface RuleRow {
  key: string;
  value: unknown;
}

/* ---------------- Helpers ---------------- */
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const perSqft = (v: number | null) => (v === null ? 'Not available' : `INR ${Math.round(v).toLocaleString('en-IN')} / sq ft`);
const inr = (v: number | null) => (v === null ? '-' : `INR ${cr(v)}`);
const asText = (v: unknown): string => (v === null || v === undefined ? '-' : Array.isArray(v) ? (v.length ? v.map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x))).join(', ') : '-') : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
const plotSort = (a: PlotDetail, b: PlotDetail) => {
  const na = Number.parseInt(a.plot_number, 10);
  const nb = Number.parseInt(b.plot_number, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.plot_number.localeCompare(b.plot_number, undefined, { numeric: true });
};

const DD_TONE: Record<DdScorecard['overall'], 'good' | 'warn' | 'bad' | 'muted'> = { READY: 'good', REVIEW: 'warn', BLOCKED: 'bad', INCOMPLETE: 'muted' };
const DD_ITEM_TONE: Record<string, 'good' | 'warn' | 'bad' | 'muted'> = { VERIFIED: 'good', PENDING: 'muted', NOT_AVAILABLE: 'muted', POTENTIAL_ISSUE: 'warn', CRITICAL_ISSUE: 'bad' };
const DD_STATUSES = ['VERIFIED', 'PENDING', 'NOT_AVAILABLE', 'POTENTIAL_ISSUE', 'CRITICAL_ISSUE'] as const;
const PLOT_STATUSES = ['AVAILABLE', 'HELD', 'RESERVED', 'BOOKED', 'REGISTERED', 'CANCELLED'] as const;
const PLOT_TONE: Record<string, 'good' | 'warn' | 'bad' | 'muted' | 'info' | 'gold' | 'neutral'> = { AVAILABLE: 'good', HELD: 'warn', RESERVED: 'info', BOOKED: 'gold', REGISTERED: 'neutral', CANCELLED: 'bad' };
const INFRA_TONE: Record<string, 'good' | 'info' | 'warn' | 'muted'> = { EXISTING: 'good', UNDER_CONSTRUCTION: 'info', PROPOSED: 'warn', ANNOUNCED: 'warn' };
const approvalTone = (s: string | null) => (s === 'APPROVED' ? 'good' : s === 'PENDING' ? 'warn' : s === 'NOT_APPLICABLE' ? 'muted' : 'neutral');
const docTone = (s: string) => (['VERIFIED', 'AVAILABLE', 'RECEIVED'].includes(s) ? 'good' : ['PENDING', 'REQUESTED', 'AWAITED'].includes(s) ? 'warn' : ['MISSING', 'REJECTED', 'EXPIRED'].includes(s) ? 'bad' : 'neutral');
const visitTone = (s: string) => (s === 'COMPLETED' ? 'good' : s === 'SCHEDULED' ? 'info' : s === 'CANCELLED' ? 'bad' : 'muted');

export default async function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { db, staff } = await getStaff();
  if (!staff) redirect('/login');
  const { projectId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) notFound();

  const { data: projectRaw } = await db.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (!projectRaw) notFound();
  const project = projectRaw as ProjectDetail;

  const [{ data: plotsRaw }, { data: ddRaw }, { data: visitsRaw }, { data: rulesRaw }, { data: staffRaw }] = await Promise.all([
    db.from('plots').select('id,project_id,plot_number,survey_number,area_sqft,width_ft,depth_ft,facing,road_width_ft,corner,park_facing,near_entrance,status,price,negotiated_price,release_date,held_for_client_id,held_until,notes').eq('project_id', projectId),
    db.from('property_due_diligence').select('project_id,item_key,status,finding,source,reviewer_id,checked_at').eq('project_id', projectId),
    db.from('site_visits').select('id,client_id,plot_ids,scheduled_at,status,rm_id,pickup_required,pickup_point,completed_at,clients(client_code)').eq('project_id', projectId).order('scheduled_at', { ascending: false, nullsFirst: false }),
    db.from('compliance_rules').select('key,value').in('key', ['property.min_dd_items', 'sales.discount_approval_above_pct']),
    db.from('staff_profiles').select('user_id,full_name'),
  ]);

  const plots = ((plotsRaw ?? []) as PlotDetail[]).sort(plotSort);
  const dd = (ddRaw ?? []) as DdDetailRow[];
  const visits = (visitsRaw ?? []) as VisitRow[];
  const rules = new Map(((rulesRaw ?? []) as RuleRow[]).map((r) => [r.key, r.value]));
  const staffName = new Map(((staffRaw ?? []) as Array<{ user_id: string; full_name: string }>).map((s) => [s.user_id, s.full_name]));

  const plotIds = plots.map((p) => p.id);
  const heldIds = [...new Set(plots.map((p) => p.held_for_client_id).filter((x): x is string => Boolean(x)))];
  const [{ data: interestRaw }, { data: heldClientsRaw }] = await Promise.all([
    plotIds.length ? db.from('plot_interest').select('plot_id,stance,clients(client_code,id)').in('plot_id', plotIds) : Promise.resolve({ data: [] as InterestRow[] }),
    heldIds.length ? db.from('clients').select('id,client_code').in('id', heldIds) : Promise.resolve({ data: [] as Array<{ id: string; client_code: string }> }),
  ]);
  const heldCode = new Map(((heldClientsRaw ?? []) as Array<{ id: string; client_code: string }>).map((c) => [c.id, c.client_code]));
  const interestByPlot = new Map<string, Array<{ id: string; code: string; stance: string }>>();
  for (const i of (interestRaw ?? []) as InterestRow[]) {
    const c = one(i.clients);
    if (!c) continue;
    interestByPlot.set(i.plot_id, [...(interestByPlot.get(i.plot_id) ?? []), { id: c.id, code: c.client_code, stance: i.stance }]);
  }

  const minimumItems = Array.isArray(rules.get('property.min_dd_items')) ? (rules.get('property.min_dd_items') as unknown[]).map(String) : [];
  const discountPct = num((rules.get('sales.discount_approval_above_pct') as { pct?: unknown } | undefined)?.pct);
  const scorecard = ddScorecard(dd, minimumItems);
  const ddByKey = new Map(dd.map((d) => [d.item_key, d]));
  const canWrite = hasPermission(staff.role, 'clients:write');

  /* ---------------- Price intelligence ---------------- */
  const price = num(project.price_per_sqft);
  const launch = num(project.launch_price_per_sqft);
  const guideline = num(project.guideline_value_per_sqft);
  const ratio = price !== null && guideline ? price / guideline : null;
  const sinceLaunch = price !== null && launch ? ((price - launch) / launch) * 100 : null;
  const history = [...(project.price_history ?? [])].map((h) => ({ date: h.date, price: num(h.price_per_sqft) })).sort((a, b) => a.date.localeCompare(b.date));
  const comparables = [...(project.comparables ?? [])].map((c) => ({ ...c, price: num(c.price_per_sqft) })).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const now = Date.now();
  const available = plots.filter((p) => p.status === 'AVAILABLE');
  const ageDays = (d: string | null) => (d ? Math.max(0, Math.round((now - new Date(d).getTime()) / 86_400_000)) : null);
  const ageing: Array<[string, number]> = [
    ['0-30 days', 0],
    ['31-90 days', 0],
    ['91-180 days', 0],
    ['Over 180 days', 0],
    ['No release date', 0],
  ];
  for (const p of available) {
    const a = ageDays(p.release_date);
    const idx = a === null ? 4 : a <= 30 ? 0 : a <= 90 ? 1 : a <= 180 ? 2 : 3;
    ageing[idx][1] += 1;
  }

  /* ---------------- Plot aggregates ---------------- */
  const countOf = (s: string) => plots.filter((p) => p.status === s).length;
  const infra = project.infrastructure ?? [];
  const geoEntries = Object.entries(project.geo ?? {});
  const utilities = Object.entries(project.utilities ?? {});
  const documents = project.documents ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-ink-400">
            <Link href="/inventory" className="text-gold-300 hover:underline">
              Projects
            </Link>{' '}
            / <span className="mono">{project.code}</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
          <p className="text-xs text-ink-400">
            {project.project_type.replace(/_/g, ' ')} - {[project.locality, project.city, project.district, project.state].filter(Boolean).join(', ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={project.status === 'ACTIVE' ? 'good' : 'muted'}>{project.status.replace(/_/g, ' ')}</Badge>
          <Badge tone={approvalTone(project.approval_status)}>{(project.approval_status ?? 'UNKNOWN').replace(/_/g, ' ')}</Badge>
          <Badge tone={DD_TONE[scorecard.overall]}>DD {scorecard.overall}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(
          [
            ['Plots', plots.length || (num(project.plots_total) ?? 0), 'muted'],
            ['Available', countOf('AVAILABLE'), 'good'],
            ['Held / reserved', countOf('HELD') + countOf('RESERVED'), 'warn'],
            ['Booked', countOf('BOOKED'), 'gold'],
            ['Registered', countOf('REGISTERED'), 'muted'],
            ['Site visits', visits.length, 'muted'],
          ] as Array<[string, number, 'good' | 'warn' | 'bad' | 'muted' | 'gold']>
        ).map(([label, v, tone]) => (
          <div key={label} className="panel p-3">
            <Stat label={label} value={<span className="mono text-2xl">{v}</span>} tone={tone} />
          </div>
        ))}
      </div>

      <Panel title="Project facts">
        <div className="grid gap-4 md:grid-cols-2">
          <Kv
            rows={[
              ['Code', <span key="code" className="mono">{project.code}</span>],
              ['Type', project.project_type.replace(/_/g, ' ')],
              ['Total area', num(project.total_area_acres) !== null ? `${num(project.total_area_acres)} acres` : null],
              ['Declared plot total', num(project.plots_total)],
              ['Launched on', project.launched_on ? formatDate(project.launched_on) : null],
              ['Status', project.status.replace(/_/g, ' ')],
            ]}
          />
          <div>
            <div className="panel-title mb-1">Investment thesis</div>
            <p className="text-sm text-ink-200">{project.thesis ?? <span className="text-ink-400">No thesis recorded.</span>}</p>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ---------------- GEO INTELLIGENCE ---------------- */}
        <Panel title="Geo intelligence" right={<Badge tone="muted">{infra.length} infrastructure items</Badge>}>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Proposed / announced infrastructure is never presented as existing. Each item carries its status and source.</div>
          <div className="mt-3">
            <Kv
              rows={[
                ['Coordinates', num(project.lat) !== null && num(project.lng) !== null ? <span key="ll" className="mono">{num(project.lat)}, {num(project.lng)}</span> : null],
                ...geoEntries.map(([k, v]) => [k.replace(/_/g, ' '), asText(v)] as [React.ReactNode, React.ReactNode]),
              ]}
            />
          </div>
          <div className="mt-3 overflow-x-auto">
            {infra.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Infrastructure</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th className="text-right">Distance</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {infra.map((i, idx) => (
                    <tr key={`${i.name}-${idx}`}>
                      <td>{i.name}</td>
                      <td className="text-ink-300">{String(i.kind ?? '').replace(/_/g, ' ')}</td>
                      <td>
                        <Badge tone={INFRA_TONE[i.status] ?? 'muted'}>{String(i.status ?? 'UNKNOWN').replace(/_/g, ' ')}</Badge>
                      </td>
                      <td className="mono text-right">{num(i.distance_km) !== null ? `${num(i.distance_km)} km` : '-'}</td>
                      <td className="text-xs text-ink-400">{i.source ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-400">No infrastructure recorded.</p>
            )}
          </div>
        </Panel>

        {/* ---------------- PRICE INTELLIGENCE ---------------- */}
        <Panel title="Price intelligence" right={ratio !== null ? <Badge tone={ratio > 2 ? 'warn' : ratio < 1 ? 'info' : 'good'}>{ratio.toFixed(2)}x guideline</Badge> : null}>
          <Kv
            rows={[
              ['Current price', perSqft(price)],
              ['Launch price', launch !== null ? <span key="l">{perSqft(launch)}{sinceLaunch !== null ? <span className={`ml-2 text-xs ${sinceLaunch >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{sinceLaunch >= 0 ? '+' : ''}{sinceLaunch.toFixed(1)}% since launch</span> : null}</span> : null],
              ['Guideline value', perSqft(guideline)],
              ['Price / guideline', ratio !== null ? `${ratio.toFixed(2)}x` : null],
              ['Discount rule', discountPct !== null ? `Negotiated discounts above ${discountPct}% of list price require senior approval (compliance rule sales.discount_approval_above_pct).` : 'Discount approval rule not configured.'],
            ]}
          />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <div className="panel-title mb-1">Price history</div>
              {history.length ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th className="text-right">Price / sq ft</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr key={`${h.date}-${i}`}>
                          <td>{formatDate(h.date)}</td>
                          <td className="mono text-right">{h.price !== null ? `INR ${Math.round(h.price).toLocaleString('en-IN')}` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-ink-400">No price history.</p>
              )}
            </div>
            <div>
              <div className="panel-title mb-1">Inventory ageing (available plots)</div>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Age since release</th>
                      <th className="text-right">Plots</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ageing.map(([label, count]) => (
                      <tr key={label}>
                        <td className={label === 'Over 180 days' && count ? 'text-amber-300' : ''}>{label}</td>
                        <td className="mono text-right">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="mt-3">
            <div className="panel-title mb-1">Comparables</div>
            {comparables.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th className="text-right">Price / sq ft</th>
                      <th>Date</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparables.map((c, i) => (
                      <tr key={`${c.project}-${i}`}>
                        <td>{c.project}</td>
                        <td className="mono text-right">{c.price !== null ? `INR ${Math.round(c.price).toLocaleString('en-IN')}` : '-'}</td>
                        <td className="text-ink-300">{formatDate(c.date)}</td>
                        <td className="text-xs text-ink-400">{c.source ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-ink-400">No comparables recorded.</p>
            )}
          </div>
        </Panel>
      </div>

      {/* ---------------- LAYOUT INTELLIGENCE ---------------- */}
      <Panel title="Layout intelligence" right={project.rera_number ? <Badge tone="good">RERA {project.rera_number}</Badge> : <Badge tone="muted">No RERA number</Badge>}>
        <div className="grid gap-4 md:grid-cols-2">
          <Kv
            rows={[
              ['Approval authority', project.approval_authority],
              ['Approval number', project.approval_number ? <span key="an" className="mono">{project.approval_number}</span> : null],
              ['Approval status', <Badge key="as" tone={approvalTone(project.approval_status)}>{(project.approval_status ?? 'UNKNOWN').replace(/_/g, ' ')}</Badge>],
              ['RERA', project.rera_number ? <span key="rera" className="mono">{project.rera_number}</span> : null],
              ['Survey numbers', project.survey_numbers?.length ? project.survey_numbers.join(', ') : null],
              ['Road widths', project.road_widths_ft?.length ? project.road_widths_ft.map((w) => `${w} ft`).join(', ') : null],
              ['OSR', num(project.osr_pct) !== null ? `${num(project.osr_pct)}%` : null],
              ['Amenities', project.amenities?.length ? <div key="am" className="flex flex-wrap gap-1">{project.amenities.map((a) => <Badge key={a} tone="neutral">{a}</Badge>)}</div> : null],
            ]}
          />
          <div className="space-y-3">
            <div>
              <div className="panel-title mb-1">Utilities</div>
              {utilities.length ? <Kv rows={utilities.map(([k, v]) => [k.replace(/_/g, ' '), asText(v)] as [React.ReactNode, React.ReactNode])} /> : <p className="text-sm text-ink-400">No utilities recorded.</p>}
            </div>
            <div>
              <div className="panel-title mb-1">Documents</div>
              {documents.length ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Document</th>
                        <th>Type</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((d, i) => (
                        <tr key={`${d.name}-${i}`}>
                          <td>{d.name}</td>
                          <td className="text-ink-300">{String(d.type ?? '').replace(/_/g, ' ')}</td>
                          <td>
                            <Badge tone={docTone(String(d.status ?? ''))}>{String(d.status ?? 'UNKNOWN').replace(/_/g, ' ')}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-ink-400">No documents listed.</p>
              )}
            </div>
          </div>
        </div>
      </Panel>

      {/* ---------------- DUE-DILIGENCE SCORECARD ---------------- */}
      <Panel
        title="Legal due-diligence scorecard"
        right={
          <div className="flex items-center gap-1.5">
            <Badge tone={scorecard.minimumMet ? 'good' : 'warn'}>{scorecard.minimumMet ? 'Minimum items verified' : 'Minimum items incomplete'}</Badge>
            <Badge tone={DD_TONE[scorecard.overall]}>{scorecard.overall}</Badge>
          </div>
        }
      >
        {scorecard.criticalIssues.length ? (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            <div className="font-semibold uppercase tracking-wider">Critical issues - project is blocked from recommendation</div>
            <ul className="mt-1 list-disc pl-4">
              {scorecard.criticalIssues.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mb-3 text-xs text-ink-400">
          Minimum items (compliance rule property.min_dd_items): {minimumItems.length ? minimumItems.map((k) => k.replace(/_/g, ' ')).join(', ') : 'not configured'}. Items not yet checked show as NOT AVAILABLE. {canWrite ? 'Update an item inline; every change is audited with reviewer and time.' : 'Your role can view but not edit due-diligence items.'}
        </p>
        <div className="space-y-4">
          {scorecard.categories.map((cat) => (
            <div key={cat.key}>
              <div className="mb-1 flex items-center gap-2">
                <span className="panel-title">{cat.label}</span>
                <Badge tone={DD_ITEM_TONE[cat.status] ?? 'muted'}>{cat.status.replace(/_/g, ' ')}</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Status</th>
                      <th>Finding</th>
                      <th>Source</th>
                      <th>Reviewer</th>
                      <th>Checked</th>
                      {canWrite ? <th>Update</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {cat.items.map((it) => {
                      const row = ddByKey.get(it.key);
                      const required = minimumItems.includes(it.key);
                      return (
                        <tr key={it.key}>
                          <td>
                            <span className="font-medium">{it.key.replace(/_/g, ' ')}</span>
                            {required ? <Badge tone="gold" className="ml-1">min</Badge> : null}
                          </td>
                          <td>
                            <Badge tone={DD_ITEM_TONE[it.status] ?? 'muted'}>{it.status.replace(/_/g, ' ')}</Badge>
                          </td>
                          <td className="max-w-[260px] text-xs text-ink-200">{it.finding ?? <span className="text-ink-500">-</span>}</td>
                          <td className="text-xs text-ink-400">{row?.source ?? '-'}</td>
                          <td className="text-xs text-ink-400">{row?.reviewer_id ? (staffName.get(row.reviewer_id) ?? 'Staff') : '-'}</td>
                          <td className="text-xs text-ink-400">{row?.checked_at ? formatDateTime(row.checked_at) : '-'}</td>
                          {canWrite ? (
                            <td>
                              <ActionForm action={upsertDdItem} resetOnSuccess={false} className="flex flex-wrap items-center gap-1">
                                <input type="hidden" name="projectId" value={projectId} />
                                <input type="hidden" name="itemKey" value={it.key} />
                                <select name="status" defaultValue={it.status} className="input w-36 py-1 text-xs" aria-label={`Status for ${it.key}`}>
                                  {DD_STATUSES.map((s) => (
                                    <option key={s} value={s}>
                                      {s.replace(/_/g, ' ')}
                                    </option>
                                  ))}
                                </select>
                                <input name="finding" defaultValue={it.finding ?? ''} placeholder="Finding" className="input w-44 py-1 text-xs" aria-label={`Finding for ${it.key}`} />
                                <input name="source" defaultValue={row?.source ?? ''} placeholder="Source" className="input w-32 py-1 text-xs" aria-label={`Source for ${it.key}`} />
                                <button className="btn btn-sm">Save</button>
                              </ActionForm>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* ---------------- PLOT INVENTORY ---------------- */}
      <Panel title="Plot inventory" right={<Badge tone="muted">{plots.length} plots</Badge>}>
        {plots.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Plot</th>
                  <th>Survey</th>
                  <th className="text-right">Area</th>
                  <th className="text-right">W x D</th>
                  <th>Facing</th>
                  <th className="text-right">Road</th>
                  <th>Attributes</th>
                  <th>Status</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Negotiated</th>
                  <th>Released</th>
                  <th>Held for</th>
                  <th>Interested</th>
                  {canWrite ? <th>Update</th> : null}
                </tr>
              </thead>
              <tbody>
                {plots.map((p) => {
                  const area = num(p.area_sqft);
                  const w = num(p.width_ft);
                  const d = num(p.depth_ft);
                  const list = num(p.price);
                  const neg = num(p.negotiated_price);
                  const disc = list && neg !== null ? (1 - neg / list) * 100 : null;
                  const interested = interestByPlot.get(p.id) ?? [];
                  return (
                    <tr key={p.id}>
                      <td className="mono font-medium">{p.plot_number}</td>
                      <td className="mono text-xs text-ink-300">{p.survey_number ?? '-'}</td>
                      <td className="mono text-right">{area !== null ? `${area.toLocaleString('en-IN')} sq ft` : '-'}</td>
                      <td className="mono text-right text-ink-300">{w !== null && d !== null ? `${w} x ${d}` : '-'}</td>
                      <td className="text-ink-300">{p.facing ?? '-'}</td>
                      <td className="mono text-right text-ink-300">{p.road_width_ft ? `${p.road_width_ft} ft` : '-'}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {p.corner ? <Badge tone="info">corner</Badge> : null}
                          {p.park_facing ? <Badge tone="good">park</Badge> : null}
                          {p.near_entrance ? <Badge tone="neutral">entrance</Badge> : null}
                        </div>
                      </td>
                      <td>
                        <Badge tone={PLOT_TONE[p.status] ?? 'neutral'}>{p.status}</Badge>
                        {p.status === 'HELD' && p.held_until ? <div className="text-[11px] text-ink-400">until {formatDate(p.held_until)}</div> : null}
                      </td>
                      <td className="mono text-right">{inr(list)}</td>
                      <td className="mono text-right">
                        {neg !== null ? (
                          <span className={disc !== null && discountPct !== null && disc > discountPct ? 'text-amber-300' : ''} title={disc !== null ? `${disc.toFixed(1)}% off list` : undefined}>
                            {inr(neg)}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="text-xs text-ink-300">{p.release_date ? formatDate(p.release_date) : '-'}</td>
                      <td>
                        {p.held_for_client_id ? (
                          <Link href={`/clients/${p.held_for_client_id}`} className="mono text-xs text-gold-300 hover:underline">
                            {heldCode.get(p.held_for_client_id) ?? 'client'}
                          </Link>
                        ) : (
                          <span className="text-ink-500">-</span>
                        )}
                      </td>
                      <td>
                        {interested.length ? (
                          <div className="flex flex-wrap gap-1">
                            {interested.map((c) => (
                              <Link key={c.id} href={`/clients/${c.id}/property`} className={`mono text-xs hover:underline ${c.stance === 'NOT_INTERESTED' ? 'text-ink-500 line-through' : 'text-gold-300'}`} title={c.stance.replace(/_/g, ' ')}>
                                {c.code}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <span className="text-ink-500">-</span>
                        )}
                      </td>
                      {canWrite ? (
                        <td>
                          <div className="flex flex-wrap items-center gap-1">
                            <ActionForm action={updatePlotPrice} resetOnSuccess={false} className="flex flex-wrap items-center gap-1">
                              <input type="hidden" name="plotId" value={p.id} />
                              <input name="negotiated" type="number" min={0} step={1000} defaultValue={neg ?? ''} placeholder="Negotiated INR" className="input w-36 py-1 text-xs" aria-label={`Negotiated price for plot ${p.plot_number}`} />
                              <select name="status" defaultValue={p.status} className="input w-32 py-1 text-xs" aria-label={`Status for plot ${p.plot_number}`}>
                                {PLOT_STATUSES.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                              <button className="btn btn-sm">Save</button>
                            </ActionForm>
                            {p.status === 'HELD' && p.held_for_client_id ? (
                              <ActionForm action={holdPlot} confirm={`Release the hold on plot ${p.plot_number}?`}>
                                <input type="hidden" name="plotId" value={p.id} />
                                <input type="hidden" name="clientId" value={p.held_for_client_id} />
                                <input type="hidden" name="action" value="RELEASE" />
                                <button className="btn btn-sm">Release</button>
                              </ActionForm>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No plots registered for this project.</Empty>
        )}
      </Panel>

      {/* ---------------- SITE VISITS ---------------- */}
      <Panel title="Site visits" right={<Badge tone="muted">{visits.length}</Badge>}>
        {visits.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Scheduled</th>
                  <th>Status</th>
                  <th className="text-right">Plots</th>
                  <th>RM</th>
                  <th>Pickup</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link href={`/clients/${v.client_id}/property`} className="mono text-xs text-gold-300 hover:underline">
                        {one(v.clients)?.client_code ?? 'client'}
                      </Link>
                    </td>
                    <td className="text-xs text-ink-300">{v.scheduled_at ? formatDateTime(v.scheduled_at) : 'Not scheduled'}</td>
                    <td>
                      <Badge tone={visitTone(v.status)}>{v.status}</Badge>
                    </td>
                    <td className="mono text-right">{v.plot_ids?.length ?? 0}</td>
                    <td className="text-xs text-ink-300">{v.rm_id ? (staffName.get(v.rm_id) ?? 'Staff') : '-'}</td>
                    <td className="text-xs text-ink-300">{v.pickup_required ? (v.pickup_point ?? 'Yes') : '-'}</td>
                    <td className="text-xs text-ink-400">{v.completed_at ? formatDateTime(v.completed_at) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No site visits for this project yet.</Empty>
        )}
      </Panel>
    </div>
  );
}
