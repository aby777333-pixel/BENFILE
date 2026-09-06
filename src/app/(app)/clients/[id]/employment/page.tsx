import { loadClient } from '@/lib/db/load-client';
import { hasPermission } from '@/lib/security/permissions';
import { formatDate, formatTenure, monthsBetween } from '@/lib/engines/normalize';
import { Panel, Empty, Kv } from '@/components/ui/panel';
import { Badge, ProvenanceTag, SourceTag } from '@/components/ui/badges';
import { EvidenceDrawer } from '@/components/ui/evidence';
import { MaskedValue } from '@/components/ui/masked';
import { PfFilingChart } from '@/components/charts/pf-chart';
import { Timeline } from '@/components/ui/timeline';
import { DisputeButton } from '@/components/client360/dispute-button';

export default async function EmploymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, role } = await loadClient(id, 'employment');
  const { run, sensitive } = c360;
  if (!run?.assessment) return <Empty>No verification run yet.</Empty>;
  const emp = run.canonical.employment;
  const current = emp.records.find((r) => r.status === 'CURRENT') ?? emp.records[0];
  const canReveal = hasPermission(role, 'sensitive:reveal');
  const yesno = (v: boolean | null) => (v === null ? <span className="text-ink-400">Not returned</span> : v ? <Badge tone="good">Yes</Badge> : <Badge tone="warn">No</Badge>);
  const empAgeYears = current?.employer.setupDate ? Math.floor((monthsBetween(current.employer.setupDate) ?? 0) / 12) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Current employment" right={current ? <SourceTag sourceKey={current.provenance.sourceKey} tier={current.provenance.tier} /> : null} className="xl:col-span-2">
          {current ? (
            <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
              <Kv
                rows={[
                  ['Employer', <span key="e" className="font-medium text-ink-100">{current.employer.name}</span>],
                  ['Establishment ID', <span key="i" className="mono text-xs">{current.employer.establishmentId ?? '-'}</span>],
                  ['Employment status', <Badge key="s" tone={current.status === 'CURRENT' ? 'good' : current.status === 'EXITED' ? 'warn' : 'muted'}>{current.status}</Badge>],
                  ['Joining date', formatDate(current.joiningDate)],
                  ['Exit date', current.exitDate ? formatDate(current.exitDate) : <span className="text-ink-400">Not applicable (current)</span>],
                  ['Employment tenure', <span key="t" className="flex items-center gap-2">{formatTenure(monthsBetween(current.joiningDate, current.exitDate))}<ProvenanceTag kind="DERIVED" short /></span>],
                ]}
              />
              <Kv
                rows={[
                  ['Ownership type', current.employer.ownershipType],
                  ['Employer confidence', current.employer.confidence !== null ? <span key="c" className="mono">{Math.round(current.employer.confidence * 100)}% <span className="text-[10px] text-ink-500">provider score</span></span> : null],
                  ['Employee-name match', yesno(current.employeeNameMatch)],
                  ['Employer-name match', yesno(current.employerNameMatch)],
                  ['Name on EPFO record', current.employeeNameOnRecord],
                  ['UAN - Aadhaar linkage', yesno(emp.epfo?.aadhaarLinked ?? null)],
                ]}
              />
            </div>
          ) : (
            <Empty>No employment records returned. Absence of EPFO data is not negative information (self-employment, non-EPFO employers).</Empty>
          )}
          {current ? (
            <div className="mt-3 flex items-center gap-3">
              <EvidenceDrawer runId={run.id} evidence={[{ label: 'EPFO employment record', sourceKey: 'UAN', path: current.provenance.evidencePath, value: current.employer.name }]} title="EPFO record" />
              <DisputeButton clientId={id} entityTable="employment_records" fieldKey="employer_name" />
            </div>
          ) : null}
        </Panel>
        <Panel title="EPFO / UAN" right={<Badge tone="good">Verified fact</Badge>}>
          {emp.epfo ? (
            <Kv
              rows={[
                ['UAN', <MaskedValue key="u" masked={sensitive.epfo?.uan_masked ?? null} sensitiveId={sensitive.epfo?.uan_sensitive_value_id} canReveal={canReveal} />],
                ['EPFO member ID', <MaskedValue key="m" masked={sensitive.epfo?.member_id_masked ?? null} sensitiveId={sensitive.epfo?.member_id_sensitive_value_id} canReveal={canReveal} />],
                ['Aadhaar linked', yesno(emp.epfo.aadhaarLinked)],
                ['PF filing available', yesno(emp.epfo.pfFilingAvailable)],
                ['Employee-name match', yesno(emp.epfo.employeeNameMatch)],
                ['Retrieved', formatDate(emp.epfo.provenance.retrievedAt)],
              ]}
            />
          ) : (
            <Empty>No EPFO record.</Empty>
          )}
        </Panel>
      </div>

      {current ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Employer intelligence" right={<Badge tone="derived">Derived from provider facts</Badge>}>
            <Kv
              rows={[
                ['Employer setup date', formatDate(current.employer.setupDate)],
                ['Employer age', empAgeYears !== null ? `${empAgeYears} years` : null],
                ['Employee count', current.employer.employeeCount?.toLocaleString('en-IN')],
                ['PF filings on record', current.employer.pfFilings.length ? `${current.employer.pfFilings.length} months` : 'None returned'],
                ['Latest filing', current.employer.pfFilings.length ? current.employer.pfFilings[current.employer.pfFilings.length - 1].period : null],
              ]}
            />
            <p className="mt-3 text-[11px] text-ink-500">Facts (setup date, headcount, filings) are supplied by the provider. Employer age and trend are BENFILE interpretations.</p>
          </Panel>
          <Panel title="PF contribution trend (employees filed per wage month)" className="xl:col-span-2" right={<SourceTag sourceKey="UAN" tier={2} />}>
            <PfFilingChart filings={current.employer.pfFilings} />
            {current.employer.pfFilings.length >= 2 ? (
              <p className="mt-2 text-xs text-ink-300">
                <ProvenanceTag kind="DERIVED" short /> Headcount moved from {current.employer.pfFilings[0].employeeCount ?? '?'} to {current.employer.pfFilings[current.employer.pfFilings.length - 1].employeeCount ?? '?'} across {current.employer.pfFilings.length} filings - {(() => {
                  const f = current.employer.pfFilings;
                  const d = (f[f.length - 1].employeeCount ?? 0) - (f[0].employeeCount ?? 0);
                  return d > 0 ? 'growing' : d < 0 ? 'contracting' : 'flat';
                })()}.
              </p>
            ) : null}
          </Panel>
        </div>
      ) : null}

      <Panel title="Employment history" right={<Badge tone="good">Verified fact</Badge>}>
        <Timeline
          items={emp.records.map((r) => ({
            at: r.joiningDate,
            title: `${r.employer.name}${r.status === 'CURRENT' ? ' - current' : ''}`,
            detail: `${formatDate(r.joiningDate, { month: 'short', year: 'numeric' })} - ${r.exitDate ? formatDate(r.exitDate, { month: 'short', year: 'numeric' }) : 'present'} - ${formatTenure(monthsBetween(r.joiningDate, r.exitDate))}${r.employer.ownershipType ? ` - ${r.employer.ownershipType}` : ''}`,
            tone: r.status === 'CURRENT' ? 'good' : 'neutral',
            meta: (
              <>
                <SourceTag sourceKey={r.provenance.sourceKey} tier={r.provenance.tier} />
                {r.employer.confidence !== null ? <Badge tone={r.employer.confidence >= 0.9 ? 'good' : r.employer.confidence >= 0.7 ? 'info' : 'warn'}>confidence {Math.round(r.employer.confidence * 100)}%</Badge> : null}
                <EvidenceDrawer runId={run.id} evidence={[{ label: r.employer.name, sourceKey: 'UAN', path: r.provenance.evidencePath }]} title={r.employer.name} />
              </>
            ),
          }))}
        />
      </Panel>
    </div>
  );
}
