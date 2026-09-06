import clsx from 'clsx';
import type { AssertionKind, FreshnessLabel, IndicatorState, MatchStatus, Severity, SourceTier } from '@/lib/canonical/types';
import { TIER_LABEL } from '@/lib/canonical/types';

export function Badge({ children, tone = 'neutral', className, title }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'gold' | 'derived' | 'declared' | 'muted'; className?: string; title?: string }) {
  const map = {
    neutral: 'border-white/10 bg-white/[0.04] text-ink-200',
    muted: 'border-white/[0.06] bg-transparent text-ink-400',
    good: 'border-verified/30 bg-verified/10 text-emerald-300',
    warn: 'border-warn/30 bg-warn/10 text-amber-300',
    bad: 'border-danger/30 bg-danger/10 text-red-300',
    info: 'border-info/30 bg-info/10 text-blue-300',
    gold: 'border-gold-500/30 bg-gold-500/10 text-gold-300',
    derived: 'border-derived/30 bg-derived/10 text-violet-300',
    declared: 'border-declared/30 bg-declared/10 text-cyan-300',
  } as const;
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider', map[tone], className)}>
      {children}
    </span>
  );
}

const ASSERTION: Record<AssertionKind, { label: string; tone: 'good' | 'declared' | 'derived' | 'gold'; hint: string }> = {
  VERIFIED_FACT: { label: 'Verified fact', tone: 'good', hint: 'Directly returned by a trusted source' },
  CLIENT_DECLARED: { label: 'Client declared', tone: 'declared', hint: 'Provided directly by the client; not independently verified' },
  DERIVED: { label: 'Derived', tone: 'derived', hint: 'Calculated by BENFILE from verified information' },
  ANALYST_ASSESSMENT: { label: 'Analyst assessment', tone: 'gold', hint: 'Entered or approved by an authorised analyst' },
};
export function ProvenanceTag({ kind, short }: { kind: AssertionKind; short?: boolean }) {
  const a = ASSERTION[kind];
  return (
    <Badge tone={a.tone} title={a.hint}>
      {short ? a.label.split(' ')[0] : a.label}
    </Badge>
  );
}

export function SourceTag({ sourceKey, tier, label }: { sourceKey: string; tier?: SourceTier | number; label?: string }) {
  return (
    <span title={tier ? TIER_LABEL[tier as SourceTier] : undefined} className="inline-flex items-center gap-1 rounded border border-white/10 bg-ink-900 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-300">
      <span className="h-1.5 w-1.5 rounded-full bg-gold-500/70" />
      {label ?? `Source: ${sourceKey}`}
      {tier ? <span className="text-ink-400">T{tier}</span> : null}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity | 'NONE' | string }) {
  const tone = severity === 'CRITICAL' || severity === 'HIGH' ? 'bad' : severity === 'MEDIUM' ? 'warn' : severity === 'LOW' ? 'info' : severity === 'NONE' ? 'good' : 'muted';
  return <Badge tone={tone}>{severity === 'NONE' ? 'No open risk' : severity}</Badge>;
}

export function MatchBadge({ status }: { status: MatchStatus | string }) {
  const tone = status === 'MATCH' ? 'good' : status === 'PARTIAL_MATCH' ? 'warn' : status === 'MISMATCH' ? 'bad' : 'muted';
  return <Badge tone={tone}>{status.replace('_', ' ')}</Badge>;
}

export function EntityMatchBadge({ status, score }: { status: string; score?: number }) {
  const tone = status === 'CONFIRMED' ? 'good' : status === 'HIGH_CONFIDENCE' ? 'info' : status === 'POSSIBLE_MATCH' ? 'warn' : status === 'LOW_CONFIDENCE' ? 'muted' : 'bad';
  return (
    <Badge tone={tone}>
      {status.replace(/_/g, ' ')}
      {score !== undefined ? <span className="mono ml-1 opacity-80">{score}%</span> : null}
    </Badge>
  );
}

export function FreshnessPill({ freshness, ageDays }: { freshness: FreshnessLabel | string; ageDays?: number | null }) {
  const tone = freshness === 'FRESH' ? 'good' : freshness === 'RECENT' ? 'info' : freshness === 'AGING' ? 'warn' : freshness === 'STALE' ? 'bad' : 'muted';
  return (
    <Badge tone={tone}>
      {freshness}
      {ageDays !== undefined && ageDays !== null ? <span className="mono ml-1 opacity-80">{ageDays}d</span> : null}
    </Badge>
  );
}

export function StateBadge({ state }: { state: IndicatorState }) {
  const tone = state === 'STRONG' ? 'good' : state === 'GOOD' ? 'info' : state === 'MODERATE' ? 'warn' : state === 'WEAK' ? 'bad' : state === 'NEEDS_REVIEW' ? 'warn' : 'muted';
  return <Badge tone={tone}>{state.replace('_', ' ')}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ['VERIFIED', 'COMPLETED', 'CLOSED', 'RESOLVED', 'REVIEWED', 'GRANTED', 'ADDED', 'CONFIRMED', 'MATCH'].includes(status)
    ? 'good'
    : ['NEEDS_REVIEW', 'PARTIAL', 'IN_REVIEW', 'AWAITING_CLIENT', 'PENDING', 'OPEN', 'POSSIBLE', 'FLAGGED', 'UNREVIEWED'].includes(status)
      ? 'warn'
      : ['REJECTED', 'FAILED', 'ESCALATED', 'WITHDRAWN', 'EXPIRED', 'MISMATCH'].includes(status)
        ? 'bad'
        : 'neutral';
  return <Badge tone={tone}>{status.replace(/_/g, ' ')}</Badge>;
}

const EVIDENCE: Record<string, { label: string; tone: 'good' | 'declared' | 'info' | 'derived' | 'warn' | 'gold' | 'muted' }> = {
  VERIFIED: { label: 'Verified', tone: 'good' },
  CLIENT_DECLARED: { label: 'Client declared', tone: 'declared' },
  OFFICIAL_PUBLIC_RECORD: { label: 'Official public record', tone: 'good' },
  AUTHORIZED_THIRD_PARTY: { label: 'Authorised third-party data', tone: 'info' },
  DERIVED_ESTIMATE: { label: 'Derived estimate', tone: 'derived' },
  POSSIBLE_ASSOCIATION: { label: 'Possible association', tone: 'warn' },
  ANALYST_PROVIDED: { label: 'Analyst provided', tone: 'gold' },
  OBSERVED_PATTERN: { label: 'Observed pattern', tone: 'derived' },
  AI_INTERPRETATION: { label: 'AI interpretation', tone: 'muted' },
  INSUFFICIENT_DATA: { label: 'Insufficient data', tone: 'muted' },
};
/** Evidence-class label used across wealth, assets, documents and analysis. */
export function EvidenceBadge({ kind, short }: { kind: string; short?: boolean }) {
  const e = EVIDENCE[kind] ?? { label: kind.replace(/_/g, ' '), tone: 'muted' as const };
  return <Badge tone={e.tone}>{short ? e.label.split(' ')[0] : e.label}</Badge>;
}

export function ConfidenceBadge({ level }: { level: string }) {
  const tone = level === 'VERIFIED' || level === 'HIGH' ? 'good' : level === 'MEDIUM' ? 'info' : level === 'LOW' ? 'warn' : 'muted';
  return <Badge tone={tone}>conf {level.toLowerCase()}</Badge>;
}

export function RelevanceBadge({ level }: { level: string }) {
  const tone = level === 'HIGH' ? 'good' : level === 'MEDIUM' ? 'info' : level === 'LOW' ? 'muted' : 'warn';
  return <Badge tone={tone}>{level.replace(/_/g, ' ')}</Badge>;
}

export function ModeBadge({ mode }: { mode: 'LIVE' | 'SANDBOX' | string }) {
  return mode === 'SANDBOX' ? (
    <Badge tone="warn" title="Illustrative connector - no licensed API configured. Replace with a live connector before production use.">
      Sandbox
    </Badge>
  ) : (
    <Badge tone="good">Live</Badge>
  );
}
