/**
 * Pre-filled WhatsApp / e-mail share links for a client-portal invitation.
 * Pure: runs in the browser from values the RM just typed; nothing is sent by BENFILE itself.
 */
export interface ShareLinks {
  whatsapp: string | null;
  mailto: string | null;
  message: string;
}

/** Digits only, Indian default country code when a bare 10-digit mobile is given. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length >= 11 && digits.length <= 15) return digits.replace(/^0+/, '');
  return null;
}

export function invitationMessage(name: string, link: string, firm = 'BENFILE', validDays?: number): string {
  const first = name.trim().split(/\s+/)[0] || 'there';
  return [`Hello ${first},`, '', `Before we meet, please open your secure ${firm} link and confirm the preliminary screening consent (Part A). It takes about two minutes and lists exactly what will and will not be checked.`, '', link, '', validDays ? `The link is personal to you and expires in ${validDays} days. Please do not forward it.` : 'The link is personal to you and expires automatically. Please do not forward it.'].join('\n');
}

export function buildShareLinks(opts: { name: string; link: string; phone?: string | null; email?: string | null; validDays?: number; firm?: string }): ShareLinks {
  const message = invitationMessage(opts.name, opts.link, opts.firm, opts.validDays);
  const wa = whatsappNumber(opts.phone);
  const email = (opts.email ?? '').trim();
  return {
    whatsapp: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}` : null,
    mailto: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Your secure ${opts.firm ?? 'BENFILE'} consent link`)}&body=${encodeURIComponent(message)}` : null,
    message,
  };
}
