/**
 * Configurable risk rules engine.
 * Provider signals are surfaced verbatim; internal rules add their own signals.
 * Contradictory combinations produce NEEDS_REVIEW instead of an invented interpretation.
 */
import { createHash } from 'node:crypto';
import type { CanonicalProfile, DataQualityRow, EvidenceRef, IdentityCheck, RiskSignal, Severity } from '@/lib/canonical/types';
import { maskByKind } from '@/lib/security/masking';

export interface RiskRuleConfig {
  version: string;
  staleDays: number;
  lowEmployerConfidence: number;
  shortTenureMonths: number;
  poorCreditBelow: number;
  fairCreditBelow: number;
}

export const DEFAULT_RISK_CONFIG: RiskRuleConfig = {
  version: 'risk-rules-1.0',
  staleDays: 180,
  lowEmployerConfidence: 0.7,
  shortTenureMonths: 6,
  poorCreditBelow: 650,
  fairCreditBelow: 700,
};

const fp = (...parts: Array<string | null | undefined>) => createHash('sha256').update(parts.map((x) => x ?? '').join('|')).digest('hex').slice(0, 24);

function providerSeverity(level: string): Severity {
  return level === 'UNKNOWN' ? 'INFO' : (level as Severity);
}

export function runRiskRules(p: CanonicalProfile, checks: IdentityCheck[], quality: DataQualityRow[], cfg: RiskRuleConfig = DEFAULT_RISK_CONFIG, now = new Date()): RiskSignal[] {
  const out: RiskSignal[] = [];
  const nowIso = now.toISOString();
  const push = (s: Omit<RiskSignal, 'fingerprint' | 'status'> & { status?: RiskSignal['status'] }) =>
    out.push({ ...s, fingerprint: fp(s.ruleKey, s.sourceKey, s.title), status: s.status ?? (s.requiresReview ? 'NEEDS_REVIEW' : 'OPEN') });

  /* ---- Provider-declared signals, verbatim ---- */
  for (const r of p.providerRisk) {
    const contradictory = (r.isSafe === false && ['LOW', 'INFO'].includes(r.riskLevel)) || (r.isSafe === true && ['HIGH', 'CRITICAL'].includes(r.riskLevel));
    const evidence: EvidenceRef[] = [
      { label: 'Provider safe flag', sourceKey: r.provenance.sourceKey, path: r.provenance.evidencePath, value: r.isSafe === null ? 'Not returned' : r.isSafe ? 'Yes' : 'No' },
      { label: 'Provider risk level', sourceKey: r.provenance.sourceKey, path: r.provenance.evidencePath, value: r.riskLevel },
      { label: 'Reason', sourceKey: r.provenance.sourceKey, path: r.provenance.evidencePath, value: r.reason },
    ];
    push({
      ruleKey: 'provider.risk_signal',
      category: /sim|number|mobile|telecom|phone/i.test(`${r.reason} ${r.description}`) ? 'MOBILE' : 'EXTERNAL',
      severity: providerSeverity(r.riskLevel),
      origin: 'PROVIDER',
      sourceKey: r.provenance.sourceKey,
      title: r.reason ?? 'Provider risk indicator',
      explanation: `Provider safe flag: ${r.isSafe === null ? 'not returned' : r.isSafe ? 'Yes' : 'No'}. Provider risk level: ${r.riskLevel}. ${r.description ?? ''}`.trim(),
      evidence,
      detectedAt: r.detectedAt,
      updatedAt: r.updatedAt,
      requiresReview: contradictory || ['MEDIUM', 'HIGH', 'CRITICAL'].includes(r.riskLevel),
    });
    if (contradictory) {
      push({
        ruleKey: 'consistency.provider_flag_vs_level',
        category: 'DATA_CONSISTENCY',
        severity: 'LOW',
        origin: 'RULES_ENGINE',
        sourceKey: r.provenance.sourceKey,
        title: 'Provider safe flag and risk level disagree',
        explanation: `The provider returned is_safe=${String(r.isSafe)} together with risk_level=${r.riskLevel}. These are not equivalent measures; BENFILE does not convert one into the other. A human should decide whether "${r.reason ?? 'the stated reason'}" is material for this engagement.`,
        evidence,
        detectedAt: r.detectedAt,
        updatedAt: r.updatedAt,
        requiresReview: true,
      });
    }
  }

  /* ---- Identity ---- */
  for (const c of checks) {
    if (c.status === 'MISMATCH') {
      const hard = c.key.startsWith('pan.') || c.key === 'dob.vs_age';
      push({
        ruleKey: `identity.${c.key}`,
        category: c.key.startsWith('address') ? 'ADDRESS' : c.key.startsWith('phone') || c.key.startsWith('email') ? 'CONTACT' : 'IDENTITY',
        severity: hard ? 'HIGH' : 'MEDIUM',
        origin: 'RULES_ENGINE',
        sourceKey: c.leftSource,
        title: `${c.label}: mismatch`,
        explanation: `${c.explanation} A mismatch is an inconsistency requiring review, not a finding of fraud.`,
        evidence: [
          { label: c.leftSource, sourceKey: c.leftSource, value: c.leftValue },
          { label: c.rightSource, sourceKey: c.rightSource, value: c.rightValue },
        ],
        detectedAt: nowIso,
        updatedAt: nowIso,
        requiresReview: true,
      });
    } else if (c.status === 'PARTIAL_MATCH' && c.key.startsWith('name.')) {
      push({
        ruleKey: `identity.${c.key}`,
        category: 'IDENTITY',
        severity: 'INFO',
        origin: 'RULES_ENGINE',
        sourceKey: c.leftSource,
        title: `${c.label}: partial match`,
        explanation: `${c.explanation} Formatting differences of this kind are common and are recorded for completeness only.`,
        evidence: [
          { label: c.leftSource, sourceKey: c.leftSource, value: c.leftValue },
          { label: c.rightSource, sourceKey: c.rightSource, value: c.rightValue },
        ],
        detectedAt: nowIso,
        updatedAt: nowIso,
        requiresReview: false,
      });
    }
  }
  const pan = p.identityDocuments.find((d) => d.docType === 'PAN');
  if (pan && pan.aadhaarLinked === false) {
    push({
      ruleKey: 'identity.pan_not_aadhaar_linked',
      category: 'IDENTITY',
      severity: 'MEDIUM',
      origin: 'RULES_ENGINE',
      sourceKey: 'PAN',
      title: 'PAN not linked to Aadhaar',
      explanation: 'The provider reports the PAN is not Aadhaar-linked. Unlinked PANs may be inoperative for certain transactions; confirm with the client.',
      evidence: [{ label: 'PAN aadhaar_linked', sourceKey: 'PAN', path: pan.provenance.evidencePath, value: 'false' }],
      detectedAt: nowIso,
      updatedAt: nowIso,
      requiresReview: true,
    });
  }
  if (pan?.status && !['VALID', 'ACTIVE'].includes(pan.status)) {
    push({
      ruleKey: 'identity.pan_status',
      category: 'IDENTITY',
      severity: 'HIGH',
      origin: 'RULES_ENGINE',
      sourceKey: 'PAN',
      title: `PAN status is ${pan.status}`,
      explanation: 'PAN is not reported as valid/active by the provider.',
      evidence: [{ label: 'PAN status', sourceKey: 'PAN', path: pan.provenance.evidencePath, value: pan.status }],
      detectedAt: nowIso,
      updatedAt: nowIso,
      requiresReview: true,
    });
  }

  /* ---- Employment ---- */
  const current = p.employment.records.find((r) => r.status === 'CURRENT');
  const latest = p.employment.records[0];
  if (p.employment.records.length && !current) {
    push({
      ruleKey: 'employment.no_current',
      category: 'EMPLOYMENT',
      severity: 'MEDIUM',
      origin: 'RULES_ENGINE',
      sourceKey: 'UAN',
      title: 'No current employment on EPFO record',
      explanation: `Most recent EPFO record shows an exit${latest?.exitDate ? ` on ${latest.exitDate}` : ''}. The client may be self-employed, between roles, or with a non-EPFO employer. Missing information is not negative information; request confirmation.`,
      evidence: [{ label: 'Latest employer', sourceKey: 'UAN', path: latest?.provenance.evidencePath, value: latest?.employer.name }],
      detectedAt: nowIso,
      updatedAt: nowIso,
      requiresReview: true,
    });
  }
  for (const r of p.employment.records) {
    if (r.employer.confidence !== null && r.employer.confidence < cfg.lowEmployerConfidence) {
      push({
        ruleKey: 'employment.low_employer_confidence',
        category: 'EMPLOYMENT',
        severity: 'LOW',
        origin: 'RULES_ENGINE',
        sourceKey: 'UAN',
        title: `Low employer-match confidence (${Math.round(r.employer.confidence * 100)}%) for ${r.employer.name}`,
        explanation: `Provider confidence for matching the establishment is below ${Math.round(cfg.lowEmployerConfidence * 100)}%.`,
        evidence: [{ label: 'Employer confidence', sourceKey: 'UAN', path: r.provenance.evidencePath, value: String(r.employer.confidence) }],
        detectedAt: nowIso,
        updatedAt: nowIso,
        requiresReview: false,
      });
    }
    if (r.employerNameMatch === false) {
      push({
        ruleKey: 'employment.employer_name_mismatch',
        category: 'EMPLOYMENT',
        severity: 'MEDIUM',
        origin: 'RULES_ENGINE',
        sourceKey: 'UAN',
        title: `Employer name mismatch for ${r.employer.name}`,
        explanation: 'The provider reports that the employer name did not match the establishment record.',
        evidence: [{ label: 'employer_name_match', sourceKey: 'UAN', path: r.provenance.evidencePath, value: 'false' }],
        detectedAt: nowIso,
        updatedAt: nowIso,
        requiresReview: true,
      });
    }
  }
  if (p.employment.epfo && p.employment.epfo.aadhaarLinked === false) {
    push({
      ruleKey: 'employment.uan_not_aadhaar_linked',
      category: 'EMPLOYMENT',
      severity: 'LOW',
      origin: 'RULES_ENGINE',
      sourceKey: 'UAN',
      title: 'UAN not Aadhaar-seeded',
      explanation: 'The provider reports the UAN is not linked to Aadhaar.',
      evidence: [{ label: 'aadhaar_linked', sourceKey: 'UAN', path: p.employment.epfo.provenance.evidencePath, value: 'false' }],
      detectedAt: nowIso,
      updatedAt: nowIso,
      requiresReview: false,
    });
  }

  /* ---- Credit ---- */
  if (p.credit?.score !== null && p.credit?.score !== undefined) {
    if (p.credit.score < cfg.poorCreditBelow) {
      push({
        ruleKey: 'credit.low_score',
        category: 'CREDIT',
        severity: 'HIGH',
        origin: 'RULES_ENGINE',
        sourceKey: 'CREDIT',
        title: `Credit score ${p.credit.score} is below ${cfg.poorCreditBelow}`,
        explanation: 'Bureau score is in the lower band. Review repayment history when available.',
        evidence: [{ label: 'Credit score', sourceKey: 'CREDIT', path: p.credit.provenance.evidencePath, value: String(p.credit.score) }],
        detectedAt: p.credit.scoreDate,
        updatedAt: nowIso,
        requiresReview: true,
      });
    } else if (p.credit.score < cfg.fairCreditBelow) {
      push({
        ruleKey: 'credit.fair_score',
        category: 'CREDIT',
        severity: 'LOW',
        origin: 'RULES_ENGINE',
        sourceKey: 'CREDIT',
        title: `Credit score ${p.credit.score} is in the fair band`,
        explanation: 'Bureau score is acceptable but below the good threshold.',
        evidence: [{ label: 'Credit score', sourceKey: 'CREDIT', path: p.credit.provenance.evidencePath, value: String(p.credit.score) }],
        detectedAt: p.credit.scoreDate,
        updatedAt: nowIso,
        requiresReview: false,
      });
    }
  }

  /* ---- Mobile ---- */
  if (p.mobile) {
    if (p.mobile.isValid === false || (p.mobile.subscriberStatus && !['CONNECTED', 'ACTIVE'].includes(p.mobile.subscriberStatus))) {
      push({
        ruleKey: 'mobile.not_active',
        category: 'MOBILE',
        severity: 'MEDIUM',
        origin: 'RULES_ENGINE',
        sourceKey: 'MOBILE',
        title: `Primary mobile is ${p.mobile.subscriberStatus ?? 'not valid'}`,
        explanation: 'The verified mobile number is not reported as connected. Contactability is reduced; confirm an alternate number.',
        evidence: [
          { label: 'Number', sourceKey: 'MOBILE', path: p.mobile.provenance.evidencePath, value: maskByKind('PHONE', p.mobile.number) },
          { label: 'Subscriber status', sourceKey: 'MOBILE', value: p.mobile.subscriberStatus },
        ],
        detectedAt: nowIso,
        updatedAt: nowIso,
        requiresReview: true,
      });
    }
    if (p.mobile.isPorted === true) {
      push({
        ruleKey: 'mobile.ported',
        category: 'MOBILE',
        severity: 'INFO',
        origin: 'RULES_ENGINE',
        sourceKey: 'MOBILE',
        title: `Number ported from ${p.mobile.originalProvider ?? 'another operator'} to ${p.mobile.serviceProvider ?? 'current operator'}`,
        explanation: 'Mobile number portability is routine and carries no risk on its own.',
        evidence: [{ label: 'is_ported', sourceKey: 'MOBILE', path: p.mobile.provenance.evidencePath, value: 'true' }],
        detectedAt: nowIso,
        updatedAt: nowIso,
        requiresReview: false,
      });
    }
  }

  /* ---- Banking ---- */
  if (!p.bankAccounts.length) {
    push({
      ruleKey: 'banking.not_available',
      category: 'BANKING',
      severity: 'INFO',
      origin: 'RULES_ENGINE',
      sourceKey: 'BANK',
      title: 'No bank account information returned',
      explanation: 'Absence of bank data is not a negative indicator; request account details if the workflow requires them.',
      evidence: [],
      detectedAt: nowIso,
      updatedAt: nowIso,
      requiresReview: false,
    });
  }

  /* ---- Freshness ---- */
  for (const q of quality) {
    if (q.available && q.ageDays !== null && q.ageDays > cfg.staleDays) {
      push({
        ruleKey: 'freshness.stale_source',
        category: 'DATA_FRESHNESS',
        severity: q.ageDays > cfg.staleDays * 2 ? 'MEDIUM' : 'LOW',
        origin: 'RULES_ENGINE',
        sourceKey: q.sourceKey,
        title: `${q.label} is ${q.ageDays} days old`,
        explanation: `Source data older than ${cfg.staleDays} days. Consider re-verification before relying on it.`,
        evidence: [{ label: 'Last updated', sourceKey: q.sourceKey, value: q.lastUpdatedAt ?? q.retrievedAt }],
        detectedAt: nowIso,
        updatedAt: nowIso,
        requiresReview: false,
      });
    }
  }

  /* ---- Verification status ---- */
  if (p.verification.status !== 'COMPLETED') {
    push({
      ruleKey: 'verification.incomplete',
      category: 'DATA_CONSISTENCY',
      severity: p.verification.status === 'FAILED' ? 'HIGH' : 'LOW',
      origin: 'RULES_ENGINE',
      sourceKey: 'PROVIDER',
      title: `Verification status: ${p.verification.status}`,
      explanation: 'The provider run did not complete fully; some domains may be missing.',
      evidence: [{ label: 'status', sourceKey: 'PROVIDER', path: '/status', value: p.verification.status }],
      detectedAt: p.verification.updatedAt,
      updatedAt: nowIso,
      requiresReview: p.verification.status === 'FAILED',
    });
  }

  return out;
}

const SEV_ORDER: Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export function maxSeverity(signals: Array<{ severity: Severity; status?: string }>): Severity | 'NONE' {
  const live = signals.filter((s) => !s.status || !['DISMISSED', 'RESOLVED'].includes(s.status));
  if (!live.length) return 'NONE';
  return live.reduce<Severity>((m, s) => (SEV_ORDER.indexOf(s.severity) > SEV_ORDER.indexOf(m) ? s.severity : m), 'INFO');
}
