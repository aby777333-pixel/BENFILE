import { loadClient } from '@/lib/db/load-client';
import { hasPermission } from '@/lib/security/permissions';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, MatchBadge, ProvenanceTag, SourceTag } from '@/components/ui/badges';
import { EvidenceDrawer } from '@/components/ui/evidence';
import { MaskedValue } from '@/components/ui/masked';
import { DisputeButton } from '@/components/client360/dispute-button';

export default async function BankingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, role } = await loadClient(id, 'banking');
  const { run, sensitive } = c360;
  if (!run?.assessment) return <Empty>No verification run yet.</Empty>;
  const canReveal = hasPermission(role, 'sensitive:reveal');
  const nameCheck = run.assessment.identityChecks.find((c) => c.key === 'name.person_vs_bank');
  return (
    <div className="space-y-4">
      <Panel title="Bank accounts" right={<span className="text-[11px] text-ink-400">Account numbers masked by default</span>}>
        {sensitive.banks.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>IFSC</th>
                  <th>Bank / branch</th>
                  <th>Type</th>
                  <th>Name on account</th>
                  <th>Ownership verified</th>
                  <th>Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sensitive.banks.map((b, i) => (
                  <tr key={i}>
                    <td>
                      <MaskedValue masked={b.account_masked} sensitiveId={b.sensitive_value_id} canReveal={canReveal} />
                    </td>
                    <td className="mono text-xs">{b.ifsc ?? '-'}</td>
                    <td>
                      <div>{b.bank_name ?? '-'}</div>
                      <div className="text-xs text-ink-400">{b.branch ?? ''}</div>
                    </td>
                    <td>{b.account_type ?? '-'}</td>
                    <td>{b.holder_name ?? <span className="text-ink-400">Not returned</span>}</td>
                    <td>{b.verified === true ? <Badge tone="good">Verified</Badge> : b.verified === false ? <Badge tone="bad">Failed</Badge> : <Badge tone="muted">Not verified</Badge>}</td>
                    <td>
                      <SourceTag sourceKey={b.source_key} tier={b.tier} />
                    </td>
                    <td>
                      <EvidenceDrawer runId={run.id} evidence={[{ label: 'Bank account', sourceKey: b.source_key, path: b.evidence_path, value: b.account_masked }]} title="Bank record" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No bank account information was returned. This is not a negative indicator; request account details if the workflow needs them.</Empty>
        )}
        <div className="mt-3">
          <DisputeButton clientId={id} entityTable="bank_accounts" />
        </div>
      </Panel>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Name on account vs profile" right={<ProvenanceTag kind="DERIVED" short />}>
          {nameCheck && nameCheck.status !== 'NOT_AVAILABLE' ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <MatchBadge status={nameCheck.status} />
                <span className="text-ink-300">{nameCheck.explanation}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded border border-white/[0.06] p-2">
                  <div className="text-ink-400">Profile</div>
                  <div className="mono">{nameCheck.leftValue}</div>
                </div>
                <div className="rounded border border-white/[0.06] p-2">
                  <div className="text-ink-400">Bank</div>
                  <div className="mono">{nameCheck.rightValue}</div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-400">Not comparable - account-holder name not returned.</p>
          )}
        </Panel>
        <Panel title="Banking verification scope">
          <ul className="space-y-1.5 text-xs text-ink-300">
            <li>Account and IFSC details are linked via the source shown on each row (e.g. UAN = EPFO-registered bank account).</li>
            <li>Ownership is marked verified only when a penny-drop or bank-statement verification adapter reports it.</li>
            <li>Balances, transactions and cash-flow are never inferred; connect an account-aggregator adapter to populate the Financial Capacity module.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
