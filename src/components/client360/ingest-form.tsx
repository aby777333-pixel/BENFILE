'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ingestFromForm } from '@/lib/actions';

const SOURCES = ['IDENTITY', 'CONTACT', 'DOCUMENTS', 'ADDRESS', 'BANKING', 'EMPLOYMENT', 'MOBILE', 'CREDIT', 'RISK', 'CORPORATE', 'SCREENING', 'LEGAL', 'MEDIA', 'PROFESSIONAL', 'SOCIAL', 'WEB'];

export function IngestForm({ clientId, samples }: { clientId: string | null; samples: Array<{ label: string; json: string }> }) {
  const [raw, setRaw] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await ingestFromForm(fd);
          setMsg({ ok: r.ok, text: r.ok ? (r.message ?? 'Ingested') : r.error });
          if (r.ok && r.clientId) router.push(`/clients/${r.clientId}`);
        });
      }}
    >
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-400">Provider response (JSON):</span>
        {samples.map((s) => (
          <button key={s.label} type="button" className="btn btn-sm" onClick={() => setRaw(s.json)}>
            {s.label}
          </button>
        ))}
      </div>
      <textarea name="raw" value={raw} onChange={(e) => setRaw(e.target.value)} className="input mono h-72 text-[11.5px]" placeholder='{"verification_id": "...", "data": { ... }}' required />
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">Snapshot label (optional)</label>
          <input name="label" className="input" placeholder={clientId ? 'e.g. Employment updated' : 'Initial verification'} />
        </div>
        {!clientId ? (
          <>
            <div>
              <label className="label">Lawful purpose</label>
              <input name="purpose" className="input" defaultValue="KYC onboarding and ongoing due diligence" required />
            </div>
            <div>
              <label className="label">Consent reference</label>
              <input name="consentReference" className="input" placeholder="Consent form / e-sign ID" />
            </div>
            <div>
              <label className="label">Consent expiry (optional)</label>
              <input name="expiresAt" type="date" className="input" />
            </div>
            <div className="md:col-span-2">
              <label className="label">Data sources authorised by the client</label>
              <div className="grid grid-cols-3 gap-1 text-xs sm:grid-cols-4 lg:grid-cols-8">
                {SOURCES.map((s) => (
                  <label key={s} className="flex items-center gap-1.5">
                    <input type="checkbox" name="sources" value={s} defaultChecked={!['SOCIAL', 'WEB'].includes(s)} /> {s}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-200 md:col-span-2">
              <input type="checkbox" name="consentConfirmed" required /> I confirm the client&apos;s consent and a lawful purpose are on file for this verification.
            </label>
          </>
        ) : (
          <input type="hidden" name="purpose" value="Re-verification under existing consent" />
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? 'Ingesting...' : clientId ? 'Ingest as new snapshot' : 'Ingest & build Client 360'}
        </button>
        {msg ? <span className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</span> : null}
      </div>
    </form>
  );
}
