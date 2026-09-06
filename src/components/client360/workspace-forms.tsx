'use client';
import { useState } from 'react';
import { addNote, openCase, recordConsent, setClientStatus, updateCase } from '@/lib/actions';
import { ActionForm } from '@/components/ui/action-form';

type Staff = Array<{ user_id: string; full_name: string; role: string }>;

export function NoteForm({ clientId, cases }: { clientId: string; cases: Array<{ id: string; case_code: string }> }) {
  return (
    <ActionForm action={addNote}>
      <input type="hidden" name="clientId" value={clientId} />
      <textarea name="body" className="input h-24 resize-none" placeholder="Internal note - what you checked, what the client said, what remains open. Notes are analyst assessments, not verified facts." required minLength={2} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select name="kind" className="input w-40">
          <option value="NOTE">Note</option>
          <option value="ASSESSMENT">Assessment</option>
          <option value="ESCALATION">Escalation</option>
        </select>
        <select name="caseId" className="input w-44">
          <option value="">No case</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.case_code}
            </option>
          ))}
        </select>
        <button className="btn btn-primary">Add note</button>
      </div>
    </ActionForm>
  );
}

export function OpenCaseForm({ clientId, staff, me }: { clientId: string; staff: Staff; me: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      {!open ? (
        <button className="btn btn-sm" onClick={() => setOpen(true)}>
          Open a case
        </button>
      ) : (
        <ActionForm action={openCase} className="rounded-lg border border-white/10 bg-ink-900 p-3" onDone={() => setOpen(false)}>
          <input type="hidden" name="clientId" value={clientId} />
          <div className="grid gap-2 sm:grid-cols-[1fr_120px_180px_auto]">
            <input name="title" className="input" placeholder="Case title (e.g. Review mobile risk indicator)" required minLength={3} />
            <select name="priority" className="input" defaultValue="NORMAL">
              {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <select name="assignedTo" className="input" defaultValue={me}>
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.full_name}
                </option>
              ))}
            </select>
            <button className="btn btn-primary">Open</button>
          </div>
        </ActionForm>
      )}
    </div>
  );
}

export function UpdateCaseForm({ id, status, assignedTo, staff, canAssign, canEscalate }: { id: string; status: string; assignedTo: string | null; staff: Staff; canAssign: boolean; canEscalate: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <ActionForm action={updateCase} className="flex gap-1" resetOnSuccess={false}>
        <input type="hidden" name="id" value={id} />
        <select name="status" className="input w-36 py-1 text-xs" defaultValue={status}>
          {['OPEN', 'IN_REVIEW', ...(canEscalate ? ['ESCALATED'] : []), 'AWAITING_CLIENT', 'CLOSED'].map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <input name="closureReason" className="input w-36 py-1 text-xs" placeholder="Closure reason" />
        <button className="btn btn-sm">Set</button>
      </ActionForm>
      {canAssign ? (
        <ActionForm action={updateCase} className="flex gap-1" resetOnSuccess={false}>
          <input type="hidden" name="id" value={id} />
          <select name="assignedTo" className="input w-36 py-1 text-xs" defaultValue={assignedTo ?? ''}>
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {s.full_name}
              </option>
            ))}
          </select>
          <button className="btn btn-sm">Assign</button>
        </ActionForm>
      ) : null}
    </div>
  );
}

export function StatusForm({ clientId, current }: { clientId: string; current: string }) {
  return (
    <ActionForm action={setClientStatus} className="flex gap-2" resetOnSuccess={false} confirm="Change the profile status? This is audit-logged.">
      <input type="hidden" name="clientId" value={clientId} />
      <select name="status" className="input" defaultValue={current}>
        {['PENDING', 'VERIFIED', 'NEEDS_REVIEW', 'PARTIAL', 'REJECTED', 'ARCHIVED'].map((s) => (
          <option key={s} value={s}>
            {s.replace('_', ' ')}
          </option>
        ))}
      </select>
      <button className="btn">Update</button>
    </ActionForm>
  );
}

const SOURCES = ['IDENTITY', 'CONTACT', 'DOCUMENTS', 'ADDRESS', 'BANKING', 'EMPLOYMENT', 'MOBILE', 'CREDIT', 'RISK', 'CORPORATE', 'SCREENING', 'LEGAL', 'MEDIA', 'PROFESSIONAL', 'SOCIAL', 'WEB'];

export function ConsentForm({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      {!open ? (
        <button className="btn btn-sm" onClick={() => setOpen(true)}>
          Record consent
        </button>
      ) : (
        <ActionForm action={recordConsent} onDone={() => setOpen(false)}>
          <input type="hidden" name="clientId" value={clientId} />
          <label className="label">Purpose</label>
          <input name="purpose" className="input mb-2" defaultValue="KYC onboarding and ongoing due diligence" required />
          <label className="label">Purpose code</label>
          <select name="purposeCode" className="input mb-2">
            {['KYC_ONBOARDING', 'CREDIT_ASSESSMENT', 'EMPLOYMENT_VERIFICATION', 'INVESTOR_ONBOARDING', 'ENHANCED_DUE_DILIGENCE', 'PERIODIC_REVIEW'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <label className="label">Consent reference (form / e-sign id)</label>
          <input name="reference" className="input mb-2" />
          <label className="label">Expiry (optional)</label>
          <input name="expiresAt" type="date" className="input mb-2" />
          <label className="label">Sources authorised</label>
          <div className="mb-2 grid grid-cols-2 gap-1 text-xs">
            {SOURCES.map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input type="checkbox" name="sources" value={s} defaultChecked={!['SOCIAL', 'WEB'].includes(s)} /> {s}
              </label>
            ))}
          </div>
          <button className="btn btn-primary">Save consent</button>
        </ActionForm>
      )}
    </div>
  );
}
