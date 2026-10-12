import { describe, expect, it } from 'vitest';
import { detailsFromConsents, mergeSubjectDetails, parseProfileUrls, subjectFromProspect } from '@/lib/external/prospect-subject';

describe('prospect subject (Part A, no verification run)', () => {
  it('parses nominated profile URLs and drops junk', () => {
    expect(parseProfileUrls('linkedin.com/in/abraham-george, https://instagram.com/abe.g/ not-a-url')).toEqual(['https://linkedin.com/in/abraham-george', 'https://instagram.com/abe.g']);
    expect(parseProfileUrls(['javascript:alert(1)', 'ftp://x.com/a'])).toEqual([]);
    expect(parseProfileUrls(undefined)).toEqual([]);
  });
  it('reads details from the latest granted consent only', () => {
    const d = detailsFromConsents([
      { status: 'EXPIRED', acceptance: { details: { employer: 'Old Co' } } },
      { status: 'GRANTED', acceptance: { details: { employer: 'Zoho Corporation', city: 'Chennai', dob: '1984-03-09', profiles: 'linkedin.com/in/ag' } } },
    ]);
    expect(d.employer).toBe('Zoho Corporation');
    expect(d.profiles).toEqual(['https://linkedin.com/in/ag']);
    expect(detailsFromConsents([])).toEqual({});
  });
  it('builds a subject with analyst input taking precedence, never identifiers', () => {
    const s = subjectFromProspect({ display_name: 'Abraham George', city: 'Chennai' }, { employer: 'Zoho Corporation', dob: '1984-03-09', profiles: ['https://linkedin.com/in/ag'] }, { employer: 'Freshworks', city: '' });
    expect(s.fullName).toBe('Abraham George');
    expect(s.employers).toEqual(['Freshworks']);
    expect(s.cities).toEqual(['Chennai']);
    expect(s.dob).toBe('1984-03-09');
    expect(subjectFromProspect({ display_name: 'A', city: 'Chennai' }, { city: 'Changanassery' }, { city: 'Chennai, Kottayam' }).cities).toEqual(['Chennai', 'Kottayam', 'Changanassery']);
    expect(s.websites).toEqual(['https://linkedin.com/in/ag']);
    expect(s.pan).toBeNull();
    expect(s.emails).toEqual([]);
    expect(subjectFromProspect({ display_name: 'X' }, { dob: '09/03/1984' }).dob).toBeNull();
  });
  it('merges analyst details into a run-based subject without overriding verified facts', () => {
    const base = { fullName: 'A B', employers: ['Verified Ltd'], occupation: null, cities: ['Pune'], emails: [], phones: [], dob: '1990-01-01', websites: [] };
    const m = mergeSubjectDetails(base, { employer: 'Side Venture LLP', city: 'Pune', dob: '2000-01-01', profiles: ['https://x.example/p'] });
    expect(m.employers).toEqual(['Verified Ltd', 'Side Venture LLP']);
    expect(m.cities).toEqual(['Pune']);
    expect(m.dob).toBe('1990-01-01');
    expect(m.websites).toEqual(['https://x.example/p']);
  });
});
