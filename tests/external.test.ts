import { describe, expect, it } from 'vitest';
import sample from '../fixtures/india-composite-sample.json';
import { indiaKycCompositeAdapter } from '@/lib/providers/india-kyc-composite';
import { buildSubject, runExternalSearch } from '@/lib/external/orchestrator';
import { compareTimeline } from '@/lib/external/timeline';

const NOW = new Date('2026-09-06T00:00:00Z');
const profile = indiaKycCompositeAdapter.normalize(sample).profile;

describe('external intelligence orchestrator', () => {
  it('refuses connectors the consent does not authorise', async () => {
    const r = await runExternalSearch(buildSubject(profile), { purpose: 'KYC', consentSources: ['CORPORATE'], now: NOW });
    expect(r.connectorsRun).toEqual(['mca-sandbox', 'gst-sandbox']);
    expect(r.connectorsSkipped.some((s) => s.key === 'social-sandbox')).toBe(true);
  });

  it('runs all sandbox connectors, resolves entities and ranks by trust tier', async () => {
    const r = await runExternalSearch(buildSubject(profile), { purpose: 'KYC', consentSources: ['ALL'], now: NOW });
    expect(r.findings.length).toBeGreaterThan(8);
    expect(r.findings[0].tier).toBe(1);
    for (const f of r.findings) {
      expect(f.mode).toBe('SANDBOX');
      expect(f.match.reasons.length + f.match.gaps.length).toBeGreaterThan(0);
    }
    const employerRecord = r.findings.find((f) => f.resultType === 'CORPORATE_RECORD')!;
    expect(employerRecord.match.status).toBe('CONFIRMED');
    const linkedin = r.findings.find((f) => f.recordId.startsWith('pro:linkedin'))!;
    expect(linkedin.match.status).toBe('HIGH_CONFIDENCE');
    const insta = r.findings.find((f) => f.recordId.startsWith('social:instagram'))!;
    expect(['LOW_CONFIDENCE', 'POSSIBLE_MATCH']).toContain(insta.match.status);
    expect(insta.humanReviewRequired).toBe(true);
    const adverse = r.findings.find((f) => f.category === 'POTENTIAL_ADVERSE')!;
    expect(adverse.categoryLabel).toMatch(/Human review required/);
    expect(adverse.match.status).not.toBe('CONFIRMED');
    const court = r.findings.find((f) => f.resultType === 'LEGAL_RECORD')!;
    expect(court.entityRole).toBe('RESPONDENT');
    expect(court.humanReviewRequired).toBe(true);
    expect(r.summary.total).toBe(r.findings.length);
  });
});

describe('career timeline comparison', () => {
  it('finds the sandbox LinkedIn timeline consistent with EPFO', () => {
    const c = compareTimeline(
      [
        { from: '2015-07', to: '2018-04', organisation: 'XYZ Solutions LLP' },
        { from: '2018-05', to: null, organisation: 'ABC Technologies Pvt Ltd' },
      ],
      profile,
    );
    expect(c.status).toBe('CONSISTENT');
  });
  it('flags an unknown employer as inconsistency requiring review, not deception', () => {
    const c = compareTimeline([{ from: '2019-01', to: '2020-01', organisation: 'Ghost Corp' }], profile);
    expect(c.status).toBe('INCONSISTENCY_REQUIRING_REVIEW');
    expect(c.explanation).toMatch(/not evidence of misrepresentation/);
  });
});
