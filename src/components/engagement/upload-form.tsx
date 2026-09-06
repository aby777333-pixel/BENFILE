'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, StatusBadge } from '@/components/ui/badges';

export interface UploadDocType {
  key: string;
  label: string;
  room: string;
}

interface UploadResult {
  id: string;
  docType: string;
  consistency: Array<{ check: string; status: string; explanation: string }>;
  tamper: Array<{ signal: string; detail: string }>;
  duplicateOf: string | null;
  extraction: string;
}

const ROOM_ORDER = ['KYC', 'PROPERTY', 'FINANCIAL', 'AIF', 'GENERAL'];

async function postUpload(fd: FormData): Promise<UploadResult | { error: string }> {
  const r = await fetch('/api/documents/upload', { method: 'POST', body: fd });
  const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as UploadResult | { error: string };
  if (!r.ok) return { error: 'error' in j ? j.error : `HTTP ${r.status}` };
  return j;
}

/** Multipart upload to /api/documents/upload with the pipeline result shown inline. */
export function UploadForm({ clientId, docTypes }: { clientId: string; docTypes: UploadDocType[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  const rooms = ROOM_ORDER.filter((r) => docTypes.some((d) => d.room === r));

  return (
    <form
      ref={formRef}
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        const file = fd.get('file');
        if (!(file instanceof File) || !file.size) {
          setError('Choose a file first');
          return;
        }
        setBusy(true);
        setError(null);
        setResult(null);
        const r = await postUpload(fd);
        setBusy(false);
        if ('error' in r) {
          setError(r.error);
          return;
        }
        setResult(r);
        form.reset();
        router.refresh();
      }}
    >
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label">File (PDF, image, JSON, CSV, text; max 50 MB)</label>
          <input type="file" name="file" className="input" accept=".pdf,.jpg,.jpeg,.png,.webp,.json,.csv,.txt,application/pdf,image/*,application/json,text/csv,text/plain" required />
        </div>
        <div>
          <label className="label">Document type</label>
          <select name="docType" className="input" defaultValue="">
            <option value="">Auto-classify from file name</option>
            {rooms.map((room) => (
              <optgroup key={room} label={room}>
                {docTypes
                  .filter((d) => d.room === room)
                  .map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Title</label>
        <input name="title" className="input" placeholder="Defaults to the file name" />
      </div>
      <button type="button" className="text-xs text-gold-300 hover:underline" onClick={() => setShowOptional((v) => !v)}>
        {showOptional ? 'Hide' : 'Show'} fields printed on the document (optional)
      </button>
      {showOptional ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <input name="documentNumber" className="input" placeholder="Document number (stored masked; audited reveal only)" autoComplete="off" />
          <input name="nameOnDocument" className="input" placeholder="Name as printed on the document" />
          <div>
            <label className="label">Date of birth on document</label>
            <input name="dobOnDocument" type="date" className="input" />
          </div>
          <input name="addressOnDocument" className="input" placeholder="Address as printed" />
          <div>
            <label className="label">Issue date</label>
            <input name="issueDate" type="date" className="input" />
          </div>
          <div>
            <label className="label">Expiry date</label>
            <input name="expiryDate" type="date" className="input" />
          </div>
          <input name="issuingAuthority" className="input sm:col-span-2" placeholder="Issuing authority" />
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-ink-500">Stored in a private bucket. Recorded as CLIENT DECLARED until reviewed; never presented as government-verified.</span>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Uploading...' : 'Upload'}
        </button>
      </div>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      {result ? <UploadResultView r={result} /> : null}
    </form>
  );
}

function UploadResultView({ r }: { r: UploadResult }) {
  return (
    <div className="rounded-lg border border-white/10 bg-ink-900 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="good">Uploaded</Badge>
        <Badge tone="neutral">{r.docType.replace(/_/g, ' ')}</Badge>
        <Badge tone={r.extraction === 'PARSED' ? 'info' : 'warn'}>extraction {r.extraction}</Badge>
        {r.duplicateOf ? <Badge tone="warn">Duplicate of an existing file</Badge> : null}
      </div>
      {r.consistency.length ? (
        <ul className="mt-2 space-y-1">
          {r.consistency.map((c) => (
            <li key={c.check} className="flex flex-wrap items-center gap-1.5">
              <span className="mono text-ink-300">{c.check.replace(/_/g, ' ')}</span>
              <StatusBadge status={c.status} />
              <span className="text-ink-400">{c.explanation}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-ink-500">No consistency checks ran (no verified profile or no comparable fields). Add them in the evidence viewer.</p>
      )}
      {r.tamper.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {r.tamper.map((t) => (
            <li key={t.signal} title={t.detail}>
              <Badge tone="warn">Possible tamper signal: {t.signal.replace(/_/g, ' ')}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Photo upload (profile / ID verification / selfie). Appearance is never analysed for profiling. */
export function PhotoUploadForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        fd.set('purpose', 'PHOTO');
        const file = fd.get('file');
        if (!(file instanceof File) || !file.size) {
          setMsg({ ok: false, text: 'Choose an image first' });
          return;
        }
        setBusy(true);
        setMsg(null);
        const r = await postUpload(fd);
        setBusy(false);
        if ('error' in r) {
          setMsg({ ok: false, text: r.error });
          return;
        }
        setMsg({ ok: true, text: 'Photo stored. Previous photo for this purpose is no longer current.' });
        form.reset();
        router.refresh();
      }}
    >
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
        <input type="file" name="file" className="input" accept="image/*" required />
        <select name="photoPurpose" className="input" defaultValue="PROFILE">
          <option value="PROFILE">Profile</option>
          <option value="ID_VERIFICATION">ID verification</option>
          <option value="SELFIE">Selfie</option>
        </select>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Uploading...' : 'Upload photo'}
        </button>
      </div>
      {msg ? <p className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p> : null}
    </form>
  );
}
