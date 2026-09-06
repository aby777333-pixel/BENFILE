import clsx from 'clsx';

export function Panel({ title, right, children, className, id }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={clsx('panel', className)}>
      {title ? (
        <header className="panel-head">
          <h3 className="panel-title">{title}</h3>
          {right}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'warn' | 'bad' | 'muted' | 'gold'; className?: string }) {
  const color = tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : tone === 'bad' ? 'text-red-300' : tone === 'gold' ? 'text-gold-300' : tone === 'muted' ? 'text-ink-300' : 'text-ink-100';
  return (
    <div className={clsx('min-w-0', className)}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">{label}</div>
      <div className={clsx('mt-0.5 truncate text-base font-semibold leading-tight', color)}>{value}</div>
      {sub ? <div className="mt-0.5 truncate text-[11px] text-ink-300">{sub}</div> : null}
    </div>
  );
}

export function Empty({ children = 'Not available' }: { children?: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-ink-400">{children}</div>;
}

export function NotAvailable({ label = 'Not Available / Not Verified' }: { label?: string }) {
  return <span className="text-ink-400">{label}</span>;
}

export function Kv({ rows }: { rows: Array<[React.ReactNode, React.ReactNode]> }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt>{k}</dt>
          <dd>{v ?? <NotAvailable />}</dd>
        </div>
      ))}
    </dl>
  );
}
