'use client';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cr } from '@/lib/wealth/wealth-engine';

const COLORS = ['#D4A94A', '#2FBF71', '#4C8DFF', '#9A7BFF', '#3AB8C8', '#E8B23A', '#E2BE67', '#8E9DB8', '#F0D58F', '#E05252', '#BCC7DB', '#26334A'];
const TIP = { background: '#0F1621', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 } as const;
const LABEL = { color: '#BCC7DB' } as const;
const AXIS = { fill: '#8E9DB8', fontSize: 11 } as const;
const inr = (v: number) => `INR ${cr(v)}`;

export interface CompositionSlice {
  key: string;
  label: string;
  mid: number;
  pct: number;
  verifiedPct: number;
}

/** Wealth composition donut. Every slice states how much of its value rests on reliable evidence. */
export function CompositionChart({ slices, verifiedShare, estimatedShare, declaredShare }: { slices: CompositionSlice[]; verifiedShare: number; estimatedShare: number; declaredShare: number }) {
  if (!slices.length) return <div className="text-sm text-ink-400">No valued personal assets to chart. Family-linked wealth and possible associations are never charted here.</div>;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="grid items-center gap-4 md:grid-cols-[220px_1fr]">
      <div className="h-56">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={slices} dataKey="mid" nameKey="label" innerRadius={55} outerRadius={92} stroke="#0F1621" strokeWidth={2} paddingAngle={2}>
              {slices.map((s, i) => (
                <Cell key={s.key} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TIP} labelStyle={LABEL} formatter={(v: number) => [inr(v), 'Mid value']} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="min-w-0">
        <ul className="space-y-1.5">
          {slices.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="flex-1 truncate text-ink-100">{s.label}</span>
              <span className="mono text-ink-300">{s.pct}%</span>
              <span className="mono w-24 text-right text-ink-100">{inr(s.mid)}</span>
              <span className={`mono w-20 text-right ${s.verifiedPct >= 70 ? 'text-emerald-300' : s.verifiedPct > 0 ? 'text-amber-300' : 'text-ink-400'}`}>{s.verifiedPct}% verified</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.06] pt-2 text-[11px] text-ink-300">
          <span>
            <span className="text-emerald-300">Verified / official / authorised</span> {pct(verifiedShare)}
          </span>
          <span>
            <span className="text-violet-300">Derived estimate</span> {pct(estimatedShare)}
          </span>
          <span>
            <span className="text-cyan-300">Client declared / analyst</span> {pct(declaredShare)}
          </span>
          <span className="text-ink-400">of total personal asset mid-value</span>
        </div>
      </div>
    </div>
  );
}

/** Small bureau score history line (300-900). */
export function ScoreHistoryChart({ history }: { history: Array<{ date: string; score: number }> }) {
  const data = [...history].filter((h) => h && h.date && Number.isFinite(Number(h.score))).map((h) => ({ date: h.date, score: Number(h.score) })).sort((a, b) => a.date.localeCompare(b.date));
  if (data.length < 2) return <div className="text-xs text-ink-400">Score history not returned by the bureau (at least two points needed).</div>;
  return (
    <div className="h-36 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis domain={[300, 900]} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TIP} labelStyle={LABEL} formatter={(v: number) => [v, 'Score']} />
          <Line type="monotone" dataKey="score" stroke="#D4A94A" strokeWidth={2} dot={{ r: 3, fill: '#D4A94A' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface CashFlowPoint {
  period: string;
  inflows: number | null;
  outflows: number | null;
  savings: number | null;
  investment: number | null;
  debt: number | null;
}

/** Monthly inflows vs outflows (areas) with savings / investment / debt lines. Values in INR lakh. */
export function CashFlowChart({ points }: { points: CashFlowPoint[] }) {
  const L = (v: number | null) => (v === null ? null : Math.round((v / 1e5) * 100) / 100);
  const data = [...points].sort((a, b) => a.period.localeCompare(b.period)).map((p) => ({ period: p.period, inflows: L(p.inflows), outflows: L(p.outflows), savings: L(p.savings), investment: L(p.investment), debt: L(p.debt) }));
  if (!data.length) return <div className="text-sm text-ink-400">No cash-flow periods.</div>;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="cfIn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2FBF71" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#2FBF71" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="cfOut" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E05252" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#E05252" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="period" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} unit="L" />
          <Tooltip contentStyle={TIP} labelStyle={LABEL} formatter={(v: number, n: string) => [`INR ${v} L`, n]} />
          <Area type="monotone" dataKey="inflows" name="Inflows" stroke="#2FBF71" strokeWidth={2} fill="url(#cfIn)" />
          <Area type="monotone" dataKey="outflows" name="Outflows" stroke="#E05252" strokeWidth={2} fill="url(#cfOut)" />
          <Line type="monotone" dataKey="savings" name="Net savings" stroke="#D4A94A" strokeWidth={1.8} dot={false} />
          <Line type="monotone" dataKey="investment" name="Investment transfers" stroke="#9A7BFF" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="debt" name="Debt payments" stroke="#E8B23A" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars for category allocation or coverage-by-domain. Values are already in the unit given. */
export function HorizontalBars({ data, unit, max }: { data: Array<{ label: string; value: number }>; unit: 'INR' | '%'; max?: number }) {
  if (!data.length) return <div className="text-xs text-ink-400">Not available.</div>;
  const fmt = (v: number) => (unit === 'INR' ? inr(v) : `${Math.round(v)}%`);
  return (
    <div style={{ height: Math.max(120, data.length * 28 + 24) }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
          <XAxis type="number" hide domain={[0, max ?? 'dataMax']} />
          <YAxis type="category" dataKey="label" width={130} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TIP} labelStyle={LABEL} cursor={{ fill: 'rgba(255,255,255,0.03)' }} formatter={(v: number) => [fmt(v), unit === 'INR' ? 'Amount' : 'Coverage']} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} label={{ position: 'right', fill: '#BCC7DB', fontSize: 11, formatter: (v: number) => fmt(v) }}>
            {data.map((d, i) => (
              <Cell key={d.label} fill={unit === '%' ? (d.value >= 80 ? '#2FBF71' : d.value >= 40 ? '#E8B23A' : '#5B6C8A') : COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
