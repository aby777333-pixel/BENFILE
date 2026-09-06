import { loadClient } from '@/lib/db/load-client';
import { formatDate } from '@/lib/engines/normalize';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, SourceTag, StatusBadge } from '@/components/ui/badges';
import { RelationshipGraph } from '@/components/charts/relationship-graph';

export default async function GraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, db } = await loadClient(id, 'graph');
  const { data: rels } = await db.from('relationships').select('*').eq('client_id', id).order('status').order('tier');
  const edges = (rels ?? []).map((r) => ({ toType: r.to_type, toId: r.to_id, toLabel: r.to_label, relation: r.relation, status: r.status, sourceKey: r.source_key, tier: r.tier, confidence: r.confidence }));
  const confirmed = edges.filter((e) => e.status === 'CONFIRMED').length;
  const possible = edges.filter((e) => e.status === 'POSSIBLE').length;
  return (
    <div className="space-y-4">
      <Panel title="Relationship intelligence graph" right={<div className="flex gap-2"><Badge tone="good">{confirmed} confirmed</Badge><Badge tone="warn">{possible} possible</Badge></div>}>
        {edges.length ? <RelationshipGraph center={c360.client.display_name} edges={edges} /> : <Empty>No relationships yet. Verified employers, relatives, addresses and banks appear after ingest; external findings appear after review.</Empty>}
        <p className="mt-2 text-[11px] text-ink-500">Solid lines: confirmed relationships from Tier 1-2 sources or reviewer-confirmed matches. Dashed lines: possible relationships attached by a reviewer with less than a confirmed identity match. Every edge carries provenance below.</p>
      </Panel>
      <Panel title="Edges & provenance">
        {rels?.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Relation</th>
                  <th>Entity</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Confidence</th>
                  <th>Source</th>
                  <th>Retrieved</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {rels.map((r) => (
                  <tr key={r.id}>
                    <td className="text-xs">{r.relation.replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="font-medium">{r.to_label}</td>
                    <td className="text-xs">{r.to_type.replace(/_/g, ' ')}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="mono text-xs">{r.confidence ?? '-'}%</td>
                    <td><SourceTag sourceKey={r.source_key} tier={r.tier} /></td>
                    <td className="text-xs">{formatDate(r.retrieved_at)}</td>
                    <td className="mono max-w-xs truncate text-[10.5px] text-ink-400">{JSON.stringify(r.evidence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No edges.</Empty>
        )}
      </Panel>
    </div>
  );
}
