/** SVG arc gauge for bounded scores (credit 300-900, profile score 0-100). Server-renderable. */
export function Gauge({ value, min, max, label, sublabel, bands, size = 180 }: { value: number | null; min: number; max: number; label: string; sublabel?: string; bands?: Array<{ upTo: number; color: string }>; size?: number }) {
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const start = Math.PI;
  const end = 2 * Math.PI;
  const pos = value === null ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const arc = (from: number, to: number) => {
    const a1 = start + (end - start) * from;
    const a2 = start + (end - start) * to;
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const segs = bands ?? [{ upTo: max, color: '#D4A94A' }];
  let prev = 0;
  const needle = start + (end - start) * pos;
  const nx = cx + (r - 2) * Math.cos(needle);
  const ny = cy + (r - 2) * Math.sin(needle);
  const color = value === null ? '#5B6C8A' : (segs.find((b) => value <= b.upTo)?.color ?? segs[segs.length - 1].color);
  return (
    <svg width={size} height={size / 2 + 34} viewBox={`0 0 ${size} ${size / 2 + 34}`} role="img" aria-label={`${label} ${value ?? 'not available'}`}>
      {segs.map((b, i) => {
        const from = prev;
        const to = Math.max(0, Math.min(1, (b.upTo - min) / (max - min)));
        prev = to;
        return <path key={i} d={arc(from, to)} stroke={b.color} strokeOpacity={0.28} strokeWidth={10} fill="none" strokeLinecap="butt" />;
      })}
      {value !== null ? <path d={arc(0, pos)} stroke={color} strokeWidth={10} fill="none" strokeLinecap="round" /> : null}
      {value !== null ? <circle cx={nx} cy={ny} r={5} fill={color} stroke="#0F1621" strokeWidth={2} /> : null}
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize={size / 5} fontWeight={700} fill={value === null ? '#8E9DB8' : '#E3E9F3'} fontFamily="ui-monospace, monospace">
        {value === null ? 'N/A' : value}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={11} fill="#8E9DB8" letterSpacing={1.5}>
        {label.toUpperCase()}
      </text>
      {sublabel ? (
        <text x={cx} y={cy + 30} textAnchor="middle" fontSize={11} fill={color}>
          {sublabel}
        </text>
      ) : null}
    </svg>
  );
}

export const CREDIT_BANDS = [
  { upTo: 649, color: '#E05252' },
  { upTo: 699, color: '#E8B23A' },
  { upTo: 749, color: '#4C8DFF' },
  { upTo: 799, color: '#2FBF71' },
  { upTo: 900, color: '#D4A94A' },
];
