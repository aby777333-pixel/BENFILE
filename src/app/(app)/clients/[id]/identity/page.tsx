import { loadClient } from '@/lib/db/load-client';
import { hasPermission } from '@/lib/security/permissions';
import { formatDate } from '@/lib/engines/normalize';
import { Panel, Empty, Kv } from '@/components/ui/panel';
import { Badge, MatchBadge, ProvenanceTag, SourceTag } from '@/components/ui/badges';
import { EvidenceDrawer } from '@/components/ui/evidence';
import { MaskedValue } from '@/components/ui/masked';
import { DisputeButton } from '@/components/client360/dispute-button';

const DOC_LABEL: Record<string, string> = { PAN: 'PAN', AADHAAR: 'Aadhaar', PASSPORT: 'Passport', VOTER_ID: 'Voter ID', DRIVING_LICENCE: 'Driving licence', RATION_CARD: 'Ration card', GSTIN: 'GSTIN', DIN: 'DIN', OTHER: 'Other' };

export default async function IdentityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, role } = await loadClient(id, 'identity');
  const { run, sensitive } = c360;
  if (!run?.assessment) return <Empty>No verification run yet.</Empty>;
  const p = run.canonical;
  const a = run.assessment;
  const canReveal = hasPermission(role, 'sensitive:reveal');
  const nameChecks = a.identityChecks.filter((c) => c.key.startsWith('name.') || c.key.startsWith('dob') || c.key.startsWith('epfo'));
  const linkChecks = a.identityChecks.filter((c) => c.key.startsWith('link.') || c.key.startsWith('pan.'));

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <Panel title="Personal identity" right={<SourceTag sourceKey={p.person.fullName.provenance.sourceKey} tier={p.person.fullName.provenance.tier} />}>
          <Kv
            rows={[
              ['Full name', <span key="n" className="flex items-center gap-2">{p.person.fullName.value}<ProvenanceTag kind={p.person.fullName.provenance.assertion} short /></span>],
              ['Gender', p.person.gender.value],
              ['Date of birth', p.person.dateOfBirth.value ? formatDate(p.person.dateOfBirth.value) : null],
              ['Age', p.person.age.value !== null ? <span key="a" className="flex items-center gap-2">{p.person.age.value}<ProvenanceTag kind={p.person.age.provenance.assertion} short /></span> : null],
              ['Occupation', p.person.occupation.value],
              ['Relatives', p.person.relatives.length ? <ul key="r" className="space-y-1">{p.person.relatives.map((r, i) => <li key={i} className="flex items-center gap-2">{r.name}<span className="text-ink-400">{r.relation?.toLowerCase()}</span><SourceTag sourceKey={r.provenance.sourceKey} /></li>)}</ul> : null],
            ]}
          />
          <div className="mt-3 flex items-center gap-3">
            <EvidenceDrawer runId={run.id} evidence={[{ label: 'Personal record', sourceKey: p.person.fullName.provenance.sourceKey, path: p.person.fullName.provenance.evidencePath?.replace(/\/full_name$/, '') }]} title="Personal identity" />
            <DisputeButton clientId={id} entityTable="personal_details" fieldKey="full_name" />
          </div>
        </Panel>

        <Panel title="Government / identity documents" right={<span className="text-[11px] text-ink-400">Masked by default - reveals are audit-logged</span>}>
          {sensitive.documents.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Number</th>
                    <th>Name on document</th>
                    <th>Type / status</th>
                    <th>Aadhaar link</th>
                    <th>Source</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sensitive.documents.map((d, i) => (
                    <tr key={i}>
                      <td className="font-medium">{DOC_LABEL[d.doc_type] ?? d.doc_type}</td>
                      <td>
                        <MaskedValue masked={d.number_masked} sensitiveId={d.sensitive_value_id} canReveal={canReveal} />
                      </td>
                      <td>{d.name_on_document ?? <span className="text-ink-400">-</span>}</td>
                      <td>
                        {d.subtype ?? '-'}
                        {d.status ? <Badge tone={['VALID', 'ACTIVE'].includes(d.status) ? 'good' : 'warn'} className="ml-2">{d.status}</Badge> : null}
                      </td>
                      <td>{d.aadhaar_linked === null ? <span className="text-ink-400">n/a</span> : d.aadhaar_linked ? <Badge tone="good">Linked</Badge> : <Badge tone="warn">Not linked</Badge>}</td>
                      <td>
                        <SourceTag sourceKey={d.source_key} tier={d.tier} />
                      </td>
                      <td className="whitespace-nowrap">
                        <EvidenceDrawer runId={run.id} evidence={[{ label: DOC_LABEL[d.doc_type] ?? d.doc_type, sourceKey: d.source_key, path: d.evidence_path, value: d.number_masked }]} title={DOC_LABEL[d.doc_type]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No identity documents returned.</Empty>
          )}
        </Panel>

        <Panel title="Identity consistency engine" right={<Badge tone="derived">Derived</Badge>}>
          <p className="mb-3 text-xs text-ink-400">Names and identifiers compared across sources after normalising case, whitespace, punctuation and phone formats. Original values are preserved in the source record. Partial matches are formatting differences, not fraud indicators.</p>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Left</th>
                  <th>Right</th>
                  <th>Status</th>
                  <th>Explanation</th>
                </tr>
              </thead>
              <tbody>
                {[...nameChecks, ...linkChecks].map((c) => (
                  <tr key={c.key}>
                    <td className="font-medium">{c.label}</td>
                    <td>
                      <div className="mono text-xs">{c.leftValue ?? <span className="text-ink-400">n/a</span>}</div>
                      <div className="text-[10px] text-ink-500">{c.leftSource}</div>
                    </td>
                    <td>
                      <div className="mono text-xs">{c.rightValue ?? <span className="text-ink-400">n/a</span>}</div>
                      <div className="text-[10px] text-ink-500">{c.rightSource}</div>
                    </td>
                    <td>
                      <MatchBadge status={c.status} />
                      {c.score !== null ? <div className="mono mt-1 text-[10px] text-ink-500">{Math.round(c.score * 100)}%</div> : null}
                    </td>
                    <td className="text-xs text-ink-300">{c.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <div className="space-y-4">
        <Panel title="Verification metadata">
          <Kv
            rows={[
              ['Verification ID', <span key="v" className="mono text-xs">{p.verification.verificationId}</span>],
              ['Reference ID', p.verification.referenceId],
              ['Status', <Badge key="s" tone={p.verification.status === 'COMPLETED' ? 'good' : 'warn'}>{p.verification.status}</Badge>],
              ['Requested', formatDate(p.verification.requestedAt)],
              ['Completed', formatDate(p.verification.completedAt)],
              ['Provider', `${p.provider.name} (${p.provider.key} v${p.provider.adapterVersion})`],
              ['Provider request', p.verification.providerRequestId],
            ]}
          />
        </Panel>
        <Panel title="How to read this page">
          <ul className="space-y-1.5 text-xs text-ink-300">
            <li><ProvenanceTag kind="VERIFIED_FACT" /> returned directly by the provider.</li>
            <li><ProvenanceTag kind="DERIVED" /> computed by BENFILE from verified data.</li>
            <li><ProvenanceTag kind="CLIENT_DECLARED" /> supplied by the client.</li>
            <li><ProvenanceTag kind="ANALYST_ASSESSMENT" /> entered by an analyst.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
