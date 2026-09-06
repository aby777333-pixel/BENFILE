'use client';
import { useCallback, useEffect, useState } from 'react';
import { reviewDocument } from '@/lib/actions-wealth';
import { ActionForm } from '@/components/ui/action-form';
import { Badge, EvidenceBadge, StatusBadge } from '@/components/ui/badges';

type SignedState = { status: 'idle' | 'loading' | 'ready' | 'error'; url: string | null; error: string | null };

async function fetchSignedUrl(id: string): Promise<string> {
  const r = await fetch(`/api/documents/${id}/url`, { cache: 'no-store' });
  const j = (await r.json()) as { url?: string; error?: string };
  if (!r.ok || !j.url) throw new Error(j.error ?? 'Could not obtain a signed URL');
  return j.url;
}

/** Renders a document or photo from a short-lived signed URL (120 s). Every fetch is audit-logged server-side. */
export function DocumentViewer({ id, mime, kind = 'document', autoLoad = false, className }: { id: string; mime: string | null; kind?: 'document' | 'photo'; autoLoad?: boolean; className?: string }) {
  const [state, setState] = useState<SignedState>({ status: 'idle', url: null, error: null });
  const load = useCallback(async () => {
    setState({ status: 'loading', url: null, error: null });
    try {
      const url = await fetchSignedUrl(id);
      setState({ status: 'ready', url, error: null });
      setTimeout(() => setState((s) => (s.url === url ? { status: 'idle', url: null, error: null } : s)), 115_000);
    } catch (e) {
      setState({ status: 'error', url: null, error: (e as Error).message });
    }
  }, [id]);
  useEffect(() => {
    if (autoLoad) void load();
  }, [autoLoad, load]);

  const isPdf = (mime ?? '').includes('pdf');
  const isImage = (mime ?? '').startsWith('image/');
  if (state.status === 'ready' && state.url) {
    return (
      <div className={className}>
        {isPdf ? (
          <iframe src={state.url} title={`${kind} ${id}`} className="h-[520px] w-full rounded border border-white/10 bg-ink-950" />
        ) : isImage || kind === 'photo' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={state.url} alt={kind === 'photo' ? 'Client photo (operational use only)' : 'Document preview'} className="max-h-[520px] w-auto max-w-full rounded border border-white/10 bg-ink-950 object-contain" />
        ) : (
          <a href={state.url} target="_blank" rel="noreferrer noopener" className="btn btn-sm">
            Open file (new tab)
          </a>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10.5px] text-ink-500">
          <span>Signed link expires in about 2 minutes.</span>
          <button type="button" className="text-ink-300 hover:text-ink-100" onClick={() => setState({ status: 'idle', url: null, error: null })}>
            Hide
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={className}>
      <button type="button" className="btn btn-sm" onClick={() => void load()} disabled={state.status === 'loading'}>
        {state.status === 'loading' ? 'Fetching...' : state.status === 'idle' && autoLoad ? 'Reload' : 'View'}
      </button>
      {state.status === 'error' ? <span className="ml-2 text-[11px] text-red-300">{state.error}</span> : null}
    </div>
  );
}

export interface EvidenceDoc {
  id: string;
  title: string;
  typeLabel: string;
  room: string;
  mime_type: string | null;
  status: string;
  review_status: string;
  evidence_class: string;
  extraction_status: string;
  name_on_document: string | null;
  dob_on_document: string | null;
  address_on_document: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_authority: string | null;
  number_masked: string | null;
  extracted: Record<string, unknown>;
  consistency: Array<{ check: string; status: string; left: string | null; right: string | null; explanation: string }>;
  tamper_signals: Array<{ signal: string; detail: string }>;
  duplicate_of: string | null;
  review_note: string | null;
  verification_provider: string | null;
  refreshFlag: string;
}

const DECISIONS: Array<{ value: string; label: string; tone: 'primary' | 'danger' | 'plain'; needsVerifyRole?: boolean }> = [
  { value: 'VERIFIED', label: 'Approve (verified)', tone: 'primary', needsVerifyRole: true },
  { value: 'REJECTED', label: 'Reject', tone: 'danger' },
  { value: 'REPLACEMENT_REQUIRED', label: 'Request new copy', tone: 'plain' },
  { value: 'UNREADABLE', label: 'Unreadable', tone: 'plain' },
  { value: 'EXPIRED', label: 'Expired', tone: 'plain' },
  { value: 'UNDER_REVIEW', label: 'Escalate', tone: 'plain' },
];

/** Side-by-side evidence viewer: file on the left, extracted fields / checks / review decision on the right. */
export function DocumentEvidenceViewer({ docs, initialId, canReview, canVerify }: { docs: EvidenceDoc[]; initialId: string | null; canReview: boolean; canVerify: boolean }) {
  const [selected, setSelected] = useState<string>(initialId ?? docs[0]?.id ?? '');
  useEffect(() => {
    if (initialId) setSelected(initialId);
  }, [initialId]);
  const doc = docs.find((d) => d.id === selected) ?? null;
  const extractedEntries = doc ? Object.entries(doc.extracted).filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object') : [];

  if (!docs.length) return <p className="text-sm text-ink-400">Upload a document to open the evidence viewer.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="label mb-0">Document</label>
        <select className="input max-w-md" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.room} - {d.typeLabel} - {d.title}
            </option>
          ))}
        </select>
      </div>
      {doc ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">File</div>
            <DocumentViewer key={doc.id} id={doc.id} mime={doc.mime_type} autoLoad />
          </div>
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={doc.status} />
              <Badge tone="muted">review {doc.review_status.replace(/_/g, ' ')}</Badge>
              <EvidenceBadge kind={doc.evidence_class} />
              <Badge tone={doc.extraction_status === 'PENDING' ? 'warn' : 'neutral'}>extraction {doc.extraction_status}</Badge>
              {doc.refreshFlag !== 'CURRENT' ? <Badge tone={doc.refreshFlag === 'EXPIRED' ? 'bad' : 'warn'}>{doc.refreshFlag.replace(/_/g, ' ')}</Badge> : null}
              {doc.duplicate_of ? <Badge tone="warn">Duplicate file</Badge> : null}
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Fields on document</div>
              <dl className="kv mt-1 text-xs">
                <dt>Name</dt>
                <dd>{doc.name_on_document ?? <span className="text-ink-500">not captured</span>}</dd>
                <dt>Date of birth</dt>
                <dd>{doc.dob_on_document ?? <span className="text-ink-500">not captured</span>}</dd>
                <dt>Address</dt>
                <dd>{doc.address_on_document ?? <span className="text-ink-500">not captured</span>}</dd>
                <dt>Number</dt>
                <dd className="mono">{doc.number_masked ?? <span className="text-ink-500">not captured</span>}</dd>
                <dt>Issued / expires</dt>
                <dd>
                  {doc.issue_date ?? '-'} / {doc.expiry_date ?? '-'}
                </dd>
                <dt>Authority</dt>
                <dd>{doc.issuing_authority ?? '-'}</dd>
                {extractedEntries.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="mono">{k}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Consistency against Client 360</div>
              {doc.consistency.length ? (
                <ul className="mt-1 space-y-1 text-xs">
                  {doc.consistency.map((c) => (
                    <li key={c.check} className="rounded border border-white/[0.06] bg-ink-900 p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mono text-ink-300">{c.check.replace(/_/g, ' ')}</span>
                        <StatusBadge status={c.status} />
                      </div>
                      <div className="mt-0.5 text-ink-300">{c.explanation}</div>
                      {c.left || c.right ? (
                        <div className="mt-0.5 text-[11px] text-ink-400">
                          document: <span className="text-ink-200">{c.left ?? '-'}</span> / profile: <span className="text-ink-200">{c.right ?? '-'}</span>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-ink-500">No comparable fields yet. Enter name / date of birth below to run the checks on review.</p>
              )}
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Operational signals</div>
              {doc.tamper_signals.length ? (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {doc.tamper_signals.map((t) => (
                    <li key={t.signal} title={t.detail}>
                      <Badge tone="warn">Possible tamper signal: {t.signal.replace(/_/g, ' ')}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-ink-500">No file-level signals. Absence of a signal is not proof of authenticity.</p>
              )}
            </div>
            {doc.review_note ? <p className="text-[11px] text-gold-300">Reviewer note: {doc.review_note}</p> : null}
            {doc.verification_provider ? <p className="text-[11px] text-ink-400">Verification provider: {doc.verification_provider}</p> : null}
            {canReview ? (
              <ActionForm action={reviewDocument} className="rounded-lg border border-white/10 bg-ink-900 p-3">
                <input type="hidden" name="id" value={doc.id} />
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Review decision</div>
                {doc.extraction_status === 'PENDING' ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <input name="nameOnDocument" className="input" placeholder="Name as printed" />
                    <input name="dobOnDocument" type="date" className="input" title="Date of birth on document" />
                    <input name="expiryDate" type="date" className="input" title="Expiry date on document" />
                  </div>
                ) : null}
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input name="note" className="input" placeholder="Review note (audit-logged)" />
                  <input name="provider" className="input" placeholder="Verification provider (e.g. MANUAL_REVIEW)" />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {DECISIONS.map((d) => {
                    const disabled = d.needsVerifyRole && !canVerify;
                    return (
                      <button key={d.value} name="decision" value={d.value} disabled={disabled} title={disabled ? 'Marking VERIFIED requires a compliance / senior role' : undefined} className={`btn btn-sm ${d.tone === 'primary' ? 'btn-primary' : d.tone === 'danger' ? 'btn-danger' : ''}`}>
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10.5px] text-ink-500">Approving marks the document VERIFIED by human review. It does not change any identity field on the profile by itself.</p>
              </ActionForm>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
