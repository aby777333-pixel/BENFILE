'use client';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { browserSupabase } from '@/lib/db/browser';
import { Logo } from '@/components/ui/logo';

type DocRequest = { id: string; documentType: string; reason: string | null; status: string; requestedAt: string };
type PortalDoc = { id: string; docType: string; title: string; status: string; uploadedAt: string };
type Submission = { id: string; kind: string; status: string; createdAt: string };
type Consent = { id: string; purpose: string; status: string; grantedAt: string | null; expiresAt: string | null; sources: string[] };
type PortalContext = {
  clientId: string;
  clientCode: string;
  displayName: string;
  consentStatus: string;
  documentRequests: DocRequest[];
  documents: PortalDoc[];
  submissions: Submission[];
  consents: Consent[];
};
type Msg = { ok: boolean; text: string };
type Option = string | [string, string];

const DOC_TYPES = ['PAN_CARD', 'AADHAAR', 'PASSPORT', 'DRIVING_LICENCE', 'VOTER_ID', 'CANCELLED_CHEQUE', 'BANK_STATEMENT', 'SALARY_SLIP', 'FORM_16', 'MUTUAL_FUND_STATEMENT', 'DEMAT_STATEMENT', 'SALE_DEED', 'PATTA', 'EC', 'SOURCE_OF_FUNDS', 'SOURCE_OF_WEALTH', 'OTHER'];
const DOC_STATUS: Record<string, string> = { UPLOADED: 'Received', EXTRACTION_PENDING: 'Under review', EXTRACTED: 'Under review', UNDER_REVIEW: 'Under review', VERIFIED: 'Verified', REJECTED: 'Rejected', REPLACEMENT_REQUIRED: 'Replacement required', EXPIRED: 'Expired', UNREADABLE: 'Unreadable - please re-upload' };
const SUB_STATUS: Record<string, string> = { PENDING_REVIEW: 'Received - under review', ACCEPTED: 'Accepted', REJECTED: 'Not accepted' };
const SUB_KIND: Record<string, string> = { DETAILS: 'Personal details', OBJECTIVES: 'Investment objectives', PROPERTY_REQUIREMENTS: 'Property requirements', SUITABILITY: 'Suitability questionnaire', CONSENT: 'Consent', CONSENT_WITHDRAWAL: 'Consent withdrawal', CORRECTION: 'Correction request', CONTACT_PREFERENCES: 'Contact preferences', DOCUMENT: 'Document' };
const REQ_STATUS: Record<string, string> = { REQUESTED: 'Awaiting your upload', RECEIVED: 'Received', FULFILLED: 'Received', CANCELLED: 'No longer needed' };
const HORIZONS: Option[] = ['Under 1 year', '1-3 years', '3-5 years', '5-10 years', 'Over 10 years'];
const LIQUIDITY: Option[] = ['Low - I can lock money away', 'Medium - may need some within 3 years', 'High - may need most within a year'];
const RISK: Option[] = ['Conservative', 'Moderately conservative', 'Balanced', 'Growth-oriented', 'Aggressive'];
const EXPERIENCE: Option[] = ['None', 'Fixed deposits and savings only', 'Mutual funds', 'Direct equity', 'Alternative investments (AIF/PMS)', 'Real estate'];
const RANGES: Option[] = ['Under 10 lakh', '10-25 lakh', '25-50 lakh', '50 lakh - 1 crore', '1-5 crore', 'Over 5 crore'];
const SOURCES: Option[] = ['Salary', 'Business income', 'Professional fees', 'Rental income', 'Sale of property', 'Sale of investments', 'Inheritance or gift', 'Other'];
const OBJECTIVES = ['Capital preservation', 'Regular income', 'Balanced growth', 'Long-term growth', 'Tax efficiency', 'Retirement', 'Education', 'Property purchase'];
const PREFERENCES = ['Mutual funds', 'Direct equity', 'Fixed income', 'Real estate', 'Alternative investment funds', 'Gold', 'International'];
const PROPERTY_TYPES = ['PLOT', 'LAND', 'VILLA', 'APARTMENT', 'COMMERCIAL', 'FARM'];

function fmtDate(v: string | null | undefined) {
  if (!v) return '-';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function friendly(message: string) {
  if (/invalid or expired/i.test(message)) return 'This link is invalid or has expired. Please contact your relationship manager.';
  if (/mime|file type|not allowed/i.test(message)) return 'That file type is not accepted. Please upload a PDF, JPG, PNG or WEBP.';
  if (/too large|exceeded|size/i.test(message)) return 'That file is too large. Please upload a file under 50 MB.';
  return 'Something went wrong. Please try again or contact your relationship manager.';
}
function payloadFrom(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s) continue;
    out[k] = out[k] ? `${out[k]}, ${s}` : s;
  }
  return out;
}
async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function Section({ title, hint, open, children }: { title: string; hint?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="panel group" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-sm font-semibold">{title}</span>
          {hint && <span className="block text-xs text-ink-300">{hint}</span>}
        </span>
        <span className="text-ink-400 transition group-open:rotate-180" aria-hidden>
          &#9662;
        </span>
      </summary>
      <div className="border-t border-white/[0.06] px-4 py-4 text-sm">{children}</div>
    </details>
  );
}
function Notice({ msg }: { msg: Msg | null }) {
  if (!msg) return null;
  return <p className={`rounded-md px-3 py-2 text-sm ${msg.ok ? 'bg-verified/10 text-emerald-300' : 'bg-danger/10 text-red-300'}`}>{msg.text}</p>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
function Select({ name, label, options, required }: { name: string; label: string; options: Option[]; required?: boolean }) {
  return (
    <Field label={label}>
      <select name={name} className="input" required={required} defaultValue="">
        <option value="">Select...</option>
        {options.map((o) => {
          const [value, text] = typeof o === 'string' ? [o, o] : o;
          return (
            <option key={value} value={value}>
              {text}
            </option>
          );
        })}
      </select>
    </Field>
  );
}
function Input({ name, label, type = 'text', required, placeholder }: { name: string; label: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <Field label={label}>
      <input name={name} type={type} className="input" required={required} placeholder={placeholder} min={type === 'number' ? 0 : undefined} />
    </Field>
  );
}
function CheckGroup({ name, label, options }: { name: string; label: string; options: Option[] }) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {options.map((o) => {
          const [value, text] = typeof o === 'string' ? [o, o] : o;
          return (
            <label key={value} className="flex items-center gap-2 text-sm text-ink-200">
              <input type="checkbox" name={name} value={value} className="accent-gold-500" /> {text}
            </label>
          );
        })}
      </div>
    </Field>
  );
}
function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

function SubmitForm({ token, kind, onDone, children, label = 'Send to my relationship manager' }: { token: string; kind: string; onDone: () => Promise<void>; children: ReactNode; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMsg(null);
    const { error } = await browserSupabase().rpc('portal_submit', { p_token: token, p_kind: kind, p_payload: payloadFrom(new FormData(form)) });
    if (error) {
      setMsg({ ok: false, text: friendly(error.message) });
      setBusy(false);
      return;
    }
    form.reset();
    setMsg({ ok: true, text: 'Received - our team will review' });
    await onDone();
    setBusy(false);
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {children}
      <Notice msg={msg} />
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Sending...' : label}
      </button>
    </form>
  );
}

function UploadForm({ token, clientId, onDone }: { token: string; clientId: string; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get('file');
    const docType = String(fd.get('doc_type') ?? '');
    if (!(file instanceof File) || !file.size || !docType) {
      setMsg({ ok: false, text: 'Please choose a document type and a file.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const sb = browserSupabase();
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
      const path = `portal/${clientId}/${token}/${Date.now()}-${safeName}`;
      const sha = await sha256Hex(file);
      const { error: upErr } = await sb.storage.from('client-uploads').upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (upErr) throw new Error(upErr.message);
      const title = String(fd.get('title') ?? '').trim() || file.name;
      const { error: regErr } = await sb.rpc('portal_register_document', { p_token: token, p_doc_type: docType, p_title: title, p_path: path, p_mime: file.type || null, p_size: file.size, p_sha: sha });
      if (regErr) throw new Error(regErr.message);
      form.reset();
      setMsg({ ok: true, text: 'Received - our team will review' });
      await onDone();
    } catch (err) {
      setMsg({ ok: false, text: friendly(err instanceof Error ? err.message : '') });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Row>
        <Select name="doc_type" label="Document type" options={DOC_TYPES.map((d) => [d, d.replace(/_/g, ' ')])} required />
        <Input name="title" label="Description (optional)" placeholder="e.g. Bank statement Apr-Jun 2026" />
      </Row>
      <Field label="File (PDF, JPG, PNG or WEBP, up to 50 MB)">
        <input name="file" type="file" className="input file:mr-3 file:rounded file:border-0 file:bg-ink-700 file:px-2 file:py-1 file:text-xs file:text-ink-100" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" required />
      </Field>
      <Notice msg={msg} />
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Uploading...' : 'Upload document'}
      </button>
    </form>
  );
}

export function PortalApp({ token }: { token: string }) {
  const [ctx, setCtx] = useState<PortalContext | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading');
  const [consentMsg, setConsentMsg] = useState<Msg | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await browserSupabase().rpc('portal_context', { p_token: token });
    if (error) {
      setState('error');
      return;
    }
    if (!data) {
      setState('invalid');
      return;
    }
    setCtx(data as PortalContext);
    setState('ready');
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function withdrawConsent() {
    if (!window.confirm('Withdraw your consent? We will stop processing your information for the stated purposes and your relationship manager will be notified. You can grant consent again later.')) return;
    setConsentMsg(null);
    const { error } = await browserSupabase().rpc('portal_submit', { p_token: token, p_kind: 'CONSENT_WITHDRAWAL', p_payload: { reason: 'Withdrawn by client via portal', withdrawn_at: new Date().toISOString() } });
    if (error) {
      setConsentMsg({ ok: false, text: friendly(error.message) });
      return;
    }
    setConsentMsg({ ok: true, text: 'Received - our team will review' });
    await load();
  }

  if (state === 'loading') return <p className="py-16 text-center text-sm text-ink-300">Opening your secure portal...</p>;
  if (state === 'invalid' || state === 'error' || !ctx)
    return (
      <div className="panel mx-auto mt-16 max-w-md p-6 text-center">
        <Logo size={40} className="mx-auto mb-3" />
        <p className="text-sm text-ink-200">{state === 'error' ? 'We could not open your portal right now. Please try again in a few minutes.' : 'This link is invalid or has expired. Please contact your relationship manager.'}</p>
      </div>
    );

  const consentLabel: Record<string, string> = { GRANTED: 'Consent given', PENDING: 'Consent not yet recorded', EXPIRED: 'Consent expired', WITHDRAWN: 'Consent withdrawn' };
  const submissions = [...ctx.submissions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const documents = [...ctx.documents].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-3 py-2">
        <Logo size={40} />
        <div>
          <div className="text-lg font-semibold tracking-tight">BENFILE</div>
          <div className="text-xs text-ink-300">Secure client portal</div>
        </div>
      </header>

      <Section title={`Welcome, ${ctx.displayName}`} hint={`Client reference ${ctx.clientCode}`} open>
        <div className="space-y-3 leading-relaxed text-ink-200">
          <p>
            <span className="font-semibold text-ink-100">What we hold and why.</span> We keep the information you and your relationship manager have shared with us - your identity and contact details, the documents you provide, and your stated financial goals and preferences. We use it only to verify who you are, to understand what is suitable for you, and to meet our legal obligations.
          </p>
          <p>Use this page to upload documents we have asked for, tell us about your goals, correct anything we have wrong, and see where each request stands. Everything you send is reviewed by a person before it is used.</p>
          <p className="text-xs text-ink-300">Privacy note: this link is personal to you and expires automatically. Nothing you submit here is shared outside BENFILE without your permission. Please do not forward this link.</p>
        </div>
      </Section>

      <Section title="Consent" hint={consentLabel[ctx.consentStatus] ?? ctx.consentStatus}>
        <div className="space-y-3">
          {ctx.consents.length === 0 && <p className="text-ink-300">No consent record found.</p>}
          {ctx.consents.map((c) => (
            <div key={c.id} className="rounded-md border border-white/[0.06] bg-ink-900 p-3">
              <div className="font-medium">{c.purpose}</div>
              <div className="mt-1 text-xs text-ink-300">
                {consentLabel[c.status] ?? c.status} · given {fmtDate(c.grantedAt)} · valid until {fmtDate(c.expiresAt)}
              </div>
              {c.sources?.length > 0 && <div className="mt-1 text-xs text-ink-400">Covers: {c.sources.join(', ').toLowerCase()}</div>}
            </div>
          ))}
          <Notice msg={consentMsg} />
          {ctx.consentStatus === 'GRANTED' && (
            <button type="button" className="btn btn-danger" onClick={withdrawConsent}>
              Withdraw consent
            </button>
          )}
          <p className="text-xs text-ink-400">Withdrawing consent stops further processing. It does not remove records we must keep by law.</p>
        </div>
      </Section>

      <Section title="Documents" hint={`${ctx.documentRequests.filter((r) => r.status === 'REQUESTED').length} awaiting upload`}>
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-300">Requested from you</h3>
            {ctx.documentRequests.length === 0 && <p className="text-ink-300">Nothing is outstanding right now.</p>}
            <ul className="space-y-2">
              {ctx.documentRequests.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 rounded-md border border-white/[0.06] bg-ink-900 p-3">
                  <div>
                    <div className="font-medium">{r.documentType.replace(/_/g, ' ')}</div>
                    {r.reason && <div className="text-xs text-ink-300">{r.reason}</div>}
                    <div className="text-xs text-ink-400">Requested {fmtDate(r.requestedAt)}</div>
                  </div>
                  <span className="shrink-0 text-xs text-gold-300">{REQ_STATUS[r.status] ?? r.status}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-300">Upload a document</h3>
            <UploadForm token={token} clientId={ctx.clientId} onDone={load} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-300">My uploads</h3>
            {documents.length === 0 && <p className="text-ink-300">You have not uploaded anything yet.</p>}
            <ul className="space-y-2">
              {documents.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-3 rounded-md border border-white/[0.06] bg-ink-900 p-3">
                  <div>
                    <div className="font-medium">{d.title}</div>
                    <div className="text-xs text-ink-400">
                      {d.docType.replace(/_/g, ' ')} · {fmtDate(d.uploadedAt)}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-ink-200">{DOC_STATUS[d.status] ?? d.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section title="Correct my details" hint="Tell us if something we hold is wrong or out of date">
        <SubmitForm token={token} kind="CORRECTION" onDone={load}>
          <Row>
            <Select name="entity" label="What needs correcting" required options={[['personal_details', 'Personal details'], ['client_addresses', 'Address'], ['phone_numbers', 'Phone number'], ['emails', 'E-mail address'], ['employment_records', 'Employment']]} />
            <Input name="field" label="Which field" required placeholder="e.g. date of birth, current address" />
          </Row>
          <Field label="What it should be, and why">
            <textarea name="detail" className="input min-h-24" required placeholder="Describe the correct information. You can upload supporting documents in the Documents section." />
          </Field>
        </SubmitForm>
      </Section>

      <Section title="Investment objectives" hint="What you want your money to do">
        <SubmitForm token={token} kind="OBJECTIVES" onDone={load}>
          <CheckGroup name="objectives" label="Your objectives (tick all that apply)" options={OBJECTIVES} />
          <Row>
            <Select name="horizon" label="How long can you invest for" options={HORIZONS} required />
            <Select name="liquidity" label="How soon might you need the money" options={LIQUIDITY} />
            <Select name="risk_tolerance" label="Attitude to risk" options={RISK} required />
            <Select name="experience" label="Investment experience" options={EXPERIENCE} />
            <Select name="income_range" label="Annual income" options={RANGES} />
            <Select name="net_worth_range" label="Approximate net worth" options={RANGES} />
            <Select name="source_of_funds" label="Source of funds for this investment" options={SOURCES} />
            <Select name="source_of_wealth" label="Main source of your wealth" options={SOURCES} />
            <Input name="expected_amount" label="Amount you are considering (INR)" type="number" />
          </Row>
          <CheckGroup name="preferences" label="Products you would like to hear about" options={PREFERENCES} />
        </SubmitForm>
      </Section>

      <Section title="Property requirements" hint="If you are looking for land or property">
        <SubmitForm token={token} kind="PROPERTY_REQUIREMENTS" onDone={load}>
          <Row>
            <Select name="purpose" label="Purpose" required options={[['SELF_USE', 'For my own use'], ['INVESTMENT', 'Investment'], ['BOTH', 'Both']]} />
            <Select name="financing" label="How you would pay" options={[['CASH', 'Own funds'], ['LOAN', 'Loan'], ['MIXED', 'Mix of both']]} />
            <Input name="budget_min" label="Budget from (INR)" type="number" />
            <Input name="budget_max" label="Budget up to (INR)" type="number" />
            <Input name="cities" label="Preferred cities (comma separated)" placeholder="Coimbatore, Bengaluru" />
            <Select name="horizon" label="When you plan to buy" options={['Within 3 months', '3-6 months', '6-12 months', 'Over a year', 'Just exploring']} />
            <Input name="size_min" label="Minimum size (sq ft)" type="number" />
            <Input name="size_max" label="Maximum size (sq ft)" type="number" />
          </Row>
          <CheckGroup name="property_types" label="Type of property" options={PROPERTY_TYPES.map((t) => [t, t.charAt(0) + t.slice(1).toLowerCase()])} />
        </SubmitForm>
      </Section>

      <Section title="Suitability questionnaire" hint="Helps us recommend only what fits you">
        <SubmitForm token={token} kind="SUITABILITY" onDone={load}>
          <Row>
            <Select name="risk_tolerance" label="Attitude to risk" options={RISK} required />
            <Select name="horizon" label="Investment horizon" options={HORIZONS} required />
            <Select name="liquidity" label="Need for access to the money" options={LIQUIDITY} />
            <Input name="expected_amount" label="Amount you are considering (INR)" type="number" />
            <Select name="loss_reaction" label="If your investment fell 20% in a year you would..." required options={['Sell everything', 'Sell part', 'Hold', 'Buy more']} />
            <Select name="experience" label="Investment experience" options={EXPERIENCE} />
            <Input name="dependants" label="Number of dependants (optional)" type="number" />
          </Row>
          <CheckGroup name="objectives" label="Your objectives" options={OBJECTIVES} />
        </SubmitForm>
      </Section>

      <Section title="Contact preferences" hint="How and when you would like to hear from us">
        <SubmitForm token={token} kind="CONTACT_PREFERENCES" onDone={load}>
          <Row>
            <Select name="channel" label="Preferred way to reach you" required options={[['PHONE', 'Phone call'], ['WHATSAPP', 'WhatsApp'], ['EMAIL', 'E-mail'], ['VIDEO', 'Video call'], ['IN_PERSON', 'In person']]} />
            <Select name="language" label="Preferred language" required options={[['en', 'English'], ['ta', 'Tamil'], ['hi', 'Hindi']]} />
            <Select name="format" label="How you like information presented" options={['Short summary', 'Detailed comparison table', 'Call to walk me through it', 'Full documents']} />
          </Row>
          <label className="flex items-center gap-2 text-sm text-ink-200">
            <input type="checkbox" name="marketing" value="yes" className="accent-gold-500" /> I am happy to receive information about new offerings
          </label>
        </SubmitForm>
      </Section>

      <Section title="Track progress" hint={`${submissions.length} submission${submissions.length === 1 ? '' : 's'}`}>
        {submissions.length === 0 && <p className="text-ink-300">Anything you send us will appear here with its current status.</p>}
        <ul className="space-y-2">
          {submissions.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 rounded-md border border-white/[0.06] bg-ink-900 p-3">
              <div>
                <div className="font-medium">{SUB_KIND[s.kind] ?? s.kind}</div>
                <div className="text-xs text-ink-400">Sent {fmtDate(s.createdAt)}</div>
              </div>
              <span className="shrink-0 text-xs text-ink-200">{SUB_STATUS[s.status] ?? s.status}</span>
            </li>
          ))}
        </ul>
      </Section>

      <p className="px-1 py-4 text-center text-[11px] text-ink-400">Questions? Contact your relationship manager. This page is protected and expires automatically.</p>
    </div>
  );
}
