'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createProspect } from '@/lib/actions';
import { buildShareLinks, type ShareLinks } from '@/lib/portal/share-links';

/**
 * Creates a prospect with no verification data and hands the RM a Part A consent link.
 * Optional mobile / e-mail are stored masked + hashed (full value sealed, audited reveal) and used
 * here, in the browser only, to pre-fill a WhatsApp or e-mail message the RM sends themselves.
 */
export function ProspectForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ link: string; clientId: string; message: string; share: ShareLinks; sealed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'link' | 'message' | null>(null);
  const copy = async (text: string, what: 'link' | 'message') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };
  return (
    <div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          setCopied(null);
          start(async () => {
            const r = await createProspect(fd);
            if (r.ok && r.link && r.clientId) {
              const link = `${window.location.origin}${r.link}`;
              setResult({ link, clientId: r.clientId, message: r.message ?? 'Created', sealed: r.contactSealed ?? false, share: buildShareLinks({ name: String(fd.get('displayName') ?? ''), link, phone: String(fd.get('phone') ?? ''), email: String(fd.get('email') ?? ''), validDays: Number(fd.get('days') ?? 7) }) });
              router.refresh();
            } else if (!r.ok) setError(r.error);
          });
        }}
      >
        <div>
          <label className="label">Person&apos;s name (as they introduced themselves)</label>
          <input name="displayName" className="input" required minLength={2} placeholder="e.g. Arjun Venkatesh" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Mobile (optional)</label>
            <input name="phone" className="input" inputMode="tel" autoComplete="off" placeholder="98400 12345" />
          </div>
          <div>
            <label className="label">E-mail (optional)</label>
            <input name="email" type="email" className="input" autoComplete="off" placeholder="name@example.com" />
          </div>
          <div>
            <label className="label">City (optional)</label>
            <input name="city" className="input" placeholder="Chennai" />
          </div>
          <div>
            <label className="label">Link valid for (days)</label>
            <select name="days" className="input" defaultValue="7">
              {[3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-ink-500">Mobile and e-mail are kept masked and hashed; the full value is sealed and only revealed with a logged reason. They are used to send the link and, later, for one-time-code ownership checks under the person&apos;s consent.</p>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? 'Creating...' : 'Create prospect & consent link'}
        </button>
      </form>
      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
      {result ? (
        <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/[0.05] p-3">
          <p className="mb-2 text-xs text-emerald-300">{result.message}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="mono min-w-0 flex-1 break-all text-xs text-ink-100">{result.link}</code>
            <button type="button" className="btn btn-sm" onClick={() => copy(result.link, 'link')}>
              {copied === 'link' ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {result.share.whatsapp ? (
              <a href={result.share.whatsapp} target="_blank" rel="noreferrer noopener" className="btn btn-sm btn-primary">
                Open in WhatsApp
              </a>
            ) : null}
            {result.share.mailto ? (
              <a href={result.share.mailto} className="btn btn-sm">
                Open e-mail draft
              </a>
            ) : null}
            <button type="button" className="btn btn-sm" onClick={() => copy(result.share.message, 'message')}>
              {copied === 'message' ? 'Copied' : 'Copy message'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-amber-300">
            WhatsApp and e-mail open a pre-written message on your own device; nothing is sent until you press send there. Send it to the person directly, never a group. They accept Part A on their phone; the acceptance becomes the consent reference. Nothing is searched until then.
            {!result.sealed ? ' Your role stores contact details masked only (no sealed full value).' : ''}
          </p>
          <a href={`/clients/${result.clientId}`} className="mt-2 inline-block text-xs text-gold-300 hover:underline">
            Open prospect record
          </a>
        </div>
      ) : null}
    </div>
  );
}
