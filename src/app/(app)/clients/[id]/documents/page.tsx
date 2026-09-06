import { loadClient } from '@/lib/db/load-client';
import { hasPermission } from '@/lib/security/permissions';
import { formatDate, formatDateTime } from '@/lib/engines/normalize';
import { DOC_TYPES, docTypeMeta, refreshDue } from '@/lib/wealth/documents-engine';
import type { ClientDocumentRow } from '@/lib/wealth/types';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, EvidenceBadge, ProvenanceTag, StatusBadge } from '@/components/ui/badges';
import { MaskedValue } from '@/components/ui/masked';
import { DocumentRequestForm, DocumentRequestUpdate } from '@/components/client360/document-forms';
import { DocumentEvidenceViewer, DocumentViewer, type EvidenceDoc } from '@/components/engagement/document-viewer';
import { PhotoUploadForm, UploadForm } from '@/components/engagement/upload-form';
import { PortalLinkForm, PortalSubmissionReview } from '@/components/engagement/portal-forms';

type DocRow = ClientDocumentRow & { client_id: string; review_note: string | null; verification_provider: string | null; reviewed_at: string | null };
type PhotoRow = { id: string; purpose: string; mime_type: string | null; size_bytes: number | null; uploaded_at: string; upload_source: string; verification_status: string; is_current: boolean };
type RequestRow = { id: string; document_type: string; reason: string | null; status: string; requested_by: string; requested_at: string };
type SubmissionRow = { id: string; kind: string; payload: Record<string, unknown>; status: string; created_at: string; reviewed_at: string | null };
type TokenRow = { id: string; expires_at: string; created_at: string; last_used_at: string | null; revoked: boolean };
type RefreshFlag = ReturnType<typeof refreshDue>['flag'];

const ROOMS: Array<{ key: string; label: string }> = [
  { key: 'KYC', label: 'KYC & identity' },
  { key: 'PROPERTY', label: 'Property' },
  { key: 'FINANCIAL', label: 'Financial' },
  { key: 'AIF', label: 'AIF / investment compliance' },
  { key: 'GENERAL', label: 'General' },
];

function flagTone(flag: RefreshFlag): 'good' | 'warn' | 'bad' | 'muted' {
  if (flag === 'EXPIRED') return 'bad';
  if (flag === 'STALE' || flag === 'REFRESH_REQUIRED') return 'warn';
  if (flag === 'AGEING') return 'muted';
  return 'good';
}

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { id } = await params;
  const { doc: selectedDoc } = await searchParams;
  const { c360, role, db } = await loadClient(id, 'documents');
  const canRequest = hasPermission(role, 'documents:request');
  const canUpload = canRequest || hasPermission(role, 'clients:write');
  const canReveal = hasPermission(role, 'sensitive:reveal');
  const canReviewPortal = hasPermission(role, 'clients:write');
  const [{ data: docsData }, { data: reqs }, { data: photosData }, { data: subsData }, { data: tokensData }] = await Promise.all([
    db.from('client_documents').select('*').eq('client_id', id).order('uploaded_at', { ascending: false }),
    db.from('document_requests').select('*').eq('client_id', id).order('requested_at', { ascending: false }),
    db.from('client_photos').select('id,purpose,mime_type,size_bytes,uploaded_at,upload_source,verification_status,is_current').eq('client_id', id).eq('is_current', true).order('uploaded_at', { ascending: false }),
    db.from('portal_submissions').select('id,kind,payload,status,created_at,reviewed_at').eq('client_id', id).order('created_at', { ascending: false }).limit(30),
    db.from('portal_tokens').select('id,expires_at,created_at,last_used_at,revoked').eq('client_id', id).order('created_at', { ascending: false }).limit(10),
  ]);
  const docs = (docsData ?? []) as DocRow[];
  const requests = (reqs ?? []) as RequestRow[];
  const photos = (photosData ?? []) as PhotoRow[];
  const submissions = (subsData ?? []) as SubmissionRow[];
  const tokens = (tokensData ?? []) as TokenRow[];
  const byName = Object.fromEntries(c360.staff.map((s) => [s.user_id, s.full_name]));
  const flags = new Map(docs.map((d) => [d.id, refreshDue(d.doc_type, d.uploaded_at, d.expiry_date).flag]));
  const evidenceDocs: EvidenceDoc[] = docs.map((d) => ({
    id: d.id,
    title: d.title,
    typeLabel: docTypeMeta(d.doc_type).label,
    room: d.room,
    mime_type: d.mime_type,
    status: d.status,
    review_status: d.review_status,
    evidence_class: d.evidence_class,
    extraction_status: d.extraction_status,
    name_on_document: d.name_on_document,
    dob_on_document: d.dob_on_document,
    address_on_document: d.address_on_document,
    issue_date: d.issue_date,
    expiry_date: d.expiry_date,
    issuing_authority: d.issuing_authority,
    number_masked: d.number_masked,
    extracted: d.extracted ?? {},
    consistency: d.consistency ?? [],
    tamper_signals: d.tamper_signals ?? [],
    duplicate_of: d.duplicate_of,
    review_note: d.review_note,
    verification_provider: d.verification_provider,
    refreshFlag: flags.get(d.id) ?? 'CURRENT',
  }));
  const attention = docs.filter((d) => ['EXPIRED', 'STALE', 'REFRESH_REQUIRED'].includes(flags.get(d.id) ?? 'CURRENT'));
  const profilePhoto = photos.find((p) => p.purpose === 'PROFILE') ?? photos[0] ?? null;
  const uploadTypes = DOC_TYPES.filter((t) => t.key !== 'PHOTOGRAPH').map((t) => ({ key: t.key, label: t.label, room: t.room }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Client photo" className="xl:col-span-1" right={profilePhoto ? <Badge tone="muted">{profilePhoto.purpose.replace(/_/g, ' ')}</Badge> : <Badge tone="muted">None</Badge>}>
          {profilePhoto ? (
            <div>
              <DocumentViewer id={profilePhoto.id} mime={profilePhoto.mime_type} kind="photo" autoLoad />
              <div className="mt-2 text-[11px] text-ink-400">
                Uploaded {formatDateTime(profilePhoto.uploaded_at)} via {profilePhoto.upload_source.replace(/_/g, ' ').toLowerCase()} - verification <span className="text-ink-200">{profilePhoto.verification_status.replace(/_/g, ' ').toLowerCase()}</span>
              </div>
              {photos.length > 1 ? (
                <ul className="mt-2 space-y-1 text-xs text-ink-300">
                  {photos
                    .filter((p) => p.id !== profilePhoto.id)
                    .map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2">
                        <span>{p.purpose.replace(/_/g, ' ')}</span>
                        <DocumentViewer id={p.id} mime={p.mime_type} kind="photo" />
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <Empty>No current photo on file.</Empty>
          )}
          {canUpload ? (
            <div className="mt-3">
              <PhotoUploadForm clientId={id} />
            </div>
          ) : null}
          <p className="mt-3 text-[11px] text-ink-500">Permitted uses: quality, crop, document-photo comparison via approved provider. Appearance is never analysed for trust, wealth or character.</p>
        </Panel>

        <Panel title="Upload document" className="xl:col-span-2" right={<ProvenanceTag kind="CLIENT_DECLARED" short />}>
          {canUpload ? <UploadForm clientId={id} docTypes={uploadTypes} /> : <p className="text-sm text-ink-400">Your role cannot upload documents.</p>}
          <p className="mt-3 text-[11px] text-ink-500">Pipeline: classify - hash - private storage - structured parse - consistency against Client 360 - duplicate and quality signals - expiry. Sensitive numbers are stored in the vault and shown masked. Tamper signals are operational hints, never a fraud verdict.</p>
        </Panel>
      </div>

      <Panel title="Documents by room" right={<Badge tone="muted">{docs.length}</Badge>}>
        {docs.length ? (
          <div className="space-y-5">
            {ROOMS.map((room) => {
              const rows = docs.filter((d) => d.room === room.key);
              if (!rows.length) return null;
              return (
                <div key={room.key}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-300">{room.label}</span>
                    <Badge tone="muted">{rows.length}</Badge>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Document</th>
                          <th>Number</th>
                          <th>On document</th>
                          <th>Issue / expiry</th>
                          <th>Status</th>
                          <th>Checks</th>
                          <th>Uploaded</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((d) => (
                          <DocumentRow key={d.id} d={d} flag={flags.get(d.id) ?? 'CURRENT'} canReveal={canReveal} uploader={d.uploaded_by ? (byName[d.uploaded_by] ?? 'Staff') : d.upload_source.replace(/_/g, ' ').toLowerCase()} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>No documents on file. User-supplied documents are always labelled as such and never presented as government-verified.</Empty>
        )}
      </Panel>

      <Panel id="evidence" title="Document evidence viewer" right={<Badge tone="muted">side-by-side</Badge>}>
        <DocumentEvidenceViewer docs={evidenceDocs} initialId={selectedDoc ?? null} canReview={canRequest} canVerify={canReveal} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Document requests" right={<Badge tone="muted">{requests.length}</Badge>}>
            {requests.length ? (
              <div className="overflow-x-auto">
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
                    {requests.map((r) => (
                      <tr key={r.id}>
                        <td className="font-medium">{r.document_type}</td>
                        <td className="text-xs text-ink-300">{r.reason ?? '-'}</td>
                        <td>
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="text-xs">
                          {byName[r.requested_by] ?? ''} {formatDateTime(r.requested_at)}
                        </td>
                        <td>{canRequest && r.status === 'REQUESTED' ? <DocumentRequestUpdate id={r.id} /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No document requests.</Empty>
            )}
          </Panel>

          <Panel title="Client portal" right={<Badge tone="muted">{submissions.filter((s) => s.status === 'PENDING_REVIEW').length} pending</Badge>}>
            {canRequest ? <PortalLinkForm clientId={id} /> : <p className="text-sm text-ink-400">Your role cannot create portal links.</p>}
            <div className="mt-4">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Submissions</div>
              {submissions.length ? (
                <ul className="mt-1.5 space-y-2">
                  {submissions.map((s) => (
                    <li key={s.id} className="rounded-lg border border-white/[0.06] bg-ink-900 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone="declared">{s.kind.replace(/_/g, ' ')}</Badge>
                          <StatusBadge status={s.status} />
                          <span className="text-[11px] text-ink-400">{formatDateTime(s.created_at)}</span>
                        </div>
                        {canReviewPortal && s.status === 'PENDING_REVIEW' ? <PortalSubmissionReview id={s.id} /> : null}
                      </div>
                      <pre className="mono mt-2 max-h-48 overflow-auto rounded bg-ink-950 p-2 text-[10.5px] text-ink-300">{JSON.stringify(s.payload, null, 2)}</pre>
                      <p className="mt-1 text-[10.5px] text-ink-500">Client-declared via portal. Accepting writes it as CLIENT DECLARED; it never becomes verified by acceptance.</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-xs text-ink-500">No portal submissions yet.</p>
              )}
            </div>
            <div className="mt-4">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Portal tokens</div>
              {tokens.length ? (
                <div className="mt-1.5 overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Created</th>
                        <th>Expires</th>
                        <th>Last used</th>
                        <th>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tokens.map((t) => {
                        const expired = new Date(t.expires_at).getTime() < Date.now();
                        return (
                          <tr key={t.id}>
                            <td className="text-xs">{formatDateTime(t.created_at)}</td>
                            <td className="text-xs">{formatDateTime(t.expires_at)}</td>
                            <td className="text-xs">{t.last_used_at ? formatDateTime(t.last_used_at) : 'never'}</td>
                            <td>{t.revoked ? <Badge tone="bad">Revoked</Badge> : expired ? <Badge tone="muted">Expired</Badge> : <Badge tone="good">Active</Badge>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-1.5 text-xs text-ink-500">No portal tokens issued. Token secrets are never stored or displayed; only their hash.</p>
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          {canRequest ? (
            <Panel title="Request additional documents">
              <DocumentRequestForm clientId={id} />
            </Panel>
          ) : null}
          <Panel title="Expiry & refresh" right={<Badge tone={attention.length ? 'warn' : 'good'}>{attention.length}</Badge>}>
            {attention.length ? (
              <ul className="space-y-2 text-xs">
                {attention.map((d) => {
                  const flag = flags.get(d.id) ?? 'CURRENT';
                  return (
                    <li key={d.id} className="rounded border border-white/[0.06] bg-ink-900 p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={flagTone(flag)}>{flag.replace(/_/g, ' ')}</Badge>
                        <span className="text-ink-100">{docTypeMeta(d.doc_type).label}</span>
                      </div>
                      <div className="mt-0.5 text-ink-400">
                        {d.title} - {d.expiry_date ? `expires ${formatDate(d.expiry_date)}` : `uploaded ${formatDate(d.uploaded_at)}`}
                        {d.refresh_due_on ? ` - refresh due ${formatDate(d.refresh_due_on)}` : ''}
                      </div>
                      <a href={`?doc=${d.id}#evidence`} className="mt-1 inline-block text-gold-300 hover:underline">
                        Open in evidence viewer
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-400">No document is expired, stale or due for refresh.</p>
            )}
            <p className="mt-3 text-[11px] text-ink-500">Refresh windows come from the document-type policy (for example bank statements 90 days, PAN 2 years). Expiring identity documents flag 90 days ahead.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function DocumentRow({ d, flag, canReveal, uploader }: { d: DocRow; flag: RefreshFlag; canReveal: boolean; uploader: string }) {
  const meta = docTypeMeta(d.doc_type);
  const consistency = d.consistency ?? [];
  const tamper = d.tamper_signals ?? [];
  return (
    <tr>
      <td>
        <div className="font-medium">{d.title}</div>
        <div className="text-[11px] text-ink-400">
          {meta.label}
          {d.version > 1 ? ` - v${d.version}` : ''}
          {d.issuing_authority ? ` - ${d.issuing_authority}` : ''}
        </div>
      </td>
      <td className="text-xs">
        <MaskedValue masked={d.number_masked} sensitiveId={d.sensitive_value_id} canReveal={canReveal} />
      </td>
      <td className="text-xs">
        <div>{d.name_on_document ?? <span className="text-ink-500">name n/a</span>}</div>
        <div className="text-ink-400">{d.dob_on_document ? `DOB ${formatDate(d.dob_on_document)}` : 'DOB n/a'}</div>
      </td>
      <td className="text-xs">
        <div>{d.issue_date ? formatDate(d.issue_date) : '-'}</div>
        <div className="text-ink-400">{d.expiry_date ? formatDate(d.expiry_date) : 'no expiry'}</div>
      </td>
      <td>
        <div className="flex flex-wrap gap-1">
          <StatusBadge status={d.status} />
          <Badge tone="muted">review {d.review_status.replace(/_/g, ' ')}</Badge>
          <EvidenceBadge kind={d.evidence_class} short />
          <Badge tone="muted">{d.access_level.replace(/_/g, ' ')}</Badge>
          <Badge tone={d.extraction_status === 'PENDING' ? 'warn' : 'neutral'}>extract {d.extraction_status}</Badge>
          <Badge tone={flagTone(flag)}>{flag.replace(/_/g, ' ')}</Badge>
        </div>
      </td>
      <td>
        <div className="flex flex-wrap gap-1">
          {consistency.map((c) => (
            <Badge key={c.check} tone={c.status === 'MATCH' ? 'good' : c.status === 'MISMATCH' ? 'bad' : c.status === 'PARTIAL_MATCH' ? 'warn' : 'muted'} title={c.explanation}>
              {c.check.replace(/_VS_PROFILE|_VS_IDENTITY/, '').replace(/_/g, ' ')}: {c.status === 'PARTIAL_MATCH' ? 'PARTIAL' : c.status.replace(/_/g, ' ')}
            </Badge>
          ))}
          {tamper.map((t) => (
            <Badge key={t.signal} tone="warn" title={t.detail}>
              Possible tamper signal
            </Badge>
          ))}
          {d.duplicate_of ? <Badge tone="warn">Duplicate</Badge> : null}
          {!consistency.length && !tamper.length && !d.duplicate_of ? <span className="text-[11px] text-ink-500">no checks</span> : null}
        </div>
      </td>
      <td className="text-xs">
        <div>{formatDateTime(d.uploaded_at)}</div>
        <div className="text-ink-400">{uploader}</div>
      </td>
      <td>
        <div className="flex flex-col gap-1">
          <DocumentViewer id={d.id} mime={d.mime_type} />
          <a href={`?doc=${d.id}#evidence`} className="text-[11px] text-gold-300 hover:underline">
            Evidence
          </a>
        </div>
      </td>
    </tr>
  );
}
