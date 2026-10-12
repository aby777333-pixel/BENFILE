import { describe, expect, it } from 'vitest';
import { allowedSources, clampSources, CONSENT_STAGES, defaultSources, stageStatuses } from '@/lib/portal/consent-stages';

describe('two-stage consent definitions', () => {
  it('Part A never permits Aadhaar-document, bank, credit, employment or risk categories', () => {
    const a = allowedSources('PRELIMINARY');
    for (const k of ['DOCUMENTS', 'ADDRESS', 'BANKING', 'CREDIT', 'EMPLOYMENT', 'RISK']) expect(a).not.toContain(k);
    for (const k of ['SCREENING', 'CORPORATE', 'LEGAL', 'IDENTITY', 'MOBILE']) expect(a).toContain(k);
    expect(CONSENT_STAGES.PRELIMINARY.validityDays).toBe(30);
    expect(CONSENT_STAGES.FULL.validityDays).toBe(365);
  });
  it('Part B covers every source the ingest form knows', () => {
    const b = allowedSources('FULL');
    for (const k of ['IDENTITY', 'CONTACT', 'DOCUMENTS', 'ADDRESS', 'BANKING', 'EMPLOYMENT', 'MOBILE', 'CREDIT', 'RISK', 'CORPORATE', 'SCREENING', 'LEGAL', 'MEDIA', 'PROFESSIONAL', 'SOCIAL', 'WEB']) expect(b).toContain(k);
  });
  it('social, web and nominated profiles are opt-in, not pre-ticked', () => {
    for (const stage of ['PRELIMINARY', 'FULL'] as const) {
      const d = defaultSources(stage);
      expect(d).not.toContain('SOCIAL');
      expect(d).not.toContain('WEB');
      expect(d).not.toContain('PROFESSIONAL');
    }
    expect(defaultSources('FULL')).not.toContain('CREDIT');
  });
  it('clamps a tampered request to what the stage permits, in catalogue order', () => {
    expect(clampSources('PRELIMINARY', ['banking', 'CREDIT', 'legal', 'SCREENING', 'bogus'])).toEqual(['SCREENING', 'LEGAL']);
    expect(clampSources('FULL', ['credit'])).toEqual(['CREDIT']);
  });
  it('derives stage status from consent rows and expiry', () => {
    const now = new Date('2026-10-12T00:00:00Z');
    const s = stageStatuses([{ purposeCode: 'PRELIMINARY_SCREENING', status: 'GRANTED', expiresAt: '2026-11-11T00:00:00Z' }, { purposeCode: 'KYC_ONBOARDING', status: 'GRANTED', expiresAt: '2026-01-01T00:00:00Z' }], now);
    expect(s.PRELIMINARY.granted).toBe(true);
    expect(s.FULL.granted).toBe(false);
    expect(s.FULL.expired).toBe(true);
    const none = stageStatuses([], now);
    expect(none.PRELIMINARY.granted).toBe(false);
  });
});
