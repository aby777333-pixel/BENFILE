'use client';
import { useState } from 'react';
import { updateDeclaredContact } from '@/lib/actions';
import { ActionForm } from '@/components/ui/action-form';

/** Edit the declared (unverified) mobile / e-mail on a client record. */
export function ContactEditForm({ clientId, hasPhone, hasEmail }: { clientId: string; hasPhone: boolean; hasEmail: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="btn btn-sm mt-2" onClick={() => setOpen(true)}>
        {hasPhone || hasEmail ? 'Edit contact' : 'Add contact'}
      </button>
    );
  return (
    <ActionForm action={updateDeclaredContact} className="mt-3 space-y-2" onDone={() => setOpen(false)}>
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label">Mobile</label>
          <input name="phone" className="input" inputMode="tel" autoComplete="off" placeholder={hasPhone ? 'Leave blank to keep' : '98400 12345'} />
          {hasPhone ? (
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-400">
              <input type="checkbox" name="clearPhone" /> Clear mobile
            </label>
          ) : null}
        </div>
        <div>
          <label className="label">E-mail</label>
          <input name="email" type="email" className="input" autoComplete="off" placeholder={hasEmail ? 'Leave blank to keep' : 'name@example.com'} />
          {hasEmail ? (
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-400">
              <input type="checkbox" name="clearEmail" /> Clear e-mail
            </label>
          ) : null}
        </div>
      </div>
      <p className="text-[11px] text-ink-500">Stored masked and hashed on the record; the full value is sealed and shown only with a logged reason. Marked as client-declared until an ownership check confirms it.</p>
      <div className="flex gap-2">
        <button className="btn btn-sm btn-primary">Save contact</button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </ActionForm>
  );
}
