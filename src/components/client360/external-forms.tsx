'use client';
import { reviewFinding, runExternalIntelligence } from '@/lib/actions';
import { ActionForm } from '@/components/ui/action-form';
import { ModeBadge } from '@/components/ui/badges';

export function ExternalSearchForm({ clientId, connectors, hasRun, prefill }: { clientId: string; connectors: Array<{ key: string; name: string; mode: string; tier: number; requires: string[]; authorised: boolean }>; hasRun?: boolean; prefill?: { employer?: string | null; occupation?: string | null; city?: string | null; dob?: string | null; profiles?: string[] } }) {
  return (
    <ActionForm action={runExternalIntelligence} resetOnSuccess={false}>
      <input type="hidden" name="clientId" value={clientId} />
      <label className="label">Lawful purpose for this search</label>
      <input name="purpose" className="input mb-3" defaultValue={hasRun ? 'KYC / client due diligence' : 'Preliminary screening before initial consultation (Part A consent)'} required minLength={3} />
      <details className="mb-3 rounded border border-white/[0.08] p-2" open={!hasRun}>
        <summary className="cursor-pointer text-xs font-semibold text-ink-200">
          Matching details {hasRun ? '(optional - adds to the verified profile)' : '(prospect - no verification run yet)'}
        </summary>
        <p className="mb-2 mt-1 text-[11px] text-ink-500">Used only to separate this person from others with the same name. Pre-filled from what they gave when accepting consent. Never enter PAN, Aadhaar, phone or e-mail here - those enter through verification ingest with hashing.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input name="employer" className="input" placeholder="Current employer / business" defaultValue={prefill?.employer ?? ''} />
          <input name="occupation" className="input" placeholder="Occupation" defaultValue={prefill?.occupation ?? ''} />
          <input name="city" className="input" placeholder="City" defaultValue={prefill?.city ?? ''} />
          <input name="dob" type="date" className="input" defaultValue={prefill?.dob ?? ''} />
        </div>
        <textarea name="profiles" className="input mt-2 min-h-14" placeholder="Nominated public profile URLs, one per line" defaultValue={(prefill?.profiles ?? []).join('\n')} />
      </details>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {connectors.map((c) => (
          <label key={c.key} className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${c.authorised ? 'border-white/10' : 'border-white/[0.05] opacity-60'}`}>
            <input type="checkbox" name="connectors" value={c.key} defaultChecked={c.authorised} disabled={!c.authorised} />
            <span className="flex-1 text-ink-200">{c.name}</span>
            <span className="text-ink-500">T{c.tier}</span>
            <ModeBadge mode={c.mode} />
            {!c.authorised ? <span className="text-amber-300">needs {c.requires.join('/')}</span> : null}
          </label>
        ))}
      </div>
      <button className="btn btn-primary mt-3">Run external intelligence search</button>
      <p className="mt-2 text-[10.5px] text-ink-500">Connectors respect platform terms and rate limits, never bypass login controls or CAPTCHAs, and only collect public data. Sandbox connectors return illustrative records until licensed APIs are configured.</p>
    </ActionForm>
  );
}

export function FindingReview({ id }: { id: string }) {
  return (
    <ActionForm action={reviewFinding} className="w-full shrink-0 lg:w-64" resetOnSuccess={false}>
      <input type="hidden" name="id" value={id} />
      <input name="note" className="input mb-1.5" placeholder="Review note (optional)" />
      <div className="flex flex-wrap gap-1.5">
        <button className="btn btn-sm btn-primary" name="decision" value="ADDED">
          Add to profile
        </button>
        <button className="btn btn-sm" name="decision" value="REJECTED">
          Reject match
        </button>
        <button className="btn btn-sm" name="decision" value="FLAGGED">
          Mark for review
        </button>
      </div>
    </ActionForm>
  );
}
