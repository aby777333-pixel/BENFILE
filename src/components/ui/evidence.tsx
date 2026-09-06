'use client';
import { useEffect, useState } from 'react';
import { Eye, X } from 'lucide-react';
import type { EvidenceRef } from '@/lib/canonical/types';

/** Resolves a JSON pointer ("/data/personal/full_name") against an object. */
export function resolvePointer(obj: unknown, pointer: string | null | undefined): unknown {
  if (!pointer) return undefined;
  const parts = pointer.split('/').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

const SENSITIVE_RE = /(number|pan|aadhaar|passport|uan|member_id|email|account|phone|mobile|licen[cs]e|voter|control_number)/i;
function maskDeep(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(maskDeep);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (SENSITIVE_RE.test(k) && typeof val === 'string' && !/^X+/.test(val)) {
      const s = val.replace(/\s/g, '');
      out[k] = s.length > 4 ? `${s.slice(0, 2)}${'*'.repeat(Math.max(s.length - 4, 2))}${s.slice(-2)}` : '****';
    } else out[k] = maskDeep(val);
  }
  return out;
}

/**
 * Evidence drawer: shows the underlying provider record for a fact.
 * Fetches the raw payload through the audited evidence endpoint; sensitive keys are masked client-side too.
 */
export function EvidenceDrawer({ runId, evidence, title, trigger }: { runId: string | null; evidence: EvidenceRef[]; title?: string; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || raw || !runId) return;
    setLoading(true);
    fetch(`/api/evidence/${runId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? 'Failed');
        return r.json();
      })
      .then((j) => setRaw(j.payload))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [open, raw, runId]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[11px] font-medium text-gold-300 hover:underline">
        {trigger ?? (
          <>
            <Eye size={12} /> View evidence
          </>
        )}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setOpen(false)}>
          <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-ink-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="panel-title">Source evidence</div>
                <h2 className="text-base font-semibold">{title ?? 'Underlying record'}</h2>
                <p className="mt-1 text-xs text-ink-400">Values below are the provider&apos;s own record (sensitive keys masked). Viewing raw evidence is audit-logged.</p>
              </div>
              <button className="btn btn-sm" onClick={() => setOpen(false)}>
                <X size={14} />
              </button>
            </div>
            <ul className="mb-4 space-y-2">
              {evidence.map((e, i) => (
                <li key={i} className="rounded-lg border border-white/[0.07] bg-ink-850 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink-100">{e.label}</span>
                    <span className="text-[11px] text-ink-300">
                      Source: <span className="text-gold-300">{e.sourceKey}</span>
                      {e.path ? <span className="mono ml-2 text-ink-400">{e.path}</span> : null}
                    </span>
                  </div>
                  {e.value ? <div className="mono mt-1 text-ink-200">{e.value}</div> : null}
                  {raw && e.path ? (
                    <pre className="mono mt-2 max-h-48 overflow-auto rounded bg-ink-950 p-2 text-[11px] leading-relaxed text-ink-200">{JSON.stringify(maskDeep(resolvePointer(raw, e.path)) ?? null, null, 2)}</pre>
                  ) : null}
                </li>
              ))}
              {!evidence.length ? <li className="text-sm text-ink-400">No source record is attached to this item.</li> : null}
            </ul>
            {loading ? <p className="text-xs text-ink-400">Loading provider record...</p> : null}
            {err ? <p className="text-xs text-red-300">{err}</p> : null}
            {raw ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-ink-300">Full provider response (masked)</summary>
                <pre className="mono mt-2 max-h-[50vh] overflow-auto rounded bg-ink-950 p-3 text-[11px] leading-relaxed text-ink-200">{JSON.stringify(maskDeep(raw), null, 2)}</pre>
              </details>
            ) : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}
