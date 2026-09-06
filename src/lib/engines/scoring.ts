/**
 * Explainable, versioned profile score.
 * Every component carries its rationale and evidence. Missing components are
 * excluded and their weight redistributed; coverage is reported alongside.
 * The score is an analyst aid, never a prediction of financial behaviour.
 */
import type { CanonicalProfile, DataQualityRow, EvidenceRef, IdentityCheck, ProfileScore, RiskSignal, ScoreComponent } from '@/lib/canonical/types';
import { monthsBetween } from './normalize';

export interface ScoringConfig {
  version: string;
  weights: Record<'identity' | 'employment' | 'credit' | 'contact' | 'completeness' | 'risk', number>;
  notes?: string;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  version: 'score-1.0',
  weights: { identity: 0.25, employment: 0.2, credit: 0.2, contact: 0.1, completeness: 0.1, risk: 0.15 },
  notes: 'Initial weighting. Credit is capped at 20% so that the score never becomes a proxy credit score.',
};

export const SCORE_DISCLAIMER =
  'This score summarises verification coverage and consistency for analyst triage. It is not a credit score, not a prediction of financial behaviour, and must not be used as the sole basis for any decision.';

export function computeProfileScore(
  p: CanonicalProfile,
  checks: IdentityCheck[],
  signals: RiskSignal[],
  quality: DataQualityRow[],
  cfg: ScoringConfig = DEFAULT_SCORING_CONFIG,
  now = new Date(),
): ProfileScore {
  const comps: ScoreComponent[] = [];

  // Identity consistency
  const applicable = checks.filter((c) => c.status !== 'NOT_AVAILABLE');
  if (applicable.length) {
    const pts = applicable.reduce((s, c) => s + (c.status === 'MATCH' ? 1 : c.status === 'PARTIAL_MATCH' ? 0.7 : 0), 0);
    comps.push({
      key: 'identity',
      label: 'Identity consistency',
      weight: cfg.weights.identity,
      score: Math.round((pts / applicable.length) * 100),
      rationale: `${applicable.filter((c) => c.status === 'MATCH').length} match, ${applicable.filter((c) => c.status === 'PARTIAL_MATCH').length} partial, ${applicable.filter((c) => c.status === 'MISMATCH').length} mismatch across ${applicable.length} comparable checks.`,
      evidence: applicable.map<EvidenceRef>((c) => ({ label: c.label, sourceKey: c.leftSource, value: c.status })),
    });
  } else comps.push({ key: 'identity', label: 'Identity consistency', weight: cfg.weights.identity, score: null, rationale: 'No comparable identity records.', evidence: [] });

  // Employment stability
  const current = p.employment.records.find((r) => r.status === 'CURRENT');
  if (p.employment.records.length) {
    let s = 40;
    const ev: EvidenceRef[] = [];
    if (current) {
      const months = monthsBetween(current.joiningDate, null, now) ?? 0;
      s = 55 + Math.min(months, 60) * 0.5; // up to +30 for 5 years
      if (current.employer.confidence !== null) s += current.employer.confidence >= 0.9 ? 10 : current.employer.confidence >= 0.7 ? 5 : 0;
      if (p.employment.epfo?.pfFilingAvailable) s += 5;
      ev.push({ label: 'Current employer', sourceKey: 'UAN', path: current.provenance.evidencePath, value: current.employer.name });
      ev.push({ label: 'Tenure (months)', sourceKey: 'UAN', value: String(months) });
    } else {
      ev.push({ label: 'Latest record', sourceKey: 'UAN', path: p.employment.records[0].provenance.evidencePath, value: `${p.employment.records[0].employer.name} (exited)` });
    }
    comps.push({ key: 'employment', label: 'Employment stability', weight: cfg.weights.employment, score: Math.round(Math.min(100, s)), rationale: current ? 'Based on current EPFO employment tenure, employer-match confidence and PF filing availability.' : 'No current EPFO employment on record; partial credit for verified history.', evidence: ev });
  } else comps.push({ key: 'employment', label: 'Employment stability', weight: cfg.weights.employment, score: null, rationale: 'No employment records available.', evidence: [] });

  // Credit indicator
  if (p.credit?.score !== null && p.credit?.score !== undefined) {
    const sc = p.credit.score;
    const mapped = sc >= 800 ? 95 : sc >= 750 ? 85 : sc >= 700 ? 70 : sc >= 650 ? 50 : 30;
    comps.push({ key: 'credit', label: 'Credit indicator', weight: cfg.weights.credit, score: mapped, rationale: `Bureau score ${sc} (${p.credit.band.replace('_', ' ').toLowerCase()}) as of ${p.credit.scoreDate ?? 'unknown date'}. Mapped through fixed bands; not a credit decision.`, evidence: [{ label: 'Credit score', sourceKey: 'CREDIT', path: p.credit.provenance.evidencePath, value: String(sc) }] });
  } else comps.push({ key: 'credit', label: 'Credit indicator', weight: cfg.weights.credit, score: null, rationale: 'No bureau score available.', evidence: [] });

  // Contact verification
  if (p.mobile || p.contacts.phones.length) {
    let s = 50;
    const ev: EvidenceRef[] = [];
    if (p.mobile?.isValid === true) s += 25;
    if (p.mobile?.subscriberStatus === 'CONNECTED' || p.mobile?.subscriberStatus === 'ACTIVE') s += 15;
    if (p.mobile?.isValid === false) s -= 30;
    if (p.contacts.emails.length) s += 10;
    if (p.mobile) ev.push({ label: 'Mobile validity', sourceKey: 'MOBILE', path: p.mobile.provenance.evidencePath, value: p.mobile.isValid === null ? 'unknown' : String(p.mobile.isValid) });
    comps.push({ key: 'contact', label: 'Contact verification', weight: cfg.weights.contact, score: Math.max(0, Math.min(100, s)), rationale: 'Mobile validity, subscriber status and presence of e-mail addresses.', evidence: ev });
  } else comps.push({ key: 'contact', label: 'Contact verification', weight: cfg.weights.contact, score: null, rationale: 'No contact data.', evidence: [] });

  // Data completeness
  const avail = quality.filter((q) => q.available);
  const compScore = quality.length ? Math.round((avail.reduce((s, q) => s + (q.completeness ?? 1), 0) / quality.length) * 100) : null;
  comps.push({ key: 'completeness', label: 'Data completeness', weight: cfg.weights.completeness, score: compScore, rationale: `${avail.length} of ${quality.length} expected sources returned data.`, evidence: quality.map((q) => ({ label: q.label, sourceKey: q.sourceKey, value: q.available ? `${Math.round((q.completeness ?? 1) * 100)}% complete` : 'not available' })) });

  // Risk signals (inverse)
  const live = signals.filter((s) => !['DISMISSED', 'RESOLVED'].includes(s.status));
  const penalty = live.reduce((s, x) => s + ({ INFO: 0, LOW: 5, MEDIUM: 15, HIGH: 30, CRITICAL: 50 }[x.severity] ?? 0), 0);
  comps.push({ key: 'risk', label: 'Risk signals', weight: cfg.weights.risk, score: Math.max(0, 100 - penalty), rationale: `${live.length} open signal(s); penalty ${penalty} points (LOW 5, MEDIUM 15, HIGH 30, CRITICAL 50).`, evidence: live.map((s) => ({ label: s.title, sourceKey: s.sourceKey, value: s.severity })) });

  const withData = comps.filter((c) => c.score !== null);
  const coverage = withData.reduce((s, c) => s + c.weight, 0);
  const total = coverage > 0 ? Math.round(withData.reduce((s, c) => s + (c.score as number) * c.weight, 0) / coverage) : null;
  return { configVersion: cfg.version, total, coverage: Math.round(coverage * 100) / 100, components: comps, computedAt: now.toISOString(), disclaimer: SCORE_DISCLAIMER };
}
