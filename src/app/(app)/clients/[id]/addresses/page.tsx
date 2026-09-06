import { loadClient } from '@/lib/db/load-client';
import { Panel, Empty, Kv } from '@/components/ui/panel';
import { Badge, MatchBadge, ProvenanceTag, SourceTag } from '@/components/ui/badges';
import { EvidenceDrawer } from '@/components/ui/evidence';
import { DisputeButton } from '@/components/client360/dispute-button';

export default async function AddressesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360 } = await loadClient(id, 'addresses');
  const { run } = c360;
  if (!run?.assessment) return <Empty>No verification run yet.</Empty>;
  const addrs = run.canonical.addresses;
  const check = run.assessment.identityChecks.find((c) => c.key === 'address.cross_source');
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {addrs.length ? (
          addrs.map((a, i) => (
            <Panel key={i} title={a.addressType ? `${a.addressType} address` : `Address ${i + 1}`} right={<SourceTag sourceKey={a.provenance.sourceKey} tier={a.provenance.tier} />}>
              <p className="mb-3 text-sm text-ink-100">{a.fullAddress ?? '-'}</p>
              <Kv rows={[['Street', a.street], ['City', a.city], ['State', a.state], ['Country', a.country], ['PIN code', a.pinCode ? <span key="p" className="mono">{a.pinCode}</span> : null]]} />
              <div className="mt-3 flex items-center gap-3">
                <ProvenanceTag kind={a.provenance.assertion} short />
                <EvidenceDrawer runId={run.id} evidence={[{ label: 'Address record', sourceKey: a.provenance.sourceKey, path: a.provenance.evidencePath, value: a.fullAddress }]} title="Address record" />
                <DisputeButton clientId={id} entityTable="client_addresses" fieldKey={a.addressType ?? undefined} />
              </div>
            </Panel>
          ))
        ) : (
          <Empty>No addresses returned.</Empty>
        )}
      </div>
      <Panel title="Address consistency" right={<ProvenanceTag kind="DERIVED" short />}>
        {check ? (
          <div className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <MatchBadge status={check.status} />
              <span className="font-medium">{check.label}</span>
              {check.score !== null ? <Badge tone="muted">text similarity {Math.round(check.score * 100)}%</Badge> : null}
            </div>
            <div className="mono mt-2 text-xs text-ink-300">
              {check.leftValue} <span className="text-ink-500">vs</span> {check.rightValue}
            </div>
            <p className="mt-2 text-xs text-ink-400">{check.explanation}</p>
            <p className="mt-2 text-[11px] text-ink-500">Normalisation applied: city aliases (Bangalore = Bengaluru), state casing, country codes, PIN digits, common address tokens. Multiple addresses across sources are normal.</p>
          </div>
        ) : (
          <p className="text-sm text-ink-400">Only one address available - nothing to compare.</p>
        )}
      </Panel>
    </div>
  );
}
