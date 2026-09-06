import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/db/server';
import { ddScorecard, type DdScorecard } from '@/lib/wealth/matching-engine';
import type { DdItemRow } from '@/lib/wealth/types';
import { Panel, Empty, Stat } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badges';

export const dynamic = 'force-dynamic';

/** Numeric columns arrive from PostgREST as strings; nullable numerics may be null. */
interface ProjectListRow {
  id: string;
  code: string;
  name: string;
  project_type: string;
  city: string;
  locality: string | null;
  approval_status: string | null;
  approval_authority: string | null;
  approval_number: string | null;
  rera_number: string | null;
  total_area_acres: string | number | null;
  plots_total: string | number | null;
  price_per_sqft: string | number | null;
  guideline_value_per_sqft: string | number | null;
  launch_price_per_sqft: string | number | null;
  status: string;
}
interface PlotLite {
  project_id: string;
  status: string;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const perSqft = (v: number | null) => (v === null ? '-' : `INR ${Math.round(v).toLocaleString('en-IN')}`);
const DD_TONE: Record<DdScorecard['overall'], 'good' | 'warn' | 'bad' | 'muted'> = { READY: 'good', REVIEW: 'warn', BLOCKED: 'bad', INCOMPLETE: 'muted' };
const approvalTone = (s: string | null) => (s === 'APPROVED' ? 'good' : s === 'PENDING' ? 'warn' : s === 'NOT_APPLICABLE' ? 'muted' : 'neutral');
const statusTone = (s: string) => (s === 'ACTIVE' ? 'good' : s === 'SOLD_OUT' || s === 'CLOSED' ? 'muted' : s === 'ON_HOLD' ? 'warn' : 'neutral');

export default async function InventoryPage() {
  const { db, staff } = await getStaff();
  if (!staff) redirect('/login');

  const [{ data: projectsRaw }, { data: plotsRaw }, { data: ddRaw }, { data: rule }] = await Promise.all([
    db.from('projects').select('id,code,name,project_type,city,locality,approval_status,approval_authority,approval_number,rera_number,total_area_acres,plots_total,price_per_sqft,guideline_value_per_sqft,launch_price_per_sqft,status').order('name'),
    db.from('plots').select('project_id,status'),
    db.from('property_due_diligence').select('project_id,item_key,status,finding').not('project_id', 'is', null),
    db.from('compliance_rules').select('value').eq('key', 'property.min_dd_items').maybeSingle(),
  ]);

  const projects = (projectsRaw ?? []) as ProjectListRow[];
  const plots = (plotsRaw ?? []) as PlotLite[];
  const dd = (ddRaw ?? []) as DdItemRow[];
  const minimumItems = Array.isArray(rule?.value) ? (rule.value as unknown[]).map(String) : [];

  const plotsByProject = new Map<string, PlotLite[]>();
  for (const p of plots) plotsByProject.set(p.project_id, [...(plotsByProject.get(p.project_id) ?? []), p]);
  const ddByProject = new Map<string, DdItemRow[]>();
  for (const d of dd) if (d.project_id) ddByProject.set(d.project_id, [...(ddByProject.get(d.project_id) ?? []), d]);

  const rows = projects.map((pr) => {
    const pp = plotsByProject.get(pr.id) ?? [];
    const countOf = (s: string) => pp.filter((p) => p.status === s).length;
    const price = num(pr.price_per_sqft);
    const guideline = num(pr.guideline_value_per_sqft);
    const scorecard = ddScorecard(ddByProject.get(pr.id) ?? [], minimumItems);
    return {
      ...pr,
      total: pp.length || (num(pr.plots_total) ?? 0),
      available: countOf('AVAILABLE'),
      held: countOf('HELD') + countOf('RESERVED'),
      booked: countOf('BOOKED'),
      registered: countOf('REGISTERED'),
      price,
      guideline,
      ratio: price !== null && guideline ? price / guideline : null,
      launch: num(pr.launch_price_per_sqft),
      acres: num(pr.total_area_acres),
      scorecard,
    };
  });

  const totals = {
    projects: rows.length,
    plots: rows.reduce((s, r) => s + r.total, 0),
    available: rows.reduce((s, r) => s + r.available, 0),
    held: rows.reduce((s, r) => s + r.held, 0),
    ready: rows.filter((r) => r.scorecard.overall === 'READY').length,
    blocked: rows.filter((r) => r.scorecard.overall === 'BLOCKED').length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects &amp; plot inventory</h1>
          <p className="text-xs text-ink-400">Every project carries a legal due-diligence scorecard. Only projects whose minimum DD items are VERIFIED are recommendable to clients; proposed infrastructure is never shown as existing.</p>
        </div>
        <Badge tone="muted">Minimum DD items: {minimumItems.length ? minimumItems.map((k) => k.replace(/_/g, ' ')).join(', ') : 'rule not configured'}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(
          [
            ['Projects', totals.projects, 'muted'],
            ['Plots', totals.plots, 'muted'],
            ['Available', totals.available, 'good'],
            ['Held / reserved', totals.held, totals.held ? 'warn' : 'muted'],
            ['DD ready', totals.ready, totals.ready ? 'good' : 'muted'],
            ['DD blocked', totals.blocked, totals.blocked ? 'bad' : 'good'],
          ] as Array<[string, number, 'good' | 'warn' | 'bad' | 'muted' | 'gold']>
        ).map(([label, v, tone]) => (
          <div key={label} className="panel p-3">
            <Stat label={label} value={<span className="mono text-2xl">{v}</span>} tone={tone} />
          </div>
        ))}
      </div>

      <Panel title="Projects" right={<Badge tone="muted">{rows.length}</Badge>}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Type</th>
                  <th>Location</th>
                  <th>Approval</th>
                  <th>RERA</th>
                  <th className="text-right">Area</th>
                  <th className="text-right">Plots</th>
                  <th className="text-right">Avail</th>
                  <th className="text-right">Held</th>
                  <th className="text-right">Booked</th>
                  <th className="text-right">Regd</th>
                  <th className="text-right">Price / sq ft</th>
                  <th className="text-right">Guideline</th>
                  <th className="text-right">Ratio</th>
                  <th className="text-right">Launch</th>
                  <th>Status</th>
                  <th>Due diligence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/inventory/${r.id}`} className="font-medium text-gold-300 hover:underline">
                        {r.name}
                      </Link>
                      <div className="mono text-[11px] text-ink-400">{r.code}</div>
                    </td>
                    <td className="text-ink-300">{r.project_type.replace(/_/g, ' ')}</td>
                    <td className="text-ink-300">{[r.locality, r.city].filter(Boolean).join(', ')}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tone={approvalTone(r.approval_status)}>{(r.approval_status ?? 'UNKNOWN').replace(/_/g, ' ')}</Badge>
                        {r.approval_authority ? <span className="text-xs text-ink-300">{r.approval_authority}</span> : null}
                      </div>
                      {r.approval_number ? <div className="mono text-[11px] text-ink-400">{r.approval_number}</div> : null}
                    </td>
                    <td className="mono text-xs">{r.rera_number ?? <span className="text-ink-500">-</span>}</td>
                    <td className="mono text-right">{r.acres !== null ? `${r.acres} ac` : '-'}</td>
                    <td className="mono text-right">{r.total}</td>
                    <td className="mono text-right text-emerald-300">{r.available}</td>
                    <td className="mono text-right">{r.held}</td>
                    <td className="mono text-right">{r.booked}</td>
                    <td className="mono text-right">{r.registered}</td>
                    <td className="mono text-right">{perSqft(r.price)}</td>
                    <td className="mono text-right text-ink-300">{perSqft(r.guideline)}</td>
                    <td className="mono text-right">
                      {r.ratio !== null ? <span className={r.ratio > 2 ? 'text-amber-300' : r.ratio < 1 ? 'text-blue-300' : ''}>{r.ratio.toFixed(2)}x</span> : '-'}
                    </td>
                    <td className="mono text-right text-ink-300">{perSqft(r.launch)}</td>
                    <td>
                      <Badge tone={statusTone(r.status)}>{r.status.replace(/_/g, ' ')}</Badge>
                    </td>
                    <td>
                      <Badge tone={DD_TONE[r.scorecard.overall]} title={r.scorecard.criticalIssues[0] ?? r.scorecard.pendingItems[0] ?? (r.scorecard.minimumMet ? 'All minimum items verified' : 'Minimum DD items not yet verified')}>
                        DD {r.scorecard.overall}
                      </Badge>
                      {r.scorecard.criticalIssues.length ? <div className="mt-0.5 text-[11px] text-red-300">{r.scorecard.criticalIssues.length} critical</div> : r.scorecard.pendingItems.length ? <div className="mt-0.5 text-[11px] text-amber-300">{r.scorecard.pendingItems.length} pending</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No projects recorded yet.</Empty>
        )}
      </Panel>
      <p className="text-[11px] text-ink-500">Ratio = current price per sq ft divided by the guideline value. Plot counts are aggregated from the plot register; the project&apos;s declared plot total is used only when no plots are registered.</p>
    </div>
  );
}
