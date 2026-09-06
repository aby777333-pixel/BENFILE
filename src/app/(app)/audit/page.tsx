import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/db/server';
import { hasPermission } from '@/lib/security/permissions';
import { formatDateTime } from '@/lib/engines/normalize';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badges';

export const dynamic = 'force-dynamic';

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; actor?: string }> }) {
  const sp = await searchParams;
  const { db, staff } = await getStaff();
  if (!staff || !hasPermission(staff.role, 'audit:read')) redirect('/dashboard');
  let q = db.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500);
  if (sp.action) q = q.ilike('action', `${sp.action}%`);
  if (sp.actor) q = q.eq('actor_id', sp.actor);
  const [{ data: logs }, { data: staffList }] = await Promise.all([q, db.from('staff_profiles').select('user_id,full_name')]);
  const byName = Object.fromEntries((staffList ?? []).map((s) => [s.user_id, s.full_name]));
  const actions = ['client.', 'sensitive.', 'evidence.', 'report.', 'risk.', 'case.', 'note.', 'external.', 'verification.', 'consent.', 'permissions.', 'scoring.', 'dispute.', 'document.', 'investor.'];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit trail</h1>
        <p className="text-xs text-ink-400">Append-only. Records who accessed which client, what was viewed, revealed, exported or changed. Not editable by any application role.</p>
      </div>
      <Panel>
        <form className="flex flex-wrap gap-2">
          <select name="action" defaultValue={sp.action ?? ''} className="input w-56">
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}*
              </option>
            ))}
          </select>
          <select name="actor" defaultValue={sp.actor ?? ''} className="input w-56">
            <option value="">All staff</option>
            {(staffList ?? []).map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {s.full_name}
              </option>
            ))}
          </select>
          <button className="btn">Filter</button>
        </form>
      </Panel>
      <Panel title="Entries" right={<Badge tone="muted">{logs?.length ?? 0}</Badge>}>
        {logs?.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Role</th>
                  <th>Action</th>
                  <th>Client</th>
                  <th>Entity</th>
                  <th>Field</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-xs">{formatDateTime(l.created_at)}</td>
                    <td className="text-xs">{byName[l.actor_id] ?? 'system'}</td>
                    <td className="text-xs text-ink-400">{l.actor_role}</td>
                    <td><Badge tone={l.action.includes('reveal') ? 'bad' : l.action.includes('export') || l.action.includes('permissions') ? 'warn' : 'neutral'}>{l.action}</Badge></td>
                    <td className="mono text-[10.5px] text-ink-400">{l.client_id ? <a href={`/clients/${l.client_id}/audit`} className="text-gold-300">{l.client_id.slice(0, 8)}</a> : '-'}</td>
                    <td className="mono text-xs">{l.entity_table ?? '-'}</td>
                    <td className="mono text-xs">{l.field_key ?? '-'}</td>
                    <td className="mono max-w-md truncate text-[10.5px] text-ink-400">{JSON.stringify(l.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No entries.</Empty>
        )}
      </Panel>
    </div>
  );
}
