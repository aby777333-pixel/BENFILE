'use client';
import { reviewSignal } from '@/lib/actions';
import { ActionForm } from '@/components/ui/action-form';

export function SignalReview({ id, canEscalate }: { id: string; canEscalate: boolean }) {
  return (
    <ActionForm action={reviewSignal} className="w-full shrink-0 lg:w-72" resetOnSuccess={false}>
      <input type="hidden" name="id" value={id} />
      <label className="label">Reviewer notes</label>
      <textarea name="notes" className="input mb-2 h-16 resize-none" placeholder="What did you check? Why?" />
      <div className="flex flex-wrap gap-1.5">
        <button className="btn btn-sm" name="status" value="REVIEWED">
          Mark reviewed
        </button>
        {canEscalate ? (
          <button className="btn btn-sm btn-danger" name="status" value="ESCALATED">
            Escalate
          </button>
        ) : null}
        <button className="btn btn-sm" name="status" value="RESOLVED">
          Resolve
        </button>
        <button className="btn btn-sm" name="status" value="DISMISSED">
          Dismiss
        </button>
      </div>
    </ActionForm>
  );
}
