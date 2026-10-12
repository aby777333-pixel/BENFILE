import { describe, expect, it } from 'vitest';
import { buildShareLinks, invitationMessage, whatsappNumber } from '@/lib/portal/share-links';

describe('portal invitation share links', () => {
  it('normalises Indian mobiles for wa.me', () => {
    expect(whatsappNumber('98400 12345')).toBe('919840012345');
    expect(whatsappNumber('+91 98400-12345')).toBe('919840012345');
    expect(whatsappNumber('0091 9840012345')).toBe('919840012345');
    expect(whatsappNumber('12345')).toBeNull();
    expect(whatsappNumber('')).toBeNull();
  });
  it('builds WhatsApp and mailto links with the message and link embedded', () => {
    const s = buildShareLinks({ name: 'Abraham George', link: 'https://benfile.netlify.app/portal/abc', phone: '9840012345', email: 'abe@example.com', validDays: 7 });
    expect(s.whatsapp).toMatch(/^https:\/\/wa\.me\/919840012345\?text=/);
    expect(decodeURIComponent(s.whatsapp!)).toContain('https://benfile.netlify.app/portal/abc');
    expect(s.mailto).toMatch(/^mailto:abe%40example\.com\?subject=/);
    expect(s.message).toMatch(/^Hello Abraham,/);
    expect(s.message).toContain('expires in 7 days');
  });
  it('omits channels that are missing or invalid', () => {
    const s = buildShareLinks({ name: 'X', link: 'https://x', phone: 'abc', email: 'not-an-email' });
    expect(s.whatsapp).toBeNull();
    expect(s.mailto).toBeNull();
    expect(invitationMessage('', 'https://x')).toMatch(/^Hello there,/);
  });
});
