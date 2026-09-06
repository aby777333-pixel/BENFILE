import type { CanonicalProfile, DataQualityRow, FreshnessLabel } from '@/lib/canonical/types';
import { daysBetween } from './normalize';

export const FRESHNESS_THRESHOLDS = { FRESH: 30, RECENT: 90, AGING: 180 } as const;

export function freshnessLabel(ageDays: number | null): FreshnessLabel {
  if (ageDays === null) return 'UNKNOWN';
  if (ageDays <= FRESHNESS_THRESHOLDS.FRESH) return 'FRESH';
  if (ageDays <= FRESHNESS_THRESHOLDS.RECENT) return 'RECENT';
  if (ageDays <= FRESHNESS_THRESHOLDS.AGING) return 'AGING';
  return 'STALE';
}

export function buildDataQuality(p: CanonicalProfile, now = new Date()): DataQualityRow[] {
  return p.sources.map((s) => {
    const ref = s.lastUpdatedAt ?? s.retrievedAt;
    const ageDays = s.available ? daysBetween(ref, now) : null;
    return {
      sourceKey: s.key,
      label: s.label,
      tier: s.tier,
      available: s.available,
      verificationStatus: s.verificationStatus,
      retrievedAt: s.retrievedAt,
      lastUpdatedAt: s.lastUpdatedAt,
      ageDays,
      freshness: s.available ? freshnessLabel(ageDays) : 'UNKNOWN',
      confidence: s.confidence,
      completeness: s.completeness,
    };
  });
}

/** Worst freshness among available sources (a profile is only as fresh as its oldest critical source). */
export function overallFreshness(rows: DataQualityRow[]): FreshnessLabel {
  const order: FreshnessLabel[] = ['FRESH', 'RECENT', 'AGING', 'STALE'];
  const avail = rows.filter((r) => r.available && r.freshness !== 'UNKNOWN');
  if (!avail.length) return 'UNKNOWN';
  return avail.reduce<FreshnessLabel>((worst, r) => (order.indexOf(r.freshness) > order.indexOf(worst) ? r.freshness : worst), 'FRESH');
}
