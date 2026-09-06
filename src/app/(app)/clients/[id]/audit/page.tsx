import { loadClient } from '@/lib/db/load-client';
import { formatDateTime } from '@/lib/engines/normalize';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badges';

export default async function ClientAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, db } = await loadClient(id, 'audit');
  const { data: logs } = await db.from('audit_logs').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(300);
  const byName = Object.fromEntries(c360.staff.map((s) => [s.user_id, s.full_name]));
  return (
    <Panel title="Audit trail for this client" right={<Badge tone="muted">append-only - {logs?.length ?? 0} shown</Badge>}>
      {logs?.length ? (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Role</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Field</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-xs">{formatDateTime(l.created_at)}</td>
                  <td className="text-xs">{byName[l.actor_id] ?? l.actor_id?.slice(0, 8) ?? 'system'}</td>
                  <td className="text-xs text-ink-400">{l.actor_role}</td>
                  <td><Badge tone={l.action.includes('reveal') ? 'bad' : l.action.includes('export') ? 'warn' : 'neutral'}>{l.action}</Badge></td>
                  <td className="mono text-xs">{l.entity_table ?? '-'}</td>
                  <td className="mono text-xs">{l.field_key ?? '-'}</td>
                  <td className="mono max-w-md truncate text-[10.5px] text-ink-400">{JSON.stringify(l.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No audit entries.</Empty>
      )}
    </Panel>
  );
}
