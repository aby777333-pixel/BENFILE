/** Radial relationship map. Confirmed edges are solid; possible edges dashed. Server-renderable SVG. */
export interface GraphEdge {
  toType: string;
  toId: string;
  toLabel: string;
  relation: string;
  status: 'CONFIRMED' | 'POSSIBLE' | 'REJECTED' | string;
  sourceKey: string;
  tier: number;
  confidence?: number | null;
}

const TYPE_COLOR: Record<string, string> = {
  EMPLOYER: '#D4A94A',
  COMPANY: '#D4A94A',
  DIRECTORSHIP: '#E2BE67',
  RELATIVE: '#3AB8C8',
  ADDRESS: '#9A7BFF',
  BANK: '#2FBF71',
  PHONE: '#4C8DFF',
  EMAIL: '#4C8DFF',
  PROFILE: '#8E9DB8',
  SOCIAL_PROFILE: '#8E9DB8',
  PROFESSIONAL_PROFILE: '#8E9DB8',
  WEBSITE: '#8E9DB8',
  LEGAL_RECORD: '#E05252',
  NEWS: '#E8B23A',
  ASSET: '#E2BE67',
  REGULATORY: '#4C8DFF',
};

export function RelationshipGraph({ center, edges, width = 860, height = 520 }: { center: string; edges: GraphEdge[]; width?: number; height?: number }) {
  const live = edges.filter((e) => e.status !== 'REJECTED');
  const cx = width / 2;
  const cy = height / 2;
  const groups = new Map<string, GraphEdge[]>();
  for (const e of live) groups.set(e.toType, [...(groups.get(e.toType) ?? []), e]);
  const nodes: Array<GraphEdge & { x: number; y: number; color: string }> = [];
  const n = live.length || 1;
  let i = 0;
  for (const [, list] of groups) {
    for (const e of list) {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const ring = e.status === 'CONFIRMED' ? 0.62 : 0.9;
      const rx = (width / 2 - 90) * ring;
      const ry = (height / 2 - 40) * ring;
      nodes.push({ ...e, x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle), color: TYPE_COLOR[e.toType] ?? '#8E9DB8' });
      i++;
    }
  }
  const trunc = (s: string, m = 26) => (s.length > m ? `${s.slice(0, m - 1)}...` : s);
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="min-w-[640px]" role="img" aria-label="Relationship graph">
        <ellipse cx={cx} cy={cy} rx={(width / 2 - 90) * 0.62} ry={(height / 2 - 40) * 0.62} fill="none" stroke="rgba(255,255,255,0.05)" />
        <ellipse cx={cx} cy={cy} rx={(width / 2 - 90) * 0.9} ry={(height / 2 - 40) * 0.9} fill="none" stroke="rgba(255,255,255,0.04)" strokeDasharray="3 5" />
        {nodes.map((nd, k) => (
          <g key={k}>
            <line x1={cx} y1={cy} x2={nd.x} y2={nd.y} stroke={nd.color} strokeOpacity={nd.status === 'CONFIRMED' ? 0.55 : 0.35} strokeWidth={nd.status === 'CONFIRMED' ? 1.6 : 1.2} strokeDasharray={nd.status === 'CONFIRMED' ? undefined : '5 4'} />
            <text x={(cx + nd.x) / 2} y={(cy + nd.y) / 2 - 4} fontSize={9.5} fill="#8E9DB8" textAnchor="middle" transform={`rotate(${(Math.atan2(nd.y - cy, nd.x - cx) * 180) / Math.PI + (nd.x < cx ? 180 : 0)} ${(cx + nd.x) / 2} ${(cy + nd.y) / 2})`}>
              {nd.relation.replace(/_/g, ' ').toLowerCase()}
            </text>
            <circle cx={nd.x} cy={nd.y} r={7} fill={nd.color} fillOpacity={nd.status === 'CONFIRMED' ? 1 : 0.35} stroke={nd.color} strokeWidth={1.5} />
            <text x={nd.x} y={nd.y + (nd.y >= cy ? 20 : -13)} fontSize={11} fill="#E3E9F3" textAnchor="middle">
              {trunc(nd.toLabel)}
            </text>
            <text x={nd.x} y={nd.y + (nd.y >= cy ? 32 : -25)} fontSize={9} fill="#8E9DB8" textAnchor="middle">
              {nd.toType.replace(/_/g, ' ')} - {nd.sourceKey} T{nd.tier}
              {nd.status !== 'CONFIRMED' ? ` - ${nd.confidence ?? '?'}% possible` : ''}
            </text>
          </g>
        ))}
        <circle cx={cx} cy={cy} r={30} fill="#141C29" stroke="#D4A94A" strokeWidth={2} />
        <text x={cx} y={cy + 4} fontSize={11} fontWeight={700} fill="#F0D58F" textAnchor="middle">
          CLIENT
        </text>
        <text x={cx} y={cy + 48} fontSize={12} fontWeight={600} fill="#E3E9F3" textAnchor="middle">
          {trunc(center, 32)}
        </text>
      </svg>
    </div>
  );
}
