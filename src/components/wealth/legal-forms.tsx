'use client';
import { ActionForm } from '@/components/ui/action-form';
import { attachLegalMatter, reviewLegalMatter } from '@/lib/actions-wealth';

const LEGAL_CATEGORIES = ['CIVIL', 'COMMERCIAL', 'PROPERTY', 'RECOVERY', 'CHEQUE', 'INSOLVENCY', 'COMPANY_LAW', 'CONSUMER', 'TAX', 'ARBITRATION', 'REGULATORY', 'CRIMINAL_COMPLAINT', 'OTHER'];
const CLIENT_ROLES = ['UNKNOWN', 'PLAINTIFF', 'DEFENDANT', 'PETITIONER', 'RESPONDENT', 'WITNESS', 'DIRECTOR_OF_INVOLVED_COMPANY', 'OTHER'];
const MATCH = ['POSSIBLE_MATCH', 'HIGH_CONFIDENCE', 'CONFIRMED', 'LOW_CONFIDENCE', 'NOT_A_MATCH'];
const EVIDENCE = ['OFFICIAL_PUBLIC_RECORD', 'AUTHORIZED_THIRD_PARTY', 'ANALYST_PROVIDED', 'CLIENT_DECLARED', 'POSSIBLE_ASSOCIATION'];

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
function Select({ name, options, defaultValue }: { name: string; options: string[]; defaultValue?: string }) {
  return (
    <select name={name} className="input" defaultValue={defaultValue && options.includes(defaultValue) ? defaultValue : options[0]}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}

/** Inline reviewer decision for a legal matter: confirmed / not the client / needs info. */
export function LegalReviewForm({ id, current }: { id: string; current: string }) {
  return (
    <ActionForm action={reviewLegalMatter} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <select name="decision" className="input w-auto py-1 text-xs" defaultValue={['CONFIRMED', 'NOT_THE_CLIENT', 'NEEDS_INFO'].includes(current) ? current : 'NEEDS_INFO'}>
        <option value="CONFIRMED">Confirmed - this is the client</option>
        <option value="NOT_THE_CLIENT">Not the client</option>
        <option value="NEEDS_INFO">Needs more information</option>
      </select>
      <input name="note" className="input w-44 py-1 text-xs" placeholder="Review note" />
      <button className="btn btn-sm" type="submit">Record decision</button>
    </ActionForm>
  );
}

export interface LegalPrefill {
  caseNumber?: string;
  court?: string;
  jurisdiction?: string;
  caseType?: string;
  category?: string;
  clientRole?: string;
  subjectKind?: string;
  filingDate?: string;
  status?: string;
  orderDate?: string;
  amount?: string;
  sourceKey?: string;
  evidenceClass?: string;
  identityConfidence?: string;
  matchStatus?: string;
  parties?: string;
}

/** Attach an external finding (findingId set) or add a matter manually (findingId omitted). */
export function AttachLegalForm({ clientId, findingId, prefill = {}, submitLabel = 'Attach as legal matter' }: { clientId: string; findingId?: string; prefill?: LegalPrefill; submitLabel?: string }) {
  return (
    <ActionForm action={attachLegalMatter} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      {findingId ? <input type="hidden" name="findingId" value={findingId} /> : null}
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Case number"><input name="caseNumber" className="input" defaultValue={prefill.caseNumber ?? ''} /></Field>
        <Field label="Court"><input name="court" className="input" defaultValue={prefill.court ?? ''} /></Field>
        <Field label="Jurisdiction"><input name="jurisdiction" className="input" defaultValue={prefill.jurisdiction ?? ''} /></Field>
        <Field label="Case type"><input name="caseType" className="input" defaultValue={prefill.caseType ?? ''} placeholder="O.S., CRL.M.P., IBC s.7" /></Field>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Category"><Select name="category" options={LEGAL_CATEGORIES} defaultValue={prefill.category?.toUpperCase()} /></Field>
        <Field label="Client role"><Select name="clientRole" options={CLIENT_ROLES} defaultValue={prefill.clientRole?.toUpperCase()} /></Field>
        <Field label="Subject"><Select name="subjectKind" options={['PERSON', 'ASSOCIATED_COMPANY']} defaultValue={prefill.subjectKind} /></Field>
        <Field label="Status"><input name="status" className="input" defaultValue={prefill.status ?? ''} placeholder="PENDING / DISPOSED" /></Field>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Filing date"><input name="filingDate" type="date" className="input" defaultValue={prefill.filingDate ?? ''} /></Field>
        <Field label="Latest order date"><input name="orderDate" type="date" className="input" defaultValue={prefill.orderDate ?? ''} /></Field>
        <Field label="Amount involved (INR)"><input name="amount" type="number" min={0} className="input" defaultValue={prefill.amount ?? ''} /></Field>
        <Field label="Source key"><input name="sourceKey" className="input" defaultValue={prefill.sourceKey ?? 'ECOURTS'} /></Field>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Evidence class"><Select name="evidenceClass" options={EVIDENCE} defaultValue={prefill.evidenceClass} /></Field>
        <Field label="Identity confidence %"><input name="identityConfidence" type="number" min={0} max={100} className="input" defaultValue={prefill.identityConfidence ?? ''} /></Field>
        <Field label="Match status"><Select name="matchStatus" options={MATCH} defaultValue={prefill.matchStatus} /></Field>
        <Field label="Note"><input name="note" className="input" placeholder="Why this is / may be the client" /></Field>
      </div>
      <Field label='Parties (JSON list of {"name","role"}; or comma-separated names)'>
        <textarea name="parties" className="input font-mono text-xs" rows={2} defaultValue={prefill.parties ?? ''} placeholder='[{"name":"...","role":"PETITIONER"}]' />
      </Field>
      <button className="btn btn-primary btn-sm" type="submit">{submitLabel}</button>
    </ActionForm>
  );
}
