import { describe, expect, it } from 'vitest';
import sample from '../fixtures/india-composite-sample.json';
import sparse from '../fixtures/sparse-sample.json';
import { indiaKycCompositeAdapter } from '@/lib/providers/india-kyc-composite';
import { detectAdapter } from '@/lib/providers/registry';
import { validateCanonical } from '@/lib/canonical/schema';

describe('india-kyc-composite adapter', () => {
  it('is auto-detected from the payload shape', () => {
    expect(detectAdapter(sample)?.key).toBe('india-kyc-composite');
    expect(detectAdapter({ foo: 1 })).toBeUndefined();
  });

  it('normalises the full sample into a valid canonical profile', () => {
    const { profile, warnings } = indiaKycCompositeAdapter.normalize(sample);
    const v = validateCanonical(profile);
    expect(v.success, JSON.stringify(v.success ? null : v.error.issues, null, 2)).toBe(true);
    expect(warnings).toEqual([]);
    expect(profile.verification.verificationId).toBe('VER-2026-08-14-8F3A21');
    expect(profile.verification.status).toBe('COMPLETED');
    expect(profile.person.fullName.value).toBe('Rohan Kumar Mehta');
    expect(profile.person.income.value?.amount).toBe(1000000);
    expect(profile.person.income.provenance.assertion).toBe('VERIFIED_FACT');
    expect(profile.contacts.phones).toHaveLength(3);
    expect(profile.contacts.phones[1].provenance.sourceKey).toBe('UAN');
    expect(profile.identityDocuments.map((d) => d.docType)).toEqual(['PAN', 'AADHAAR', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENCE']);
    expect(profile.identityDocuments[1].number).toBeNull();
    expect(profile.identityDocuments[1].maskedNumber).toBe('XXXXXXXX8848');
    expect(profile.employment.records).toHaveLength(2);
    expect(profile.employment.records[0].status).toBe('CURRENT');
    expect(profile.employment.records[0].employer.pfFilings).toHaveLength(7);
    expect(profile.credit?.band).toBe('EXCELLENT');
    expect(profile.providerRisk[0]).toMatchObject({ isSafe: false, riskLevel: 'LOW', reason: 'Inactive SIM' });
    expect(profile.sources.find((s) => s.key === 'CREDIT')?.available).toBe(true);
  });

  it('preserves evidence paths into the raw payload', () => {
    const { profile } = indiaKycCompositeAdapter.normalize(sample);
    expect(profile.person.fullName.provenance.evidencePath).toBe('/data/personal/full_name');
    expect(profile.employment.records[0].provenance.evidencePath).toBe('/data/employment/history/0');
    expect(profile.providerRisk[0].provenance.evidencePath).toBe('/data/risk/0');
  });

  it('handles nulls, missing fields and whitespace without inventing values', () => {
    const { profile, warnings } = indiaKycCompositeAdapter.normalize(sparse);
    expect(validateCanonical(profile).success).toBe(true);
    expect(profile.person.fullName.value).toBe('priya S. NAIR');
    expect(profile.person.gender.value).toBeNull();
    expect(profile.person.occupation.value).toBeNull();
    expect(profile.person.income.value).toBeNull();
    // Age derived from DOB and labelled DERIVED
    expect(profile.person.age.value).toBeGreaterThan(30);
    expect(profile.person.age.provenance.assertion).toBe('DERIVED');
    expect(warnings.some((w) => /derived/i.test(w))).toBe(true);
    expect(profile.credit).toBeNull();
    expect(profile.bankAccounts).toEqual([]);
    expect(profile.identityDocuments).toHaveLength(1);
    expect(profile.sources.find((s) => s.key === 'CREDIT')?.available).toBe(false);
    expect(profile.verification.status).toBe('PARTIAL');
  });

  it('rejects non-object payloads', () => {
    expect(() => indiaKycCompositeAdapter.normalize('nope')).toThrow();
  });
});
