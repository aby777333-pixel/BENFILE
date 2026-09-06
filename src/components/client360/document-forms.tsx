'use client';
import { fulfilDocumentRequest, requestDocument } from '@/lib/actions';
import { ActionForm } from '@/components/ui/action-form';

const TYPES = ['Salary slips (3 months)', 'Bank statement (6 months)', 'Form 16 / ITR', 'Employment letter', 'Address proof', 'Passport copy', 'Cancelled cheque', 'Source of funds declaration', 'Other'];

export function DocumentRequestForm({ clientId }: { clientId: string }) {
  return (
    <ActionForm action={requestDocument}>
      <input type="hidden" name="clientId" value={clientId} />
      <label className="label">Document type</label>
      <select name="documentType" className="input mb-2">
        {TYPES.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <label className="label">Reason</label>
      <textarea name="reason" className="input mb-2 h-20 resize-none" placeholder="Why is this needed? (visible in the audit trail)" />
      <button className="btn btn-primary">Request document</button>
    </ActionForm>
  );
}

export function DocumentRequestUpdate({ id }: { id: string }) {
  return (
    <ActionForm action={fulfilDocumentRequest} className="flex gap-1">
      <input type="hidden" name="id" value={id} />
      <button className="btn btn-sm" name="status" value="RECEIVED">
        Received
      </button>
      <button className="btn btn-sm" name="status" value="CANCELLED">
        Cancel
      </button>
    </ActionForm>
  );
}
