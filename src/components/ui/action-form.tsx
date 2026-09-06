'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/lib/actions';

/** Thin wrapper around a server action: shows pending state, result message, and refreshes. */
export function ActionForm({ action, children, className, confirm, onDone, resetOnSuccess = true }: { action: (fd: FormData) => Promise<ActionResult>; children: React.ReactNode; className?: string; confirm?: string; onDone?: () => void; resetOnSuccess?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await action(fd);
          setMsg({ ok: r.ok, text: r.ok ? (r.message ?? 'Saved') : r.error });
          if (r.ok) {
            if (resetOnSuccess) form.reset();
            router.refresh();
            onDone?.();
          }
        });
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {msg ? <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p> : null}
    </form>
  );
}
