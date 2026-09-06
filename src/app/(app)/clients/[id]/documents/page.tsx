import { loadClient } from '@/lib/db/load-client';
import { hasPermission } from '@/lib/security/permissions';
import { formatDateTime } from '@/lib/engines/normalize';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, ProvenanceTag, StatusBadge } from '@/components/ui/badges';
import { DocumentRequestForm, DocumentRequestUpdate } from '@/components/client360/document-forms';

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, role, db } = await loadClient(id, 'documents');
  const canRequest = hasPermission(role, 'documents:request');
  const [{ data: docs }, { data: reqs }] = await Promise.all([db.from('documents').select('*').eq('client_id', id).order('uploaded_at', { ascending: false }), db.from('document_requests').select('*').eq('client_id', id).order('requested_at', { ascending: false })]);
  const byName = Object.fromEntries(c360.staff.map((s) => [s.user_id, s.full_name]));
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <Panel title="Document requests" right={<Badge tone="muted">{reqs?.length ?? 0}</Badge>}>
          {reqs?.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.document_type}</td>
                    <td className="text-xs text-ink-300">{r.reason ?? '-'}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="text-xs">{byName[r.requested_by] ?? ''} {formatDateTime(r.requested_at)}</td>
                    <td>{canRequest && r.status === 'REQUESTED' ? <DocumentRequestUpdate id={r.id} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No document requests.</Empty>
          )}
        </Panel>
        <Panel title="Client-supplied documents" right={<ProvenanceTag kind="CLIENT_DECLARED" short />}>
          {docs?.length ? (
            <ul className="space-y-1 text-sm">
              {docs.map((d) => (
                <li key={d.id} className="flex justify-between border-b border-white/[0.05] py-1.5">
                  <span>{d.name} <span className="text-xs text-ink-400">{d.doc_type}</span></span>
                  <span className="text-xs text-ink-400">{formatDateTime(d.uploaded_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No documents on file. User-supplied documents are always labelled as such and never presented as government-verified.</Empty>
          )}
        </Panel>
      </div>
      <div>
        {canRequest ? (
          <Panel title="Request additional documents">
            <DocumentRequestForm clientId={id} />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
