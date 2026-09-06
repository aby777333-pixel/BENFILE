/** Runs every engine over a canonical profile and returns the persisted Assessment. */
import type { Assessment, CanonicalProfile } from '@/lib/canonical/types';
import { buildDataQuality, overallFreshness } from './freshness';
import { buildCapacity, buildHealthIndicators, buildSummary } from './health';
import { runIdentityChecks } from './identity';
import { DEFAULT_RISK_CONFIG, maxSeverity, runRiskRules, type RiskRuleConfig } from './risk';
import { DEFAULT_SCORING_CONFIG, computeProfileScore, type ScoringConfig } from './scoring';

export const ENGINE_VERSION = 'engines-1.0.0';

export interface AssessOptions {
  scoring?: ScoringConfig;
  risk?: RiskRuleConfig;
  now?: Date;
}

export function assessProfile(p: CanonicalProfile, opts: AssessOptions = {}): Assessment {
  const now = opts.now ?? new Date();
  const identityChecks = runIdentityChecks(p);
  const dataQuality = buildDataQuality(p, now);
  const riskSignals = runRiskRules(p, identityChecks, dataQuality, opts.risk ?? DEFAULT_RISK_CONFIG, now);
  const score = computeProfileScore(p, identityChecks, riskSignals, dataQuality, opts.scoring ?? DEFAULT_SCORING_CONFIG, now);
  const health = buildHealthIndicators(p, identityChecks, riskSignals, dataQuality, now);
  const capacity = buildCapacity(p);

  const avail = dataQuality.filter((q) => q.available);
  const completeness = dataQuality.length ? Math.round((avail.reduce((s, q) => s + (q.completeness ?? 1), 0) / dataQuality.length) * 100) / 100 : 0;
  const freshness = overallFreshness(dataQuality);
  const mismatches = identityChecks.filter((c) => c.status === 'MISMATCH').length;
  const confidence: Assessment['overall']['confidence'] = completeness >= 0.75 && mismatches === 0 && ['FRESH', 'RECENT'].includes(freshness) ? 'HIGH' : completeness >= 0.5 && mismatches <= 1 && freshness !== 'STALE' ? 'MEDIUM' : 'LOW';
  const summary = buildSummary(p, identityChecks, riskSignals, dataQuality, confidence, now);

  const needsReview = [
    ...riskSignals.filter((s) => s.requiresReview).map((s) => s.title),
    ...identityChecks.filter((c) => c.status === 'MISMATCH').map((c) => c.label),
  ];
  const missing = [
    ...dataQuality.filter((q) => !q.available).map((q) => q.label),
    ...(p.person.income.value?.amount ? [] : ['Income']),
    ...(p.bankAccounts.length ? [] : ['Bank account']),
    ...(p.credit?.score ? [] : ['Credit score']),
    ...(p.employment.records.length ? [] : ['Employment history']),
  ];
  const riskLevel = maxSeverity(riskSignals);
  const profileStatus: Assessment['overall']['profileStatus'] =
    p.verification.status === 'PENDING' ? 'PENDING' : needsReview.length ? 'NEEDS_REVIEW' : p.verification.status === 'COMPLETED' ? 'VERIFIED' : 'PARTIAL';

  return {
    engineVersion: ENGINE_VERSION,
    computedAt: now.toISOString(),
    identityChecks,
    riskSignals,
    dataQuality,
    health,
    score,
    summary,
    capacity,
    overall: { profileStatus, riskLevel, completeness, freshness, confidence, needsReview: [...new Set(needsReview)], missing: [...new Set(missing)] },
  };
}
