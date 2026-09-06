import { loadClient } from '@/lib/db/load-client';
import { hasPermission } from '@/lib/security/permissions';
import { formatDate, formatDateTime } from '@/lib/engines/normalize';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, ProvenanceTag, StatusBadge } from '@/components/ui/badges';
import { ConsentForm, NoteForm, OpenCaseForm, StatusForm, UpdateCaseForm } from '@/components/client360/workspace-forms';

export default async function NotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, role, db, userId } = await loadClient(id, 'notes');
  const { data: notes } = await db.from('analyst_notes').select('*').eq('client_id', id).order('created_at', { ascending: false });
  const byName = Object.fromEntries(c360.staff.map((s) => [s.user_id, s.full_name]));
  const canNote = hasPermission(role, 'notes:write');
  const canCase = hasPermission(role, 'cases:manage');
  const canAssign = hasPermission(role, 'cases:assign');
  const canEscalate = hasPermission(role, 'risk:escalate');
  const canConsent = hasPermission(role, 'consent:manage');
  const canStatus = hasPermission(role, 'clients:write');
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <Panel title="Cases" right={<Badge tone="muted">{c360.cases.length}</Badge>}>
          {c360.cases.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Assigned</th>
                  <th>Opened</th>
                  {canCase ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {c360.cases.map((c) => (
                  <tr key={c.id}>
                    <td className="mono text-xs">{c.case_code}</td>
                    <td className="font-medium">{c.title}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td><Badge tone={c.priority === 'URGENT' ? 'bad' : c.priority === 'HIGH' ? 'warn' : 'muted'}>{c.priority}</Badge></td>
                    <td className="text-xs">{c.assignee?.full_name ?? <span className="text-ink-400">Unassigned</span>}</td>
                    <td className="text-xs">{formatDate(c.opened_at)}</td>
                    {canCase ? (
                      <td>
                        <UpdateCaseForm id={c.id} status={c.status} assignedTo={c.assigned_to} staff={c360.staff} canAssign={canAssign} canEscalate={canEscalate} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No cases opened for this client.</Empty>
          )}
          {canCase ? <OpenCaseForm clientId={id} staff={c360.staff} me={userId} /> : null}
        </Panel>
        <Panel title="Analyst notes" right={<ProvenanceTag kind="ANALYST_ASSESSMENT" short />}>
          {canNote ? <NoteForm clientId={id} cases={c360.cases} /> : null}
          {notes?.length ? (
            <ul className="mt-4 space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg border border-white/[0.06] bg-ink-900 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
                    <Badge tone={n.kind === 'ESCALATION' ? 'bad' : n.kind === 'ASSESSMENT' ? 'gold' : 'neutral'}>{n.kind}</Badge>
                    <span className="text-ink-200">{byName[n.author_id] ?? 'Staff'}</span>
                    <span>{formatDateTime(n.created_at)}</span>
                    {n.case_id ? <span className="mono">{c360.cases.find((c) => c.id === n.case_id)?.case_code}</span> : null}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-100">{n.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-400">No notes yet.</p>
          )}
        </Panel>
      </div>
      <div className="space-y-4">
        <Panel title="Profile status">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <StatusBadge status={c360.client.status} /> <span className="text-ink-400">review:</span> <StatusBadge status={c360.client.review_status} />
          </div>
          {canStatus ? <StatusForm clientId={id} current={c360.client.status} /> : null}
        </Panel>
        <Panel title="Consent & lawful purpose" right={<StatusBadge status={c360.client.consent_status} />}>
          {c360.consents.length ? (
            <ul className="space-y-2 text-xs">
              {c360.consents.map((c) => (
                <li key={c.id} className="rounded border border-white/[0.06] p-2">
                  <div className="flex items-center justify-between"><StatusBadge status={c.status} /><span className="mono text-ink-400">{c.purpose_code}</span></div>
                  <div className="mt-1 text-ink-100">{c.purpose}</div>
                  <div className="mt-1 text-ink-400">Granted {formatDate(c.granted_at)}{c.expires_at ? ` - expires ${formatDate(c.expires_at)}` : ' - no expiry'}</div>
                  <div className="mono text-ink-300">{c.sources_authorized.join(', ') || 'no sources listed'}</div>
                  {c.consent_reference ? <div className="text-ink-400">Ref {c.consent_reference}</div> : null}
                  {c.provider_key ? <div className="text-ink-400">Provider {c.provider_key}</div> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-amber-300">No consent recorded. Sensitive retrieval and external search are blocked until consent is captured.</p>
          )}
          {canConsent ? <ConsentForm clientId={id} /> : null}
        </Panel>
      </div>
    </div>
  );
}
