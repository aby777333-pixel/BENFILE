'use client';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const TIP = { background: '#0F1621', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 } as const;
const LABEL = { color: '#BCC7DB' } as const;
const AXIS = { fill: '#8E9DB8', fontSize: 11 } as const;

export interface BarDatum {
  label: string;
  value: number;
}

/** Compact horizontal bar chart for stage funnels and status breakdowns. Counts only - never PII. */
export function CountBars({ data, color = '#D4A94A', height = 220, valueLabel = 'Count' }: { data: BarDatum[]; color?: string; height?: number; valueLabel?: string }) {
  if (!data.length) return <div className="text-sm text-ink-400">No data to chart.</div>;
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.06)" />
          <XAxis type="number" tick={AXIS} allowDecimals={false} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={150} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TIP} labelStyle={LABEL} cursor={{ fill: 'rgba(255,255,255,0.03)' }} formatter={(v: number) => [v, valueLabel]} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18}>
            {data.map((d, i) => (
              <Cell key={d.label} fill={color} fillOpacity={0.55 + (0.45 * (data.length - i)) / data.length} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
