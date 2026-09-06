'use client';
import { useState } from 'react';
import { addInteraction, completeTask, createTaskFromAction, setContactControls, setInterest } from '@/lib/actions-wealth';
import { ActionForm } from '@/components/ui/action-form';

type Staff = Array<{ user_id: string; full_name: string; role: string }>;

export const INTEREST_CATEGORIES = ['EQUITIES', 'MUTUAL_FUNDS', 'REAL_ESTATE', 'LAND', 'PLOTS', 'COMMERCIAL_PROPERTY', 'FIXED_INCOME', 'AIF', 'PMS', 'PRIVATE_EQUITY', 'STARTUPS', 'GOLD', 'INTERNATIONAL', 'INSURANCE', 'RETIREMENT', 'TAX_PLANNING', 'ESTATE_PLANNING', 'BUSINESS_INVESTMENTS', 'SHORT_TERM_TRADING', 'HIGH_LEVERAGE'] as const;

const CHANNELS = ['PHONE', 'WHATSAPP', 'EMAIL', 'VIDEO', 'IN_PERSON', 'PORTAL', 'SITE_VISIT'];
const KINDS = ['CALL', 'MEETING', 'MESSAGE', 'PROPOSAL', 'DOCUMENT_SENT', 'SITE_VISIT', 'FOLLOW_UP'];
const OUTCOMES = ['PENDING', 'PROGRESSED', 'DECLINED', 'NO_RESPONSE', 'CONVERTED'];
const TASK_TYPES = ['FOLLOW_UP', 'CALL', 'MEETING', 'DOCUMENT_REQUEST', 'REVERIFY', 'SITE_VISIT', 'PROPOSAL', 'KYC', 'REVIEW'];

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

function localNow(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

/** Post-meeting capture. Client-declared changes become CLIENT SAID human context; never facts. */
export function InteractionForm({ clientId }: { clientId: string }) {
  const [outcome, setOutcome] = useState('PENDING');
  const [language, setLanguage] = useState('en');
  return (
    <ActionForm action={addInteraction} className="space-y-2">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-2 sm:grid-cols-4">
        <div>
          <label className="label">When</label>
          <input name="occurredAt" type="datetime-local" className="input" defaultValue={localNow()} required />
        </div>
        <div>
          <label className="label">Channel</label>
          <select name="channel" className="input" defaultValue="PHONE">
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Direction</label>
          <select name="direction" className="input" defaultValue="OUTBOUND">
            <option value="OUTBOUND">Outbound (we reached out)</option>
            <option value="INBOUND">Inbound (client reached out)</option>
          </select>
        </div>
        <div>
          <label className="label">Kind</label>
          <select name="kind" className="input" defaultValue="CALL">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Summary</label>
        <textarea name="summary" className="input h-20 resize-none" required minLength={3} placeholder="What happened, in neutral language. Record what was said, not what you concluded." />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <ListField name="questions" title="Questions the client asked" />
        <ListField name="objections" title="Objections raised" />
        <ListField name="interests" title="Interests expressed" />
        <ListField name="concerns" title="Concerns" />
        <ListField name="commitments" title="Commitments (by either side)" />
        <ListField name="products" title="Products discussed" />
      </div>
      <div className="rounded-lg border border-dashed border-amber-400/40 bg-amber-400/[0.03] p-2">
        <ListField name="declaredChanges" title="Client-declared changes (new job, sold property, new loan...)" />
        <p className="mt-1 text-[11px] text-amber-300/90">Client-declared changes are stored as CLIENT SAID human context until reviewed - never auto-converted to facts.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <div>
          <label className="label">Outcome</label>
          <select name="outcome" className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {label(o)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Follow-up on (creates a task)</label>
          <input name="followUpAt" type="datetime-local" className="input" />
        </div>
        <div>
          <label className="label">Response time (hours)</label>
          <input name="responseHours" type="number" min={0} step="0.5" className="input" placeholder="e.g. 4" />
        </div>
        <div>
          <label className="label">Language</label>
          <select name="language" className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="ta">Tamil</option>
            <option value="hi">Hindi</option>
          </select>
        </div>
      </div>
      {outcome === 'DECLINED' ? (
        <div>
          <label className="label">Decline reason (in the client&apos;s words where possible)</label>
          <input name="declineReason" className="input" placeholder="e.g. not comfortable with lock-in" />
        </div>
      ) : null}
      {language !== 'en' ? (
        <div>
          <label className="label">Original text (as spoken / written)</label>
          <textarea name="originalText" className="input h-16 resize-none" placeholder="Keep the original wording; the summary above is your translation." />
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-ink-500">Updates last-contact. Follow-up dates create an open task assigned to you.</span>
        <button className="btn btn-primary">Record interaction</button>
      </div>
    </ActionForm>
  );
}

function ListField({ name, title }: { name: string; title: string }) {
  return (
    <div>
      <label className="label">{title}</label>
      <textarea name={name} className="input h-16 resize-none" placeholder="One per line" />
    </div>
  );
}

export interface ContactControlsValues {
  do_not_contact: boolean;
  preferred_channel: string | null;
  preferred_frequency_days: number | null;
  marketing_permission: boolean;
  preferred_language: string | null;
  preferred_format: string | null;
  reporting_frequency: string | null;
}

export function ContactControlsForm({ clientId, current }: { clientId: string; current: ContactControlsValues | null }) {
  return (
    <ActionForm action={setContactControls} className="space-y-2" resetOnSuccess={false}>
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex flex-wrap gap-4 text-xs text-ink-200">
        <label className="inline-flex items-center gap-1.5 text-red-300">
          <input type="checkbox" name="doNotContact" defaultChecked={current?.do_not_contact ?? false} /> Do not contact
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" name="marketing" defaultChecked={current?.marketing_permission ?? false} /> Marketing permission granted
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label">Preferred channel</label>
          <select name="preferredChannel" className="input" defaultValue={current?.preferred_channel ?? ''}>
            <option value="">Not stated</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Max contact frequency (days between)</label>
          <input name="frequencyDays" type="number" min={1} className="input" defaultValue={current?.preferred_frequency_days ?? ''} placeholder="e.g. 14" />
        </div>
        <div>
          <label className="label">Language</label>
          <select name="language" className="input" defaultValue={current?.preferred_language ?? 'en'}>
            <option value="en">English</option>
            <option value="ta">Tamil</option>
            <option value="hi">Hindi</option>
          </select>
        </div>
        <div>
          <label className="label">Preferred format</label>
          <select name="format" className="input" defaultValue={current?.preferred_format ?? ''}>
            <option value="">Not stated</option>
            <option value="SHORT_SUMMARY">Short summary</option>
            <option value="DETAILED_REPORT">Detailed report</option>
            <option value="CALL">Call</option>
            <option value="IN_PERSON">In person</option>
          </select>
        </div>
        <div>
          <label className="label">Reporting frequency</label>
          <select name="reporting" className="input" defaultValue={current?.reporting_frequency ?? ''}>
            <option value="">Not stated</option>
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="HALF_YEARLY">Half-yearly</option>
            <option value="ANNUAL">Annual</option>
            <option value="ON_EVENT">On event only</option>
          </select>
        </div>
      </div>
      <button className="btn btn-sm btn-primary">Save contact controls</button>
    </ActionForm>
  );
}

export function InterestForm({ clientId }: { clientId: string }) {
  return (
    <ActionForm action={setInterest} className="rounded-lg border border-white/10 bg-ink-900 p-3">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
        <select name="category" className="input" defaultValue="EQUITIES">
          {INTEREST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </select>
        <select name="stance" className="input" defaultValue="INTERESTED">
          <option value="INTERESTED">Interested</option>
          <option value="NOT_INTERESTED">Not interested</option>
          <option value="UNKNOWN">Unknown</option>
        </select>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input name="source" className="input" placeholder="Source (e.g. call on 12 Mar, portal)" />
        <input name="note" className="input" placeholder="Note (client's words where possible)" />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-1.5 text-xs text-ink-200">
          <input type="checkbox" name="declared" defaultChecked /> Client declared this directly (otherwise recorded as analyst-provided)
        </label>
        <button className="btn btn-sm btn-primary">Save interest</button>
      </div>
    </ActionForm>
  );
}

export function TaskForm({ clientId, staff, me }: { clientId: string; staff: Staff; me: string }) {
  return (
    <ActionForm action={createTaskFromAction} className="space-y-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="source" value="MANUAL" />
      <input name="title" className="input" placeholder="Task title" required minLength={3} />
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="taskType" className="input" defaultValue="FOLLOW_UP">
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              {label(t)}
            </option>
          ))}
        </select>
        <select name="priority" className="input" defaultValue="NORMAL">
          {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (
            <option key={p} value={p}>
              {label(p)}
            </option>
          ))}
        </select>
        <input name="dueAt" type="datetime-local" className="input" />
        <select name="assignedTo" className="input" defaultValue={me}>
          {staff.map((s) => (
            <option key={s.user_id} value={s.user_id}>
              {s.full_name}
            </option>
          ))}
        </select>
      </div>
      <input name="reason" className="input" placeholder="Reason (visible in the audit trail)" />
      <button className="btn btn-sm btn-primary">Create task</button>
    </ActionForm>
  );
}

export function TaskCompleteButtons({ id }: { id: string }) {
  return (
    <ActionForm action={completeTask} className="flex gap-1">
      <input type="hidden" name="id" value={id} />
      <button className="btn btn-sm" name="status" value="DONE">
        Done
      </button>
      <button className="btn btn-sm" name="status" value="CANCELLED">
        Cancel
      </button>
    </ActionForm>
  );
}
