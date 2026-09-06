'use client';
import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';

/**
 * Renders a masked identifier. Roles with sensitive:reveal can request the full value;
 * the request goes through the audited reveal RPC and requires a reason.
 */
export function MaskedValue({ masked, sensitiveId, canReveal, kind }: { masked: string | null; sensitiveId?: string | null; canReveal: boolean; kind?: string }) {
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!masked) return <span className="text-ink-400">Not available</span>;

  async function reveal() {
    if (!sensitiveId) return;
    const reason = window.prompt('Reason for revealing this identifier (audit-logged):');
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: sensitiveId, reason }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Reveal failed');
      setFull(j.value);
      setTimeout(() => setFull(null), 45_000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="mono">{full ?? masked}</span>
      {kind ? <span className="text-[10px] uppercase tracking-wider text-ink-400">{kind}</span> : null}
      {sensitiveId ? (
        canReveal ? (
          full ? (
            <button type="button" className="text-ink-400 hover:text-ink-200" title="Hide" onClick={() => setFull(null)}>
              <EyeOff size={13} />
            </button>
          ) : (
            <button type="button" className="text-gold-300/80 hover:text-gold-300 disabled:opacity-40" title="Reveal (audit-logged)" onClick={reveal} disabled={busy}>
              <Eye size={13} />
            </button>
          )
        ) : (
          <span className="text-ink-500" title="Your role cannot reveal this field">
            <Lock size={12} />
          </span>
        )
      ) : null}
      {err ? <span className="text-[11px] text-red-300">{err}</span> : null}
    </span>
  );
}
