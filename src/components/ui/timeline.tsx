import { formatDate } from '@/lib/engines/normalize';

export interface TimelineItem {
  at: string | null;
  title: string;
  detail?: string | null;
  meta?: React.ReactNode;
  tone?: 'good' | 'warn' | 'bad' | 'neutral' | 'gold';
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <div className="text-sm text-ink-400">No events yet.</div>;
  const dot = { good: 'bg-verified', warn: 'bg-warn', bad: 'bg-danger', neutral: 'bg-ink-400', gold: 'bg-gold-500' } as const;
  return (
    <ol className="relative ml-2 border-l border-white/10 pl-5">
      {items.map((it, i) => (
        <li key={i} className="relative mb-5 last:mb-0">
          <span className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-ink-850 ${dot[it.tone ?? 'neutral']}`} />
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{formatDate(it.at)}</div>
          <div className="text-sm font-medium text-ink-100">{it.title}</div>
          {it.detail ? <div className="mt-0.5 text-xs text-ink-300">{it.detail}</div> : null}
          {it.meta ? <div className="mt-1 flex flex-wrap gap-1.5">{it.meta}</div> : null}
        </li>
      ))}
    </ol>
  );
}
