import { loadClient } from '@/lib/db/load-client';
import { hasPermission } from '@/lib/security/permissions';
import { formatDate } from '@/lib/engines/normalize';
import { Panel, Empty, Kv } from '@/components/ui/panel';
import { Badge, MatchBadge, ProvenanceTag, SourceTag } from '@/components/ui/badges';
import { EvidenceDrawer } from '@/components/ui/evidence';
import { MaskedValue } from '@/components/ui/masked';
import { DisputeButton } from '@/components/client360/dispute-button';
import { ContactEditForm } from '@/components/client360/contact-edit-form';

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, role } = await loadClient(id, 'contact');
  const { run, sensitive, client } = c360;
  const canReveal = hasPermission(role, 'sensitive:reveal');
  const canWrite = hasPermission(role, 'clients:write');
  const declared = (
    <Panel title="Contact given at prospect creation" right={<Badge tone="declared">Client declared</Badge>}>
      {client.contact_phone_masked || client.contact_email_masked ? (
        <dl className="kv">
          <dt>Mobile</dt>
          <dd>{client.contact_phone_masked ? <MaskedValue masked={client.contact_phone_masked} sensitiveId={client.contact_phone_sensitive_id} canReveal={canReveal} /> : <span className="text-ink-400">Not given</span>}</dd>
          <dt>E-mail</dt>
          <dd>{client.contact_email_masked ? <MaskedValue masked={client.contact_email_masked} sensitiveId={client.contact_email_sensitive_id} canReveal={canReveal} /> : <span className="text-ink-400">Not given</span>}</dd>
        </dl>
      ) : (
        <p className="text-sm text-ink-400">No contact details were captured when the prospect was created.</p>
      )}
      <p className="mt-2 text-[11px] text-ink-500">Entered by the relationship manager. Not verified until a one-time-code or provider check confirms ownership under the client&apos;s consent.</p>
      {canWrite ? <ContactEditForm clientId={id} hasPhone={!!client.contact_phone_masked} hasEmail={!!client.contact_email_masked} /> : null}
    </Panel>
  );
  if (!run?.assessment)
    return (
      <div className="space-y-4">
        {declared}
        <Empty>No verification run yet.</Empty>
      </div>
    );
  const m = run.canonical.mobile;
  const risk = run.canonical.providerRisk;
  const checks = run.assessment.identityChecks.filter((c) => c.key.startsWith('phone.') || c.key.startsWith('email.'));
  const yesno = (v: boolean | null) => (v === null ? <span className="text-ink-400">Not returned</span> : v ? <Badge tone="good">Yes</Badge> : <Badge tone="warn">No</Badge>);
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        {client.contact_phone_masked || client.contact_email_masked || canWrite ? declared : null}
        <Panel title="Phone numbers" right={<span className="text-[11px] text-ink-400">Each number shows the source it is linked to</span>}>
          {sensitive.phones.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Type</th>
                  <th>Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sensitive.phones.map((ph, i) => (
                  <tr key={i}>
                    <td>
                      <MaskedValue masked={ph.number_masked} sensitiveId={ph.sensitive_value_id} canReveal={canReveal} />
                    </td>
                    <td>{ph.phone_type ?? '-'}</td>
                    <td>
                      <SourceTag sourceKey={ph.source_key} tier={ph.tier} />
                    </td>
                    <td>
                      <EvidenceDrawer runId={run.id} evidence={[{ label: 'Phone record', sourceKey: ph.source_key, path: ph.evidence_path, value: ph.number_masked }]} title="Phone record" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No phone numbers returned.</Empty>
          )}
        </Panel>
        <Panel title="E-mail addresses">
          {sensitive.emails.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>E-mail</th>
                  <th>Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sensitive.emails.map((e, i) => (
                  <tr key={i}>
                    <td>
                      <MaskedValue masked={e.email_masked} sensitiveId={e.sensitive_value_id} canReveal={canReveal} />
                    </td>
                    <td>
                      <SourceTag sourceKey={e.source_key} tier={e.tier} />
                    </td>
                    <td>
                      <EvidenceDrawer runId={run.id} evidence={[{ label: 'E-mail record', sourceKey: e.source_key, path: e.evidence_path, value: e.email_masked }]} title="E-mail record" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No e-mail addresses returned.</Empty>
          )}
          <div className="mt-3">
            <DisputeButton clientId={id} entityTable="phone_numbers" />
          </div>
        </Panel>
        <Panel title="Contact consistency" right={<ProvenanceTag kind="DERIVED" short />}>
          {checks.length ? (
            <ul className="space-y-2">
              {checks.map((c) => (
                <li key={c.key} className="rounded-lg border border-white/[0.06] p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <MatchBadge status={c.status} />
                    <span className="font-medium">{c.label}</span>
                  </div>
                  <div className="mono mt-1 text-xs text-ink-300">
                    {c.leftValue ?? 'n/a'} <span className="text-ink-500">vs</span> {c.rightValue ?? 'n/a'}
                  </div>
                  <p className="mt-1 text-xs text-ink-400">{c.explanation}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Insufficient contact data to compare.</Empty>
          )}
        </Panel>
      </div>
      <div className="space-y-4">
        <Panel title="Mobile intelligence" right={m ? <SourceTag sourceKey="MOBILE" tier={m.provenance.tier} /> : null}>
          {m ? (
            <>
              <Kv
                rows={[
                  ['Number', <MaskedValue key="n" masked={m.number} canReveal={false} />],
                  ['Validity', yesno(m.isValid)],
                  ['Subscriber status', m.subscriberStatus ? <Badge key="s" tone={['CONNECTED', 'ACTIVE'].includes(m.subscriberStatus) ? 'good' : 'bad'}>{m.subscriberStatus}</Badge> : null],
                  ['Connection', m.connectionType === 'UNKNOWN' ? null : m.connectionType],
                  ['Service provider', m.serviceProvider],
                  ['Original provider', m.originalProvider],
                  ['Network region', m.networkRegion],
                  ['Ported', yesno(m.isPorted)],
                  ['Retrieved', formatDate(m.provenance.retrievedAt)],
                ]}
              />
              <div className="mt-3">
                <EvidenceDrawer runId={run.id} evidence={[{ label: 'Mobile intelligence', sourceKey: 'MOBILE', path: m.provenance.evidencePath }]} title="Mobile intelligence" />
              </div>
            </>
          ) : (
            <Empty>No mobile intelligence returned.</Empty>
          )}
        </Panel>
        <Panel title="Provider risk indicators (verbatim)" right={<Badge tone="good">Verified fact</Badge>}>
          {risk.length ? (
            <ul className="space-y-3">
              {risk.map((r, i) => (
                <li key={i} className="rounded-lg border border-white/[0.06] bg-ink-900 p-3 text-sm">
                  <Kv
                    rows={[
                      ['Provider safe flag', r.isSafe === null ? null : r.isSafe ? <Badge key="a" tone="good">Yes</Badge> : <Badge key="b" tone="bad">No</Badge>],
                      ['Provider risk level', <Badge key="l" tone={['HIGH', 'CRITICAL'].includes(r.riskLevel) ? 'bad' : r.riskLevel === 'MEDIUM' ? 'warn' : 'info'}>{r.riskLevel}</Badge>],
                      ['Reason', r.reason],
                      ['Description', r.description],
                      ['Date detected', formatDate(r.detectedAt)],
                      ['Last updated', formatDate(r.updatedAt)],
                    ]}
                  />
                  {(r.isSafe === false && ['LOW', 'INFO'].includes(r.riskLevel)) || (r.isSafe === true && ['HIGH', 'CRITICAL'].includes(r.riskLevel)) ? (
                    <p className="mt-2 text-[11px] text-amber-300">Safe flag and risk level disagree. BENFILE shows both as returned and raises a Needs Review signal rather than inventing an interpretation.</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No provider risk indicators.</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
