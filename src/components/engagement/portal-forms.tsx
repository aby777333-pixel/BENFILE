'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { mintPortalLink, reviewPortalSubmission } from '@/lib/actions-wealth';
import { ActionForm } from '@/components/ui/action-form';

/** Mints a client-portal link (server RPC) and shows the absolute URL with a copy button. */
export function PortalLinkForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          setCopied(false);
          start(async () => {
            const r = await mintPortalLink(fd);
            if (r.ok && r.link) {
              setLink(`${window.location.origin}${r.link}`);
              router.refresh();
            } else if (!r.ok) {
              setError(r.error);
            } else {
              setError('No link returned');
            }
          });
        }}
      >
        <input type="hidden" name="clientId" value={clientId} />
        <div>
          <label className="label">Valid for (days)</label>
          <select name="days" className="input w-28" defaultValue="14">
            {[3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? 'Creating...' : 'Create portal link'}
        </button>
      </form>
      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
      {link ? (
        <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/[0.05] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="mono min-w-0 flex-1 break-all text-xs text-ink-100">{link}</code>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-amber-300">Share securely with the client only (never by open chat or public channels). The link expires and is shown once; create a new one if lost.</p>
        </div>
      ) : null}
    </div>
  );
}

export function PortalSubmissionReview({ id }: { id: string }) {
  return (
    <ActionForm action={reviewPortalSubmission} className="flex gap-1">
      <input type="hidden" name="id" value={id} />
      <button className="btn btn-sm btn-primary" name="decision" value="ACCEPTED">
        Accept
      </button>
      <button className="btn btn-sm btn-danger" name="decision" value="REJECTED">
        Reject
      </button>
    </ActionForm>
  );
}
