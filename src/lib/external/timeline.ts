/** Compares a public career timeline with verified EPFO employment. Mismatch => inconsistency requiring review, never an accusation. */
import type { CanonicalProfile } from '@/lib/canonical/types';
import { compareNames } from '@/lib/engines/normalize';

export interface TimelineEntry {
  from: string; // YYYY-MM
  to: string | null;
  organisation: string;
  title?: string | null;
}

export interface TimelineComparison {
  status: 'CONSISTENT' | 'MINOR_DIFFERENCES' | 'INCONSISTENCY_REQUIRING_REVIEW' | 'NOT_COMPARABLE';
  rows: Array<{ organisation: string; publicPeriod: string; verifiedPeriod: string | null; verdict: 'MATCH' | 'DATE_DIFFERENCE' | 'NOT_IN_VERIFIED' | 'NOT_IN_PUBLIC' }>;
  explanation: string;
}

const ym = (s: string | null | undefined) => (s ? s.slice(0, 7) : null);
const monthsDiff = (a: string | null, b: string | null) => {
  if (!a || !b) return 0;
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return Math.abs((ay - by) * 12 + (am - bm));
};

export function compareTimeline(publicTimeline: TimelineEntry[], profile: CanonicalProfile): TimelineComparison {
  const verified = profile.employment.records.map((r) => ({ org: r.employer.name, from: ym(r.joiningDate), to: ym(r.exitDate), status: r.status }));
  if (!publicTimeline.length || !verified.length) return { status: 'NOT_COMPARABLE', rows: [], explanation: 'Either the public timeline or the verified employment record is empty.' };
  const rows: TimelineComparison['rows'] = [];
  const matchedVerified = new Set<number>();
  for (const p of publicTimeline) {
    const idx = verified.findIndex((v, i) => !matchedVerified.has(i) && compareNames(v.org, p.organisation).status !== 'MISMATCH');
    if (idx === -1) {
      rows.push({ organisation: p.organisation, publicPeriod: `${p.from} - ${p.to ?? 'present'}`, verifiedPeriod: null, verdict: 'NOT_IN_VERIFIED' });
      continue;
    }
    matchedVerified.add(idx);
    const v = verified[idx];
    const drift = Math.max(monthsDiff(p.from, v.from), p.to && v.to ? monthsDiff(p.to, v.to) : 0);
    rows.push({ organisation: p.organisation, publicPeriod: `${p.from} - ${p.to ?? 'present'}`, verifiedPeriod: `${v.from ?? '?'} - ${v.to ?? 'present'}`, verdict: drift <= 3 ? 'MATCH' : 'DATE_DIFFERENCE' });
  }
  verified.forEach((v, i) => {
    if (!matchedVerified.has(i)) rows.push({ organisation: v.org, publicPeriod: '-', verifiedPeriod: `${v.from ?? '?'} - ${v.to ?? 'present'}`, verdict: 'NOT_IN_PUBLIC' });
  });
  const hard = rows.filter((r) => r.verdict === 'NOT_IN_VERIFIED').length;
  const soft = rows.filter((r) => r.verdict === 'DATE_DIFFERENCE' || r.verdict === 'NOT_IN_PUBLIC').length;
  const status: TimelineComparison['status'] = hard ? 'INCONSISTENCY_REQUIRING_REVIEW' : soft ? 'MINOR_DIFFERENCES' : 'CONSISTENT';
  return {
    status,
    rows,
    explanation:
      status === 'CONSISTENT'
        ? 'Public career timeline agrees with verified EPFO employment within 3 months.'
        : status === 'MINOR_DIFFERENCES'
          ? 'Small date differences or employers missing from the public profile. Public profiles are self-described; EPFO is authoritative.'
          : 'The public profile lists an employer that does not appear in the verified EPFO history. This is an inconsistency requiring review, not evidence of misrepresentation (non-EPFO employers, contracting or self-employment are common explanations).',
  };
}
