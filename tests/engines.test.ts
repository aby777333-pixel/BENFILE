import { describe, expect, it } from 'vitest';
import sample from '../fixtures/india-composite-sample.json';
import sparse from '../fixtures/sparse-sample.json';
import { indiaKycCompositeAdapter } from '@/lib/providers/india-kyc-composite';
import { assessProfile } from '@/lib/engines/assess';
import { compareNames, normalizeAddress, normalizeCity } from '@/lib/engines/normalize';
import { freshnessLabel } from '@/lib/engines/freshness';
import { resolveEntity } from '@/lib/engines/entity-resolution';
import { classifyMedia } from '@/lib/engines/media';
import { computeProfileScore } from '@/lib/engines/scoring';

const NOW = new Date('2026-09-06T00:00:00Z');
const full = indiaKycCompositeAdapter.normalize(sample).profile;
const thin = indiaKycCompositeAdapter.normalize(sparse).profile;

describe('name normalisation', () => {
  it('ignores case, whitespace and punctuation', () => {
    expect(compareNames('  rohan   kumar mehta ', 'ROHAN KUMAR MEHTA').status).toBe('MATCH');
    expect(compareNames('Mr. Rohan K. Mehta', 'ROHAN KUMAR MEHTA').status).toBe('PARTIAL_MATCH');
    expect(compareNames('Rohan Mehta', 'Priya Nair').status).toBe('MISMATCH');
    expect(compareNames(null, 'X').status).toBe('NOT_AVAILABLE');
  });
  it('normalises city aliases and address noise', () => {
    expect(normalizeCity('Bangalore')).toBe('BENGALURU');
    expect(normalizeAddress('#12, 3rd Cross, Whitefield')).toBe('12 3RD WHITEFIELD');
  });
});

describe('identity consistency engine', () => {
  const a = assessProfile(full, { now: NOW });
  it('matches profile name to PAN and reports EPFO initial as partial', () => {
    expect(a.identityChecks.find((c) => c.key === 'name.person_vs_pan')?.status).toBe('MATCH');
    expect(a.identityChecks.find((c) => c.key === 'name.pan_vs_epfo')?.status).toBe('PARTIAL_MATCH');
    expect(a.identityChecks.find((c) => c.key === 'pan.document_vs_credit')?.status).toBe('MATCH');
  });
  it('masks sensitive values in checks', () => {
    const c = a.identityChecks.find((c) => c.key === 'pan.document_vs_credit')!;
    expect(c.leftValue).toBe('ABCP*****D');
    expect(c.leftValue).not.toContain('1234');
  });
  it('treats Bangalore/Bengaluru with different PINs as partial, not mismatch', () => {
    expect(a.identityChecks.find((c) => c.key === 'address.cross_source')?.status).toBe('PARTIAL_MATCH');
  });
  it('reports NOT_AVAILABLE rather than failing on sparse data', () => {
    const b = assessProfile(thin, { now: NOW });
    expect(b.identityChecks.find((c) => c.key === 'name.person_vs_bank')?.status).toBe('NOT_AVAILABLE');
    expect(b.identityChecks.find((c) => c.key === 'pan.document_vs_credit')?.status).toBe('NOT_AVAILABLE');
    expect(b.identityChecks.find((c) => c.key === 'address.cross_source')?.status).toBe('MISMATCH');
  });
});

describe('risk rules engine', () => {
  const a = assessProfile(full, { now: NOW });
  it('surfaces the provider signal verbatim and flags the is_safe/risk_level contradiction as NEEDS_REVIEW', () => {
    const prov = a.riskSignals.find((s) => s.ruleKey === 'provider.risk_signal')!;
    expect(prov.severity).toBe('LOW'); // NOT escalated to HIGH because is_safe=false
    expect(prov.origin).toBe('PROVIDER');
    expect(prov.evidence.map((e) => e.value)).toContain('No');
    const contra = a.riskSignals.find((s) => s.ruleKey === 'consistency.provider_flag_vs_level')!;
    expect(contra).toBeDefined();
    expect(contra.status).toBe('NEEDS_REVIEW');
    expect(contra.requiresReview).toBe(true);
  });
  it('does not treat missing bank data as negative', () => {
    const b = assessProfile(thin, { now: NOW });
    const bank = b.riskSignals.find((s) => s.ruleKey === 'banking.not_available')!;
    expect(bank.severity).toBe('INFO');
  });
  it('detects stale sources and inactive mobile on the sparse profile', () => {
    const b = assessProfile(thin, { now: NOW });
    expect(b.riskSignals.some((s) => s.ruleKey === 'freshness.stale_source')).toBe(true);
    expect(b.riskSignals.some((s) => s.ruleKey === 'mobile.not_active')).toBe(true);
    expect(b.riskSignals.some((s) => s.ruleKey === 'employment.no_current')).toBe(true);
    expect(b.overall.freshness).toBe('STALE');
    expect(b.overall.profileStatus).toBe('NEEDS_REVIEW');
  });
  it('fingerprints are stable across runs', () => {
    const b = assessProfile(full, { now: NOW });
    expect(a.riskSignals.map((s) => s.fingerprint)).toEqual(b.riskSignals.map((s) => s.fingerprint));
  });
});

describe('freshness', () => {
  it('bands by age', () => {
    expect(freshnessLabel(10)).toBe('FRESH');
    expect(freshnessLabel(60)).toBe('RECENT');
    expect(freshnessLabel(150)).toBe('AGING');
    expect(freshnessLabel(400)).toBe('STALE');
    expect(freshnessLabel(null)).toBe('UNKNOWN');
  });
});

describe('explainable scoring', () => {
  const a = assessProfile(full, { now: NOW });
  it('produces components whose weights sum to 1 with rationale and evidence', () => {
    expect(a.score.components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 5);
    for (const c of a.score.components) expect(c.rationale.length).toBeGreaterThan(5);
    expect(a.score.total).toBeGreaterThan(60);
    expect(a.score.disclaimer).toMatch(/not a credit score/i);
  });
  it('excludes missing components and reports coverage', () => {
    const b = assessProfile(thin, { now: NOW });
    expect(b.score.components.find((c) => c.key === 'credit')?.score).toBeNull();
    expect(b.score.coverage).toBeLessThan(1);
    expect(b.score.total).not.toBeNull();
  });
  it('respects a custom versioned weighting', () => {
    const s = computeProfileScore(full, a.identityChecks, a.riskSignals, a.dataQuality, { version: 'test-2', weights: { identity: 0.5, employment: 0.1, credit: 0.1, contact: 0.1, completeness: 0.1, risk: 0.1 } }, NOW);
    expect(s.configVersion).toBe('test-2');
    expect(s.components[0].weight).toBe(0.5);
  });
});

describe('financial capacity + health', () => {
  it('never fabricates capacity', () => {
    const a = assessProfile(full, { now: NOW });
    expect(a.capacity.status).not.toBe('AVAILABLE');
    expect(a.capacity.statement).toMatch(/Insufficient verified information/);
    expect(a.health.find((h) => h.key === 'income')?.display).toContain('10,00,000');
    expect(a.health.find((h) => h.key === 'tenure')?.assertion).toBe('DERIVED');
  });
  it('summary lines each carry an assertion kind and evidence', () => {
    const a = assessProfile(full, { now: NOW });
    expect(a.summary.find((s) => s.key === 'pan_aadhaar')?.value).toBe('Linked');
    expect(a.summary.find((s) => s.key === 'employer')?.value).toBe('ABC Technologies Pvt Ltd');
    for (const s of a.summary) expect(['VERIFIED_FACT', 'CLIENT_DECLARED', 'DERIVED', 'ANALYST_ASSESSMENT']).toContain(s.assertion);
  });
});

describe('entity resolution', () => {
  const subject = { fullName: 'Rohan Kumar Mehta', employers: ['ABC Technologies Pvt Ltd'], occupation: 'Software Engineer', cities: ['Bengaluru'], emails: ['rohan.mehta@example.com'], phones: ['9876543210'], dob: '1991-03-14' };
  it('does not confirm on name alone', () => {
    const r = resolveEntity(subject, { name: 'Rohan Kumar Mehta' });
    expect(r.status).not.toBe('CONFIRMED');
    expect(r.status).not.toBe('HIGH_CONFIDENCE');
  });
  it('reaches high confidence with corroborating attributes and explains why', () => {
    const r = resolveEntity(subject, { name: 'Rohan Mehta', employer: 'ABC Technologies', city: 'Bangalore', email: 'rohan.mehta@example.com' });
    expect(r.status).toBe('HIGH_CONFIDENCE');
    expect(r.reasons).toContain('Employer exact match');
    expect(r.reasons).toContain('City match');
  });
  it('confirms only with an exact official identifier', () => {
    const r = resolveEntity({ ...subject, din: '08123456' }, { name: 'Rohan K Mehta', din: '08123456' });
    expect(r.status).toBe('CONFIRMED');
  });
  it('rejects a different date of birth', () => {
    const r = resolveEntity(subject, { name: 'Rohan Kumar Mehta', dob: '1975-01-01' });
    expect(['LOW_CONFIDENCE', 'NOT_A_MATCH']).toContain(r.status);
  });
});

describe('adverse media classification', () => {
  it('flags allegations as potential adverse requiring human review', () => {
    const c = classifyMedia('Startup founder accused of fraud by former partner', 6);
    expect(c.category).toBe('POTENTIAL_ADVERSE');
    expect(c.humanReviewRequired).toBe(true);
    expect(c.label).toMatch(/Human review required/);
  });
  it('classifies neutral business news without alarm', () => {
    const c = classifyMedia('ABC Technologies expands Bengaluru campus, adds 400 jobs', 4);
    expect(c.category).toBe('BUSINESS');
    expect(c.severity).toBe('INFO');
  });
});
