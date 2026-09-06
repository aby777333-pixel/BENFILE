'use client';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PfFiling } from '@/lib/canonical/types';

export function PfFilingChart({ filings }: { filings: PfFiling[] }) {
  const data = [...filings].sort((a, b) => a.period.localeCompare(b.period)).map((f) => ({ period: f.period, employees: f.employeeCount, amount: f.amount ? Math.round(f.amount / 100000) / 10 : null }));
  if (!data.length) return <div className="text-sm text-ink-400">No PF filing history returned.</div>;
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="pfGold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D4A94A" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#D4A94A" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="period" tick={{ fill: '#8E9DB8', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="emp" tick={{ fill: '#8E9DB8', fontSize: 11 }} axisLine={false} tickLine={false} domain={['dataMin - 50', 'dataMax + 50']} />
          <Tooltip contentStyle={{ background: '#0F1621', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#BCC7DB' }} formatter={(v: number, n: string) => (n === 'employees' ? [v, 'Employees filed'] : [`INR ${v} Cr`, 'Contribution'])} />
          <Area yAxisId="emp" type="monotone" dataKey="employees" stroke="#D4A94A" strokeWidth={2} fill="url(#pfGold)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
