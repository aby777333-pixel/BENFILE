import { describe, expect, it } from 'vitest';
import { buildDeclarationPayload, DECLARED_PAYLOAD_KEYS, declarationLabel, normalizeDeclared, validateDeclared } from '@/lib/portal/declared-details';
import { hashIdentifier, maskAadhaar, maskEmail, maskPan, maskPhone } from '@/lib/security/masking';
import { normalizePhone, normalizeIdentifier, normalizeEmail } from '@/lib/security/masking';

describe('portal declared details - normalisation matches the server masking rules', () => {
  it('normalises like src/lib/security/masking.ts', () => {
    expect(normalizeDeclared('PHONE', '+91 98765 43210')).toBe(normalizePhone('+91 98765 43210'));
    expect(normalizeDeclared('PHONE', '09876543210')).toBe('9876543210');
    expect(normalizeDeclared('PAN', ' abcpv1234d ')).toBe(normalizeIdentifier('abcpv1234d'));
    expect(normalizeDeclared('EMAIL', ' Rohan@Example.com ')).toBe(normalizeEmail('Rohan@Example.com'));
    expect(normalizeDeclared('AADHAAR', '2345 6789 0123')).toBe('234567890123');
  });
  it('the hash of a declared value equals the hash of the same ingested value', () => {
    expect(hashIdentifier('PAN', normalizeDeclared('PAN', 'abcpv1234d'))).toBe(hashIdentifier('PAN', 'ABCPV1234D'));
    expect(hashIdentifier('PHONE', normalizeDeclared('PHONE', '+91-98765-43210'))).toBe(hashIdentifier('PHONE', '9876543210'));
  });
  it('masks agree with the SQL bf_mask_identifier shapes', () => {
    expect(maskPan('ABCPV1234D')).toBe('ABCP*****D');
    expect(maskAadhaar('234567890123')).toBe('XXXX XXXX 0123');
    expect(maskPhone('9876543210')).toBe('98XXXXX210');
    expect(maskEmail('ab@example.com')).toBe('ab***@example.com');
  });
});

describe('portal declared details - validation', () => {
  it('accepts blanks (everything optional)', () => {
    expect(validateDeclared('PAN', '')).toEqual({ ok: true, value: null });
    expect(validateDeclared('PHONE', undefined)).toEqual({ ok: true, value: null });
  });
  it('checks formats with readable messages', () => {
    expect(validateDeclared('PAN', 'ABCDE1234F')).toEqual({ ok: true, value: 'ABCDE1234F' });
    expect(validateDeclared('PAN', 'ABCDE123')).toMatchObject({ ok: false, error: expect.stringMatching(/^Please check the PAN/) });
    expect(validateDeclared('AADHAAR', '1234 5678 9012')).toMatchObject({ ok: false });
    expect(validateDeclared('AADHAAR', '2345 6789 0123')).toEqual({ ok: true, value: '234567890123' });
    expect(validateDeclared('PHONE', '12345')).toMatchObject({ ok: false });
    expect(validateDeclared('PHONE', '+91 98400 12345')).toEqual({ ok: true, value: '9840012345' });
    expect(validateDeclared('EMAIL', 'not-an-email')).toMatchObject({ ok: false });
    expect(validateDeclared('VOTER_ID', 'abc1234567')).toEqual({ ok: true, value: 'ABC1234567' });
    expect(validateDeclared('PASSPORT', 'a1234567')).toEqual({ ok: true, value: 'A1234567' });
    expect(validateDeclared('DRIVING_LICENCE', 'TN01 20190001234')).toEqual({ ok: true, value: 'TN0120190001234' });
    expect(validateDeclared('DOB', '2099-01-01')).toMatchObject({ ok: false });
    expect(validateDeclared('DOB', '1980-05-17')).toEqual({ ok: true, value: '1980-05-17' });
  });
  it('builds a payload with only accepted keys and rejects an empty form', () => {
    const r = buildDeclarationPayload({ full_name: ' Abraham George ', pan: 'abcpv1234d', phone: '+91 98400 12345', address_line1: '12, 3rd Cross', address_city: 'Chennai', address_pin: '600 001', permanent_same: 'yes', junk: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toEqual({ full_name: 'Abraham George', pan: 'ABCPV1234D', phone: '9840012345', address_line1: '12, 3rd Cross', address_city: 'Chennai', address_pin: '600 001', permanent_same: 'yes' });
    expect(Object.keys(r.payload).every((k) => DECLARED_PAYLOAD_KEYS.includes(k))).toBe(true);
    expect(buildDeclarationPayload({})).toMatchObject({ ok: false, error: expect.stringMatching(/at least one/) });
    expect(buildDeclarationPayload({ permanent_same: 'yes' })).toMatchObject({ ok: false });
    expect(buildDeclarationPayload({ address_pin: '12' })).toMatchObject({ ok: false, error: expect.stringMatching(/PIN/) });
    expect(buildDeclarationPayload({ passport_expiry: '2030-01-01' })).toMatchObject({ ok: false });
  });
  it('labels stored declarations for people', () => {
    expect(declarationLabel('PHONE', 'ALTERNATE')).toBe('Alternate mobile');
    expect(declarationLabel('ADDRESS', 'PERMANENT')).toBe('Permanent address');
    expect(declarationLabel('PAN', 'PRIMARY')).toBe('PAN');
  });
});
