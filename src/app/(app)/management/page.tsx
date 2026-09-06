import Link from 'next/link';
import { AIF_STAGES } from '@/lib/wealth/aif-stages';
import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/db/server';
import { hasPermission } from '@/lib/security/permissions';
import { cr } from '@/lib/wealth/wealth-engine';
import { Panel, Stat, Empty } from '@/components/ui/panel';
import { Badge, StatusBadge } from '@/components/ui/badges';
import { CountBars } from '@/components/ops/management-charts';

export const dynamic = 'force-dynamic';

const inr = (v: number) => (v ? `INR ${cr(v)}` : 'INR 0');
const pct = (num: number, den: number) => (den ? `${Math.round((num / den) * 100)}%` : 'n/a');
const count = <T,>(rows: T[], key: (r: T) => string | null | undefined): Array<[string, number]> => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) ?? 'UNKNOWN';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

function Tiles({ tiles }: { tiles: Array<[string, React.ReactNode, ('good' | 'warn' | 'bad' | 'muted' | 'gold')?, React.ReactNode?]> }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {tiles.map(([label, v, tone, sub]) => (
        <div key={label} className="panel p-3">
          <Stat label={label} value={<span className="mono text-xl">{v}</span>} tone={tone} sub={sub} />
        </div>
      ))}
    </div>
  );
}

function CountTable({ rows, head = ['Item', 'Count'], empty = 'Nothing recorded yet.' }: { rows: Array<[string, React.ReactNode]>; head?: [string, string]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-ink-400">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>{head[0]}</th>
            <th className="text-right">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k.replace(/_/g, ' ')}</td>
              <td className="mono text-right">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ManagementPage() {
  const { db, staff } = await getStaff();
  if (!staff) redirect('/login');
  if (!(hasPermission(staff.role, 'audit:read') || hasPermission(staff.role, 'scoring:configure') || hasPermission(staff.role, 'cases:assign'))) redirect('/dashboard');

  const [{ data: clients }, { data: scores }, { data: suit }, { data: interactions }, { data: staffRows }, { data: cases }, { data: prefs }, { data: visits }, { data: interest }, { data: plots }, { data: projects }, { data: funds }] = await Promise.all([
    db.from('clients').select('id,client_code,assigned_to,consent_status,status').neq('status', 'ARCHIVED'),
    db.from('opportunity_scores').select('client_id,vertical,score,relevance'),
    db.from('aif_suitability').select('client_id,stage,kyc_status,risk_profile,expected_amount,commitment_amount,contributions,fund_id,compliance_approved_at'),
    db.from('interactions').select('client_id,kind,outcome,decline_reason,products_discussed'),
    db.from('staff_profiles').select('user_id,full_name,role').eq('is_active', true),
    db.from('cases').select('assigned_to,status,priority'),
    db.from('property_preferences').select('client_id,buyer_type,purpose'),
    db.from('site_visits').select('client_id,project_id,status'),
    db.from('plot_interest').select('client_id,plot_id,plots(project_id)'),
    db.from('plots').select('id,project_id,status,price,negotiated_price,release_date,held_for_client_id'),
    db.from('projects').select('id,code,name,locality,city'),
    db.from('aif_funds').select('id,name'),
  ]);

  const now = Date.now();
  const projectName = new Map((projects ?? []).map((p) => [p.id as string, `${p.code} ${p.name}`]));
  const staffName = new Map((staffRows ?? []).map((s) => [s.user_id as string, s.full_name as string]));
  const fundName = new Map((funds ?? []).map((f) => [f.id as string, f.name as string]));

  /* ---------------- AIF ---------------- */
  const leads = clients?.length ?? 0;
  const qualified = (scores ?? []).filter((s) => s.vertical === 'AIF' && (s.relevance === 'HIGH' || s.relevance === 'MEDIUM')).length;
  const suitRows = suit ?? [];
  const kycComplete = suitRows.filter((s) => s.kyc_status === 'COMPLETE').length;
  const suitabilityComplete = suitRows.filter((s) => s.risk_profile).length;
  const pipeline = suitRows.reduce((s, r) => s + Number(r.expected_amount ?? 0), 0);
  const committed = suitRows.reduce((s, r) => s + Number(r.commitment_amount ?? 0), 0);
  const funded = suitRows.reduce((s, r) => s + ((r.contributions as Array<{ amount?: number }> | null) ?? []).reduce((a, c) => a + Number(c.amount ?? 0), 0), 0);
  const committedCount = suitRows.filter((r) => Number(r.commitment_amount ?? 0) > 0).length;
  const avgTicketAif = committedCount ? committed / committedCount : suitRows.filter((r) => r.expected_amount).length ? pipeline / suitRows.filter((r) => r.expected_amount).length : 0;
  const converted = suitRows.filter((r) => ['FUNDING', 'REPORTING'].includes(r.stage)).length;
  const funnel = AIF_STAGES.map((st) => ({ label: st.replace(/_/g, ' '), value: suitRows.filter((r) => r.stage === st).length }));
  const isAif = (p: string[] | null) => !p?.length || p.some((x) => /AIF|PMS|FUND/i.test(x));
  const isProperty = (p: string[] | null) => !p?.length || p.some((x) => /PLOT|LAND|PROPERTY|VILLA|LAYOUT/i.test(x));
  const aifDropOffs = count((interactions ?? []).filter((i) => i.decline_reason && isAif(i.products_discussed as string[] | null)), (i) => i.decline_reason as string);
  const propertyDropOffs = count((interactions ?? []).filter((i) => i.decline_reason && isProperty(i.products_discussed as string[] | null)), (i) => i.decline_reason as string);
  const rmRows = (staffRows ?? []).map((s) => {
    const myClients = (clients ?? []).filter((c) => c.assigned_to === s.user_id);
    const ids = new Set(myClients.map((c) => c.id));
    return {
      id: s.user_id as string,
      name: s.full_name as string,
      role: String(s.role).replace(/_/g, ' '),
      clients: myClients.length,
      openCases: (cases ?? []).filter((c) => c.assigned_to === s.user_id && c.status !== 'CLOSED').length,
      journeys: suitRows.filter((r) => ids.has(r.client_id)).length,
      pipeline: suitRows.filter((r) => ids.has(r.client_id)).reduce((a, r) => a + Number(r.expected_amount ?? 0), 0),
      interactions: (interactions ?? []).filter((i) => ids.has(i.client_id)).length,
    };
  }).filter((r) => r.clients || r.openCases || r.journeys);

  /* ---------------- PROPERTY ---------------- */
  const plotRows = plots ?? [];
  const price = (p: { price: number | null; negotiated_price: number | null }) => Number(p.negotiated_price ?? p.price ?? 0);
  const propertyLeads = prefs?.length ?? 0;
  const buyersByType = count(prefs ?? [], (p) => p.buyer_type as string);
  const visitsByStatus = count(visits ?? [], (v) => v.status as string);
  const interestByProject = count(interest ?? [], (i) => {
    const pl = Array.isArray(i.plots) ? i.plots[0] : i.plots;
    const pid = (pl as { project_id?: string } | null)?.project_id;
    return pid ? (projectName.get(pid) ?? pid) : 'Unknown project';
  });
  const booked = plotRows.filter((p) => p.status === 'BOOKED').length;
  const registered = plotRows.filter((p) => p.status === 'REGISTERED').length;
  const pipelinePlots = plotRows.filter((p) => ['HELD', 'RESERVED', 'BOOKED'].includes(p.status));
  const propertyPipeline = pipelinePlots.reduce((s, p) => s + price(p), 0);
  const salesRows = plotRows.filter((p) => p.status === 'REGISTERED');
  const sales = salesRows.reduce((s, p) => s + price(p), 0);
  const avgTicketProperty = salesRows.length ? sales / salesRows.length : pipelinePlots.length ? propertyPipeline / pipelinePlots.length : 0;
  const visitedClients = new Set((visits ?? []).filter((v) => v.status === 'COMPLETED').map((v) => v.client_id as string));
  const convertedClients = new Set(plotRows.filter((p) => p.held_for_client_id && ['HELD', 'BOOKED', 'REGISTERED'].includes(p.status)).map((p) => p.held_for_client_id as string));
  const visitConverted = [...visitedClients].filter((c) => convertedClients.has(c)).length;
  const projectConversion = (projects ?? []).map((pr) => {
    const pp = plotRows.filter((p) => p.project_id === pr.id);
    const vv = (visits ?? []).filter((v) => v.project_id === pr.id);
    const sold = pp.filter((p) => p.status === 'BOOKED' || p.status === 'REGISTERED').length;
    const available = pp.filter((p) => p.status === 'AVAILABLE');
    const ages = available.filter((p) => p.release_date).map((p) => Math.max(0, Math.round((now - new Date(p.release_date as string).getTime()) / 86_400_000)));
    const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null;
    return { id: pr.id as string, name: `${pr.code} ${pr.name}`, where: [pr.locality, pr.city].filter(Boolean).join(', '), plots: pp.length, visits: vv.length, visitsDone: vv.filter((v) => v.status === 'COMPLETED').length, interest: (interest ?? []).filter((i) => ((Array.isArray(i.plots) ? i.plots[0] : i.plots) as { project_id?: string } | null)?.project_id === pr.id).length, sold, conversion: pct(sold, pp.length), available: available.length, avgAge, over90: ages.filter((a) => a > 90).length, over180: ages.filter((a) => a > 180).length };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Management dashboard</h1>
        <p className="text-xs text-ink-400">Aggregate view across both verticals. Client codes only - no personal identifiers. Figures rest on recorded stages and plot statuses, not forecasts.</p>
      </div>

      {/* ---------------- AIF ---------------- */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-gold-300">AIF vertical</h2>
          <Badge tone="muted">{funds?.length ?? 0} funds</Badge>
        </div>
        <Tiles
          tiles={[
            ['Leads (clients)', leads, 'muted'],
            ['Qualified investors', qualified, 'gold', 'AIF relevance high / medium'],
            ['KYC complete', kycComplete, 'good'],
            ['Suitability complete', suitabilityComplete, 'good', 'risk profile recorded'],
            ['Conversion', pct(converted, leads), converted ? 'good' : 'muted', `${converted} funded of ${leads}`],
            ['Pipeline value', inr(pipeline), 'gold', 'sum of expected amounts'],
            ['Committed capital', inr(committed), 'good'],
            ['Funded capital', inr(funded), 'good', 'sum of contributions'],
            ['Average ticket', inr(Math.round(avgTicketAif)), 'muted', committedCount ? 'on commitments' : 'on expected amounts'],
            ['Journeys in progress', suitRows.length - converted, 'warn'],
          ]}
        />
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Stage funnel" className="xl:col-span-2">
            <CountBars data={funnel} height={420} valueLabel="Clients" />
          </Panel>
          <div className="space-y-4">
            <Panel title="Drop-off reasons (AIF)">
              <CountTable rows={aifDropOffs.map(([k, v]) => [k, v])} head={['Reason', 'Count']} empty="No declined AIF interactions recorded." />
            </Panel>
            <Panel title="Funds">
              {funds?.length ? (
                <ul className="space-y-1 text-sm">
                  {(funds ?? []).map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 border-b border-white/[0.05] py-1">
                      <span className="truncate text-ink-200">{f.name}</span>
                      <span className="mono text-xs text-ink-400">{suitRows.filter((s) => s.fund_id === f.id).length} mapped</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-400">No funds configured.</p>
              )}
            </Panel>
          </div>
        </div>
        <Panel title="RM performance" right={<Link href="/rm" className="text-xs text-gold-300 hover:underline">RM cockpit</Link>}>
          {rmRows.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Role</th>
                    <th className="text-right">Clients</th>
                    <th className="text-right">Open cases</th>
                    <th className="text-right">AIF journeys</th>
                    <th className="text-right">Pipeline</th>
                    <th className="text-right">Interactions</th>
                  </tr>
                </thead>
                <tbody>
                  {rmRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td className="text-ink-300">{r.role}</td>
                      <td className="mono text-right">{r.clients}</td>
                      <td className="mono text-right">{r.openCases}</td>
                      <td className="mono text-right">{r.journeys}</td>
                      <td className="mono text-right">{inr(r.pipeline)}</td>
                      <td className="mono text-right">{r.interactions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No assignments yet.</Empty>
          )}
        </Panel>
        <Panel title="Journeys by fund and approval">
          <CountTable rows={count(suitRows, (s) => `${s.fund_id ? (fundName.get(s.fund_id) ?? 'Fund') : 'No fund selected'} - ${s.compliance_approved_at ? 'compliance approved' : 'awaiting compliance'}`).map(([k, v]) => [k, v])} head={['Fund / approval', 'Clients']} empty="No AIF journeys yet." />
        </Panel>
      </section>

      {/* ---------------- PROPERTY ---------------- */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-gold-300">Property vertical</h2>
          <Badge tone="muted">{projects?.length ?? 0} projects</Badge>
          <Link href="/inventory" className="text-xs text-gold-300 hover:underline">
            Inventory
          </Link>
        </div>
        <Tiles
          tiles={[
            ['Leads (buyers)', propertyLeads, 'muted', 'declared property requirements'],
            ['Site visits', visits?.length ?? 0, 'gold', `${visitsByStatus.map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ') || 'none'}`],
            ['Bookings', booked, 'good'],
            ['Registrations', registered, 'good'],
            ['Site-visit conversion', pct(visitConverted, visitedClients.size), visitConverted ? 'good' : 'muted', `${visitConverted} of ${visitedClients.size} visited clients hold / booked`],
            ['Pipeline value', inr(propertyPipeline), 'gold', 'held + reserved + booked'],
            ['Sales', inr(sales), 'good', 'registered plots'],
            ['Average ticket', inr(Math.round(avgTicketProperty)), 'muted', salesRows.length ? 'on registrations' : 'on pipeline'],
            ['Available plots', plotRows.filter((p) => p.status === 'AVAILABLE').length, 'muted'],
            ['Held plots', plotRows.filter((p) => p.status === 'HELD').length, 'warn'],
          ]}
        />
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Buyers by type">
            <CountTable rows={buyersByType.map(([k, v]) => [k, v])} head={['Buyer type', 'Clients']} empty="No property requirements declared." />
          </Panel>
          <Panel title="Site visits by status">
            <CountBars data={visitsByStatus.map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v }))} height={160} color="#4C8DFF" valueLabel="Visits" />
          </Panel>
          <Panel title="Project interest">
            <CountTable rows={interestByProject.map(([k, v]) => [k, v])} head={['Project', 'Plot enquiries']} empty="No plot interest recorded." />
          </Panel>
        </div>
        <Panel title="Project-wise conversion and inventory ageing">
          {projectConversion.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Location</th>
                    <th className="text-right">Plots</th>
                    <th className="text-right">Enquiries</th>
                    <th className="text-right">Visits (done)</th>
                    <th className="text-right">Booked + registered</th>
                    <th className="text-right">Conversion</th>
                    <th className="text-right">Available</th>
                    <th className="text-right">Avg age (days)</th>
                    <th className="text-right">&gt;90 d</th>
                    <th className="text-right">&gt;180 d</th>
                  </tr>
                </thead>
                <tbody>
                  {projectConversion.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/inventory/${p.id}`} className="text-gold-300 hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className="text-ink-300">{p.where}</td>
                      <td className="mono text-right">{p.plots}</td>
                      <td className="mono text-right">{p.interest}</td>
                      <td className="mono text-right">
                        {p.visits} ({p.visitsDone})
                      </td>
                      <td className="mono text-right">{p.sold}</td>
                      <td className="mono text-right">{p.conversion}</td>
                      <td className="mono text-right">{p.available}</td>
                      <td className="mono text-right">{p.avgAge ?? 'n/a'}</td>
                      <td className="mono text-right">{p.over90 ? <Badge tone="warn">{p.over90}</Badge> : 0}</td>
                      <td className="mono text-right">{p.over180 ? <Badge tone="bad">{p.over180}</Badge> : 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No projects configured.</Empty>
          )}
        </Panel>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Cancellation / decline reasons (property)">
            <CountTable rows={propertyDropOffs.map(([k, v]) => [k, v])} head={['Reason', 'Count']} empty="No declined property interactions recorded." />
          </Panel>
          <Panel title="Plot status mix">
            <CountTable rows={count(plotRows, (p) => p.status as string).map(([k, v]) => [k, <StatusBadge key={k} status={`${v}`} />])} head={['Status', 'Plots']} empty="No plots." />
          </Panel>
        </div>
      </section>
    </div>
  );
}
