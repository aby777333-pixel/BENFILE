import { loadClient } from '@/lib/db/load-client';
import { audit } from '@/lib/db/audit';
import { formatDate, formatDateTime, formatINR, formatTenure, monthsBetween } from '@/lib/engines/normalize';
import { PrintButton } from '@/components/client360/print-button';
import { Logo } from '@/components/ui/logo';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ref?: string }> }) {
  const { id } = await params;
  const { ref } = await searchParams;
  const { c360, db } = await loadClient(id, 'overview');
  const { client, run, signals, sensitive } = c360;
  const [{ data: notes }, { data: exp }] = await Promise.all([db.from('analyst_notes').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(20), ref ? db.from('report_exports').select('*').eq('reference', ref).maybeSingle() : Promise.resolve({ data: null })]);
  await audit(db, { action: 'report.view', clientId: id, entityTable: 'report_exports', entityId: ref ?? null });
  const p = run?.canonical;
  const a = run?.assessment;
  const current = p?.employment.records.find((r) => r.status === 'CURRENT');
  const byName = Object.fromEntries(c360.staff.map((s) => [s.user_id, s.full_name]));
  const live = signals.filter((s) => !['DISMISSED', 'RESOLVED'].includes(s.status));
  const addrCheck = a?.identityChecks.find((c) => c.key === 'address.cross_source');
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="mb-6 break-inside-avoid">
      <h2 className="mb-2 border-b border-current/20 pb-1 text-sm font-bold uppercase tracking-wider">{title}</h2>
      {children}
    </section>
  );
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="grid grid-cols-[200px_1fr] gap-2 border-b border-current/10 py-1 text-[12.5px]">
      <span className="opacity-70">{k}</span>
      <span>{v ?? 'Not available'}</span>
    </div>
  );
  return (
    <div className="print-page mx-auto max-w-4xl rounded-xl bg-white p-8 text-[#111] shadow-2xl">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>
      <header className="mb-6 flex items-start justify-between border-b-2 border-[#111] pb-4">
        <div className="flex items-center gap-3">
          <Logo size={44} />
          <div>
            <div className="text-lg font-bold tracking-[0.2em]">BENFILE</div>
            <div className="text-xs uppercase tracking-wider opacity-70">Client profile report</div>
          </div>
        </div>
        <div className="text-right text-xs">
          <div>
            Report / reference ID: <span className="font-mono">{ref ?? 'UNREGISTERED'}</span>
          </div>
          <div>Generated: {formatDateTime(exp?.created_at ?? new Date().toISOString())}</div>
          <div>Prepared by: {exp ? (byName[exp.exported_by] ?? 'Staff') : '-'}</div>
          <div className="mt-1 font-semibold text-red-700">CONFIDENTIAL - sensitive identifiers masked</div>
        </div>
      </header>

      <Section title="1. Client overview">
        <Row k="Client" v={client.display_name} />
        <Row k="Client ID" v={client.client_code} />
        <Row k="Reference ID" v={run?.reference_id} />
        <Row k="Verification ID" v={run?.verification_id} />
        <Row k="Verification status" v={run?.status} />
        <Row k="Profile status" v={a?.overall.profileStatus} />
        <Row k="Overall risk level" v={a?.overall.riskLevel} />
        <Row k="Data completeness" v={a ? `${Math.round(a.overall.completeness * 100)}%` : null} />
        <Row k="Data freshness" v={a?.overall.freshness} />
        <Row k="Overall data confidence" v={a?.overall.confidence} />
        <Row k="Last verified" v={formatDate(client.last_verified_at)} />
        <Row k="Profile score" v={a ? `${a.score.total ?? 'N/A'} (config ${a.score.configVersion}; coverage ${Math.round(a.score.coverage * 100)}%)` : null} />
      </Section>

      <Section title="2. Identity verification">
        <Row k="Full name" v={p?.person.fullName.value} />
        <Row k="Gender" v={p?.person.gender.value} />
        <Row k="Date of birth" v={p?.person.dateOfBirth.value ? formatDate(p.person.dateOfBirth.value) : null} />
        <Row k="Age" v={p?.person.age.value !== null && p?.person.age.value !== undefined ? `${p.person.age.value}${p.person.age.provenance.assertion === 'DERIVED' ? ' (derived)' : ''}` : null} />
        <Row k="Occupation" v={p?.person.occupation.value} />
        {sensitive.documents.map((d) => (
          <Row key={d.doc_type} k={d.doc_type.replace('_', ' ')} v={`${d.number_masked ?? '-'}${d.name_on_document ? ` - ${d.name_on_document}` : ''}${d.status ? ` - ${d.status}` : ''}${d.aadhaar_linked !== null ? ` - Aadhaar linked: ${d.aadhaar_linked ? 'yes' : 'no'}` : ''} [${d.source_key}]`} />
        ))}
        <div className="mt-2 text-[12.5px]">
          <div className="font-semibold">Consistency checks</div>
          {a?.identityChecks.map((c) => (
            <div key={c.key} className="grid grid-cols-[260px_110px_1fr] gap-2 border-b border-current/10 py-0.5">
              <span>{c.label}</span>
              <span className="font-semibold">{c.status.replace('_', ' ')}</span>
              <span className="opacity-70">{c.explanation}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="3. Contact intelligence">
        {sensitive.phones.map((ph, i) => (
          <Row key={i} k={`Phone (${ph.phone_type ?? 'unknown'})`} v={`${ph.number_masked} [source ${ph.source_key}]`} />
        ))}
        {sensitive.emails.map((e, i) => (
          <Row key={i} k="E-mail" v={`${e.email_masked} [source ${e.source_key}]`} />
        ))}
        {p?.mobile ? <Row k="Mobile intelligence" v={`${p.mobile.isValid === true ? 'Valid' : p.mobile.isValid === false ? 'Invalid' : 'Validity unknown'} - ${p.mobile.subscriberStatus ?? '-'} - ${p.mobile.connectionType} - ${p.mobile.serviceProvider ?? '-'}${p.mobile.isPorted ? ` (ported from ${p.mobile.originalProvider ?? '-'})` : ''} - ${p.mobile.networkRegion ?? '-'}`} /> : null}
      </Section>

      <Section title="4. Address verification">
        {p?.addresses.length ? p.addresses.map((ad, i) => <Row key={i} k={`${ad.addressType ?? 'Address'} [${ad.provenance.sourceKey}]`} v={ad.fullAddress ?? [ad.city, ad.state, ad.pinCode].filter(Boolean).join(', ')} />) : <Row k="Addresses" v={null} />}
        {addrCheck ? <Row k="Cross-source consistency" v={`${addrCheck.status.replace('_', ' ')} - ${addrCheck.explanation}`} /> : null}
      </Section>

      <Section title="5. Employment intelligence">
        <Row k="Current employer" v={current?.employer.name ?? (p?.employment.records.length ? 'No current EPFO employment' : null)} />
        <Row k="Establishment ID" v={current?.employer.establishmentId} />
        <Row k="Joining date" v={current?.joiningDate ? formatDate(current.joiningDate) : null} />
        <Row k="Tenure (derived)" v={current ? formatTenure(monthsBetween(current.joiningDate)) : null} />
        <Row k="Ownership type" v={current?.employer.ownershipType} />
        <Row k="Employer confidence" v={current?.employer.confidence !== null && current?.employer.confidence !== undefined ? `${Math.round(current.employer.confidence * 100)}%` : null} />
        <Row k="Employer setup / headcount" v={current ? `${formatDate(current.employer.setupDate)} / ${current.employer.employeeCount?.toLocaleString('en-IN') ?? '-'}` : null} />
        <Row k="UAN" v={sensitive.epfo?.uan_masked} />
        <Row k="UAN-Aadhaar linked" v={p?.employment.epfo?.aadhaarLinked === null || p?.employment.epfo?.aadhaarLinked === undefined ? null : p.employment.epfo.aadhaarLinked ? 'Yes' : 'No'} />
        <Row k="PF filing available" v={p?.employment.epfo?.pfFilingAvailable === null || p?.employment.epfo?.pfFilingAvailable === undefined ? null : p.employment.epfo.pfFilingAvailable ? 'Yes' : 'No'} />
        <Row k="History" v={p?.employment.records.map((r) => `${r.employer.name} (${formatDate(r.joiningDate, { month: 'short', year: 'numeric' })} - ${r.exitDate ? formatDate(r.exitDate, { month: 'short', year: 'numeric' }) : 'present'})`).join('; ')} />
      </Section>

      <Section title="6. Credit intelligence">
        <Row k="Credit score" v={p?.credit?.score} />
        <Row k="Band" v={p?.credit?.band.replace('_', ' ')} />
        <Row k="Bureau / date" v={p?.credit ? `${p.credit.bureau ?? '-'} / ${formatDate(p.credit.scoreDate)}` : null} />
        <Row k="Obligations" v={p?.credit?.summary.totalOutstanding !== null && p?.credit?.summary.totalOutstanding !== undefined ? formatINR(p.credit.summary.totalOutstanding) : 'Not available - no bureau account data'} />
      </Section>

      <Section title="7. Banking verification">
        {sensitive.banks.length ? sensitive.banks.map((b, i) => <Row key={i} k={`${b.bank_name ?? 'Bank'} ${b.branch ?? ''}`} v={`${b.account_masked} - IFSC ${b.ifsc ?? '-'} - ${b.account_type ?? '-'} - ownership ${b.verified === true ? 'verified' : 'not independently verified'} [${b.source_key}]`} />) : <Row k="Bank accounts" v="Not available" />}
        <Row k="Income (returned)" v={p?.person.income.value?.amount ? `${formatINR(p.person.income.value.amount)} per year (${p.person.income.value.kind.toLowerCase()}, ${p.person.income.provenance.sourceKey})` : null} />
        <Row k="Net worth / assets / liabilities" v="Not Available / Not Verified" />
      </Section>

      <Section title="8. Risk indicators">
        {live.length ? (
          live.map((s) => (
            <div key={s.id} className="border-b border-current/10 py-1 text-[12.5px]">
              <span className="font-semibold">[{s.severity}] {s.title}</span> <span className="opacity-70">({s.origin.replace('_', ' ')}, {s.category.replace('_', ' ')}, status {s.status.replace('_', ' ')})</span>
              <div className="opacity-80">{s.explanation}</div>
              {s.reviewer_notes ? <div className="italic">Reviewer: {s.reviewer_notes}</div> : null}
            </div>
          ))
        ) : (
          <Row k="Open signals" v="None" />
        )}
      </Section>

      <Section title="9. Data quality">
        {a?.dataQuality.map((q) => (
          <Row key={q.sourceKey} k={q.label} v={q.available ? `${q.verificationStatus} - ${q.freshness}${q.ageDays !== null ? ` (${q.ageDays} days)` : ''} - retrieved ${formatDate(q.retrievedAt)}` : 'Not available'} />
        ))}
      </Section>

      <Section title="10. Source evidence">
        <p className="text-[12.5px] opacity-80">
          Provider: {p?.provider.name} ({p?.provider.key} v{p?.provider.adapterVersion}); engine {a?.engineVersion}; run #{run?.run_seq} ingested {formatDateTime(run?.ingested_at)}. Raw provider response SHA-256 is retained in the audit store. Source tiers: PAN/UAN/CREDIT/MOBILE = Tier 2 authorised provider. Every fact in this report is a VERIFIED FACT unless marked derived or client-declared.
        </p>
      </Section>

      <Section title="11. Analyst notes">
        {notes?.length ? notes.map((n) => <Row key={n.id} k={`${byName[n.author_id] ?? 'Staff'} - ${formatDateTime(n.created_at)}`} v={`[${n.kind}] ${n.body}`} />) : <Row k="Notes" v="None" />}
      </Section>

      <Section title="12. Disclaimers">
        <ul className="list-disc space-y-1 pl-5 text-[11.5px] opacity-80">
          <li>This report summarises information returned by authorised verification providers and lawfully accessible sources at the dates shown. It is not a credit decision, a character assessment, or a prediction of financial behaviour.</li>
          <li>Missing information is not negative information. Inconsistencies are flagged for human review and are not findings of fraud.</li>
          <li>Sensitive identifiers (PAN, Aadhaar, bank accounts, passport, UAN) are masked. Full values are available only to authorised roles through audited reveal.</li>
          <li>The profile score is an explainable triage aid with published weights; it must not be the sole basis of any decision.</li>
          <li>Data was processed under recorded consent and lawful purpose. Retention follows the configured retention policies.</li>
        </ul>
      </Section>
      <footer className="mt-8 border-t border-current/20 pt-2 text-[11px] opacity-60">
        BENFILE - Client Financial Intelligence, Verification & Profiling Platform - Report {ref ?? '-'} - {formatDateTime(new Date().toISOString())}
      </footer>
    </div>
  );
}
