import { describe, expect, it } from 'vitest';
import { hashIdentifier, maskAadhaar, maskBankAccount, maskEmail, maskPan, maskPassport, maskPhone, maskUan, redactForLog } from '@/lib/security/masking';
import { hasPermission, ROLE_PERMISSIONS } from '@/lib/security/permissions';

describe('masking', () => {
  it('masks per identifier kind', () => {
    expect(maskPan('ABCPV1234D')).toBe('ABCP*****D');
    expect(maskAadhaar('123412348848')).toBe('XXXX XXXX 8848');
    expect(maskAadhaar('XXXXXXXX8848')).toBe('XXXX XXXX 8848');
    expect(maskBankAccount('50100123452345')).toBe('XXXXXXXXXX2345');
    expect(maskPassport('PA123456')).toBe('PA****56');
    expect(maskPhone('+91 98765 43210')).toBe('98XXXXX210');
    expect(maskEmail('rohan.mehta@example.com')).toBe('ro*********@example.com');
    expect(maskUan('100234567890')).toBe('XXXXXXXX7890');
  });
  it('hashes identifiers deterministically after normalisation', () => {
    expect(hashIdentifier('PHONE', '+91 98765 43210')).toBe(hashIdentifier('PHONE', '09876543210'));
    expect(hashIdentifier('PAN', 'abcpv1234d')).toBe(hashIdentifier('PAN', 'ABCPV1234D'));
    expect(hashIdentifier('EMAIL', ' Rohan@Example.com ')).toBe(hashIdentifier('EMAIL', 'rohan@example.com'));
    expect(hashIdentifier('PAN', null)).toBeNull();
  });
  it('redacts sensitive keys before logging', () => {
    const r = redactForLog({ pan: 'ABCPV1234D', nested: { account_number: '50100123452345', ok: 'visible' } });
    expect(r.pan).not.toContain('CPV1234');
    expect(r.nested.account_number).not.toContain('0012345234');
    expect(r.nested.ok).toBe('visible');
  });
});

describe('permissions', () => {
  it('auditors are read-only and cannot reveal', () => {
    expect(hasPermission('AUDITOR', 'audit:read')).toBe(true);
    expect(hasPermission('AUDITOR', 'sensitive:reveal')).toBe(false);
    expect(hasPermission('AUDITOR', 'clients:write')).toBe(false);
  });
  it('relationship managers cannot see financial detail', () => {
    expect(hasPermission('RELATIONSHIP_MANAGER', 'financial:read')).toBe(false);
    expect(hasPermission('RELATIONSHIP_MANAGER', 'investor:capture')).toBe(true);
  });
  it('only senior roles can reveal sensitive fields', () => {
    const can = Object.entries(ROLE_PERMISSIONS).filter(([, p]) => p.includes('sensitive:reveal')).map(([r]) => r);
    expect(can.sort()).toEqual(['COMPLIANCE_OFFICER', 'SENIOR_ANALYST', 'SUPER_ADMIN']);
  });
});
