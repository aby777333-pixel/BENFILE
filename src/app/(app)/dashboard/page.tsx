import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/db/server';
import { formatDateTime } from '@/lib/engines/normalize';
import { Panel, Stat, Empty } from '@/components/ui/panel';
import { Badge, SeverityBadge, StatusBadge } from '@/components/ui/badges';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { db, staff } = await getStaff();
  if (!staff) redirect('/login');
  const [{ data: stats }, { data: recent }, { data: myCases }, { data: awaiting }, { data: alerts }] = await Promise.all([
    db.rpc('dashboard_stats'),
    db.from('verification_runs').select('id,client_id,run_seq,status,ingested_at,provider_key,snapshot_label,clients!verification_runs_client_id_fkey(client_code,status,risk_level)').order('ingested_at', { ascending: false }).limit(8),
    db.from('cases').select('id,case_code,title,status,priority,client_id,opened_at,clients(client_code)').eq('assigned_to', staff.userId).neq('status', 'CLOSED').order('opened_at', { ascending: false }).limit(8),
    db.from('cases').select('id,case_code,title,status,priority,client_id,opened_at,clients(client_code)').in('status', ['OPEN', 'IN_REVIEW', 'ESCALATED']).order('opened_at', { ascending: false }).limit(8),
    db.from('risk_signals').select('id,client_id,title,severity,category,status,updated_at,clients(client_code)').in('severity', ['HIGH', 'CRITICAL']).not('status', 'in', '("DISMISSED","RESOLVED")').order('updated_at', { ascending: false }).limit(8),
  ]);
  const s = (stats ?? {}) as Record<string, number>;
  const code = (row: unknown) => {
    const c = (row as { clients?: { client_code?: string } | Array<{ client_code?: string }> }).clients;
    return Array.isArray(c) ? c[0]?.client_code : c?.client_code;
  };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Institutional dashboard</h1>
        <p className="text-xs text-ink-400">Aggregate view - no personal identifiers are shown here. Signed in as {staff.fullName}.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {[
          ['Clients verified', s.clients_verified, 'good'],
          ['Pending verification', s.pending_verification, 'muted'],
          ['Requiring review', s.requiring_review, 'warn'],
          ['High-risk alerts', s.high_risk_alerts, s.high_risk_alerts ? 'bad' : 'good'],
          ['Stale / aging profiles', s.stale_profiles, s.stale_profiles ? 'warn' : 'good'],
          ['Incomplete profiles', s.incomplete_profiles, 'muted'],
          ['Cases assigned to me', s.cases_mine, 'gold'],
          ['Cases awaiting review', s.cases_awaiting_review, 'warn'],
        ].map(([label, v, tone]) => (
          <div key={String(label)} className="panel p-3">
            <Stat label={String(label)} value={<span className="mono text-2xl">{v ?? 0}</span>} tone={tone as 'good'} />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Recent verification activity" right={<Badge tone="muted">{s.runs_last_7d ?? 0} runs in 7 days</Badge>}>
          {recent?.length ? (
            <ul className="space-y-1.5 text-sm">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 border-b border-white/[0.05] py-1.5">
                  <Link href={`/clients/${r.client_id}`} className="mono text-gold-300 hover:underline">
                    {code(r)}
                  </Link>
                  <span className="flex-1 truncate text-ink-300">
                    {r.snapshot_label} - {r.provider_key}
                  </span>
                  <StatusBadge status={r.status} />
                  <span className="text-xs text-ink-500">{formatDateTime(r.ingested_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>
              No verification runs yet.{' '}
              <Link href="/clients/new" className="text-gold-300">
                Ingest the first one
              </Link>
              .
            </Empty>
          )}
        </Panel>
        <Panel title="High-risk alerts" right={<Badge tone={alerts?.length ? 'bad' : 'good'}>{alerts?.length ?? 0}</Badge>}>
          {alerts?.length ? (
            <ul className="space-y-1.5 text-sm">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-center gap-2 border-b border-white/[0.05] py-1.5">
                  <SeverityBadge severity={a.severity} />
                  <Link href={`/clients/${a.client_id}/risk`} className="mono text-xs text-gold-300">
                    {code(a)}
                  </Link>
                  <span className="flex-1 truncate text-ink-200">{a.title}</span>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-400">No open high or critical signals.</p>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Cases assigned to me">
            {myCases?.length ? (
              <ul className="space-y-1.5 text-sm">
                {myCases.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 border-b border-white/[0.05] py-1.5">
                    <Link href={`/clients/${c.client_id}/notes`} className="mono text-xs text-gold-300">
                      {c.case_code}
                    </Link>
                    <span className="flex-1 truncate text-ink-200">{c.title}</span>
                    <StatusBadge status={c.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-400">Nothing assigned to you.</p>
            )}
          </Panel>
          <Panel title="Cases awaiting review">
            {awaiting?.length ? (
              <ul className="space-y-1.5 text-sm">
                {awaiting.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 border-b border-white/[0.05] py-1.5">
                    <Link href={`/clients/${c.client_id}/notes`} className="mono text-xs text-gold-300">
                      {c.case_code}
                    </Link>
                    <span className="flex-1 truncate text-ink-200">{c.title}</span>
                    <Badge tone={c.priority === 'URGENT' ? 'bad' : c.priority === 'HIGH' ? 'warn' : 'muted'}>{c.priority}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-400">No open cases.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
