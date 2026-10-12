'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createProspect } from '@/lib/actions';

/** Creates a prospect with no data and hands the RM a Part A consent link to share with the person. */
export function ProspectForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ link: string; clientId: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          setCopied(false);
          start(async () => {
            const r = await createProspect(fd);
            if (r.ok && r.link && r.clientId) {
              setResult({ link: `${window.location.origin}${r.link}`, clientId: r.clientId, message: r.message ?? 'Created' });
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
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.link);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-amber-300">Send this to the person directly (WhatsApp or e-mail to them, never a group). They accept Part A on their phone; the acceptance becomes the consent reference. Nothing is searched until then.</p>
          <a href={`/clients/${result.clientId}`} className="mt-2 inline-block text-xs text-gold-300 hover:underline">
            Open prospect record
          </a>
        </div>
      ) : null}
    </div>
  );
}
