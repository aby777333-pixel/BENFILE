import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/db/server';
import { hasPermission } from '@/lib/security/permissions';
import { formatDate } from '@/lib/engines/normalize';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, StatusBadge } from '@/components/ui/badges';
import { UpdateCaseForm } from '@/components/client360/workspace-forms';

export const dynamic = 'force-dynamic';

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ status?: string; mine?: string }> }) {
  const sp = await searchParams;
  const { db, staff } = await getStaff();
  if (!staff) redirect('/login');
  let q = db.from('cases').select('*,clients(client_code,display_name),assignee:staff_profiles!cases_assigned_to_fkey(full_name)').order('opened_at', { ascending: false }).limit(200);
  if (sp.status) q = q.eq('status', sp.status);
  if (sp.mine) q = q.eq('assigned_to', staff.userId);
  const [{ data: cases }, { data: staffList }] = await Promise.all([q, db.from('staff_profiles').select('user_id,full_name,role').eq('is_active', true).order('full_name')]);
  const canCase = hasPermission(staff.role, 'cases:manage');
  const canAssign = hasPermission(staff.role, 'cases:assign');
  const canEscalate = hasPermission(staff.role, 'risk:escalate');
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Cases</h1>
        <div className="flex gap-2 text-xs">
          <Link href="/cases" className={`btn btn-sm ${!sp.status && !sp.mine ? 'btn-primary' : ''}`}>All</Link>
          <Link href="/cases?mine=1" className={`btn btn-sm ${sp.mine ? 'btn-primary' : ''}`}>Mine</Link>
          {['OPEN', 'IN_REVIEW', 'ESCALATED', 'AWAITING_CLIENT', 'CLOSED'].map((s) => (
            <Link key={s} href={`/cases?status=${s}`} className={`btn btn-sm ${sp.status === s ? 'btn-primary' : ''}`}>
              {s.replace('_', ' ')}
            </Link>
          ))}
        </div>
      </div>
      <Panel>
        {cases?.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Client</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Assigned</th>
                  <th>Opened</th>
                  {canCase ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const cl = one(c.clients as { client_code: string; display_name: string } | null);
                  const as = one(c.assignee as { full_name: string } | null);
                  return (
                    <tr key={c.id}>
                      <td className="mono text-xs">{c.case_code}</td>
                      <td>
                        <Link href={`/clients/${c.client_id}/notes`} className="text-gold-300 hover:underline">
                          {cl?.client_code}
                        </Link>
                        <div className="text-xs text-ink-400">{cl?.display_name}</div>
                      </td>
                      <td className="font-medium">{c.title}</td>
                      <td><StatusBadge status={c.status} /></td>
                      <td><Badge tone={c.priority === 'URGENT' ? 'bad' : c.priority === 'HIGH' ? 'warn' : 'muted'}>{c.priority}</Badge></td>
                      <td className="text-xs">{as?.full_name ?? <span className="text-ink-400">Unassigned</span>}</td>
                      <td className="text-xs">{formatDate(c.opened_at)}</td>
                      {canCase ? (
                        <td>
                          <UpdateCaseForm id={c.id} status={c.status} assignedTo={c.assigned_to} staff={staffList ?? []} canAssign={canAssign} canEscalate={canEscalate} />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No cases match.</Empty>
        )}
      </Panel>
    </div>
  );
}
