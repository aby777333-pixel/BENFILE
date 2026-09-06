'use client';
import { useState } from 'react';
import { Flag } from 'lucide-react';
import { raiseDispute } from '@/lib/actions';
import { ActionForm } from '@/components/ui/action-form';

export function DisputeButton({ clientId, entityTable, fieldKey }: { clientId: string; entityTable: string; fieldKey?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="inline-flex items-center gap-1 text-[11px] text-ink-400 hover:text-amber-300" onClick={() => setOpen((o) => !o)}>
        <Flag size={12} /> Flag data
      </button>
      {open ? (
        <ActionForm action={raiseDispute} className="mt-2 w-full rounded-lg border border-white/10 bg-ink-900 p-3" onDone={() => setOpen(false)}>
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="entityTable" value={entityTable} />
          {fieldKey ? <input type="hidden" name="fieldKey" value={fieldKey} /> : null}
          <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
            <select name="flag" className="input">
              {['INCORRECT', 'OUTDATED', 'WRONG_PERSON', 'DISPUTED', 'UNVERIFIED', 'SOURCE_ERROR'].map((f) => (
                <option key={f} value={f}>
                  {f.replace('_', ' ')}
                </option>
              ))}
            </select>
            <input name="reason" className="input" placeholder="Why is this data wrong or disputed?" required minLength={3} />
            <button className="btn btn-sm">Raise</button>
          </div>
          <p className="mt-1 text-[10.5px] text-ink-500">Disputed data stays visible with a dispute marker and is no longer presented as verified fact until resolved.</p>
        </ActionForm>
      ) : null}
    </>
  );
}
