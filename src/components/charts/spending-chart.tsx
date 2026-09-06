'use client';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const style = { background: '#0F1621', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 };
const fmt = (v: number) => `${(v / 1000).toFixed(0)}k`;

export function SpendingChart({ data }: { data: Array<{ period: string; inflows: number; outflows: number; essential: number; discretionary: number; investments: number; debt: number }> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="h-56">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="period" tick={{ fill: '#8E9DB8', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmt} tick={{ fill: '#8E9DB8', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={style} formatter={(v: number) => `INR ${v.toLocaleString('en-IN')}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="inflows" stroke="#2FBF71" strokeWidth={2} dot={false} name="Inflows" />
            <Line type="monotone" dataKey="outflows" stroke="#E05252" strokeWidth={2} dot={false} name="Outflows" />
            <Line type="monotone" dataKey="investments" stroke="#D4A94A" strokeWidth={2} dot={false} name="Investments" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="period" tick={{ fill: '#8E9DB8', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmt} tick={{ fill: '#8E9DB8', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={style} formatter={(v: number) => `INR ${v.toLocaleString('en-IN')}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="essential" stackId="a" fill="#4C8DFF" name="Essential" />
            <Bar dataKey="discretionary" stackId="a" fill="#9A7BFF" name="Discretionary" />
            <Bar dataKey="debt" stackId="a" fill="#E8B23A" name="Debt payments" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
