/**
 * Self-declared details on the client portal (all optional).
 *
 * Browser-safe: no node imports. Normalisation and format rules mirror
 * src/lib/security/masking.ts and the `bf_*` SQL helpers in migration 0008, so what the
 * person types is checked the same way on their device and on the server.
 */

export type DeclaredKind = 'NAME' | 'DOB' | 'PAN' | 'AADHAAR' | 'PASSPORT' | 'VOTER_ID' | 'DRIVING_LICENCE' | 'PHONE' | 'EMAIL' | 'ADDRESS';

export interface DeclaredField {
  key: string;
  kind: DeclaredKind;
  label: string;
  placeholder?: string;
  type?: 'text' | 'date' | 'email' | 'tel';
  hint?: string;
}

/** Identity fields shown on the portal form, in order. */
export const IDENTITY_FIELDS: DeclaredField[] = [
  { key: 'full_name', kind: 'NAME', label: 'Full name (as on PAN)', placeholder: 'e.g. Abraham George' },
  { key: 'dob', kind: 'DOB', label: 'Date of birth', type: 'date' },
  { key: 'pan', kind: 'PAN', label: 'PAN', placeholder: 'ABCDE1234F' },
  { key: 'aadhaar', kind: 'AADHAAR', label: 'Aadhaar number', placeholder: '12 digits', hint: 'We keep only the last four digits.' },
  { key: 'passport', kind: 'PASSPORT', label: 'Passport number', placeholder: 'A1234567' },
  { key: 'passport_expiry', kind: 'PASSPORT', label: 'Passport expiry', type: 'date' },
  { key: 'voter_id', kind: 'VOTER_ID', label: 'Voter ID (EPIC)', placeholder: 'ABC1234567' },
  { key: 'driving_licence', kind: 'DRIVING_LICENCE', label: 'Driving licence number', placeholder: 'TN01 20190001234' },
];

export const CONTACT_FIELDS: DeclaredField[] = [
  { key: 'phone', kind: 'PHONE', label: 'Mobile', type: 'tel', placeholder: '98400 12345' },
  { key: 'phone_alt', kind: 'PHONE', label: 'Alternate mobile', type: 'tel' },
  { key: 'email', kind: 'EMAIL', label: 'E-mail', type: 'email', placeholder: 'name@example.com' },
  { key: 'email_alt', kind: 'EMAIL', label: 'Alternate e-mail', type: 'email' },
];

export const ADDRESS_FIELDS: Array<{ suffix: string; label: string; placeholder?: string }> = [
  { suffix: 'line1', label: 'House / flat, street', placeholder: '12, 3rd Cross Street' },
  { suffix: 'line2', label: 'Area / landmark' },
  { suffix: 'city', label: 'City / town' },
  { suffix: 'state', label: 'State' },
  { suffix: 'pin', label: 'PIN code', placeholder: '600001' },
  { suffix: 'country', label: 'Country', placeholder: 'India' },
];

/** Payload keys the server accepts; anything else is dropped before the call. */
export const DECLARED_PAYLOAD_KEYS = [
  ...IDENTITY_FIELDS.map((f) => f.key),
  ...CONTACT_FIELDS.map((f) => f.key),
  ...ADDRESS_FIELDS.map((f) => `address_${f.suffix}`),
  ...ADDRESS_FIELDS.map((f) => `permanent_${f.suffix}`),
  'permanent_same',
];

/** Human label for a stored declaration (kind + label). */
export function declarationLabel(kind: string, label: string): string {
  const base: Record<string, string> = { NAME: 'Name (as on PAN)', DOB: 'Date of birth', PAN: 'PAN', AADHAAR: 'Aadhaar', PASSPORT: 'Passport', VOTER_ID: 'Voter ID', DRIVING_LICENCE: 'Driving licence', PHONE: 'Mobile', EMAIL: 'E-mail', ADDRESS: 'Address' };
  const name = base[kind] ?? kind.replace(/_/g, ' ');
  if (label === 'ALTERNATE') return `Alternate ${name.toLowerCase()}`;
  if (label === 'CURRENT') return `Current ${name.toLowerCase()}`;
  if (label === 'PERMANENT') return `Permanent ${name.toLowerCase()}`;
  return name;
}

export function normalizeDeclared(kind: DeclaredKind, raw: string): string {
  if (kind === 'PHONE') {
    let d = raw.replace(/\D/g, '');
    if (d.length > 10 && d.startsWith('91')) d = d.slice(-10);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d;
  }
  if (kind === 'EMAIL') return raw.trim().toLowerCase();
  if (kind === 'NAME' || kind === 'DOB' || kind === 'ADDRESS') return raw.trim();
  return raw.replace(/[\s\-.()]/g, '').toUpperCase();
}

const RULES: Partial<Record<DeclaredKind, { re: RegExp; message: string }>> = {
  PAN: { re: /^[A-Z]{5}[0-9]{4}[A-Z]$/, message: 'Please check the PAN - it should look like ABCDE1234F.' },
  AADHAAR: { re: /^[2-9][0-9]{11}$/, message: 'Please check the Aadhaar number - it should be 12 digits.' },
  PASSPORT: { re: /^[A-Z0-9]{6,12}$/, message: 'Please check the passport number.' },
  VOTER_ID: { re: /^[A-Z]{3}[0-9]{7}$/, message: 'Please check the voter ID - it should look like ABC1234567.' },
  DRIVING_LICENCE: { re: /^[A-Z]{2}[0-9A-Z]{9,15}$/, message: 'Please check the driving licence number.' },
  PHONE: { re: /^[6-9][0-9]{9}$/, message: 'Please check the mobile number - a 10-digit Indian mobile is expected.' },
  EMAIL: { re: /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/, message: 'Please check the e-mail address.' },
};

/** Validates one typed value. Empty input is fine (everything is optional). */
export function validateDeclared(kind: DeclaredKind, raw: string | null | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = (raw ?? '').trim();
  if (!text) return { ok: true, value: null };
  const value = normalizeDeclared(kind, text);
  if (kind === 'DOB') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value) > new Date() || value < '1900-01-01') return { ok: false, error: 'Please check the date of birth.' };
    return { ok: true, value };
  }
  if (kind === 'NAME') return value.length >= 2 ? { ok: true, value: value.slice(0, 120) } : { ok: false, error: 'Please enter your full name.' };
  const rule = RULES[kind];
  if (rule && (!rule.re.test(value) || (kind === 'EMAIL' && value.length > 160))) return { ok: false, error: rule.message };
  return { ok: true, value };
}

/**
 * Cleans a portal form into the payload sent to `portal_declare_details`. Returns the first
 * readable error instead when something is malformed or nothing was filled in. Raw (unmasked)
 * values travel only inside this call; nothing is kept on the device.
 */
export function buildDeclarationPayload(input: Record<string, string>): { ok: true; payload: Record<string, string> } | { ok: false; error: string } {
  const payload: Record<string, string> = {};
  for (const f of [...IDENTITY_FIELDS, ...CONTACT_FIELDS]) {
    const raw = input[f.key];
    if (f.key === 'passport_expiry') {
      const v = (raw ?? '').trim();
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: 'Please check the passport expiry date.' };
      if (v) payload[f.key] = v;
      continue;
    }
    const res = validateDeclared(f.kind, raw);
    if (!res.ok) return res;
    if (res.value) payload[f.key] = res.value;
  }
  const pinOk = (v: string) => /^[1-9][0-9]{5}$/.test(v.replace(/\s/g, ''));
  for (const prefix of ['address', 'permanent'] as const) {
    for (const a of ADDRESS_FIELDS) {
      const v = (input[`${prefix}_${a.suffix}`] ?? '').trim();
      if (!v) continue;
      if (a.suffix === 'pin' && !pinOk(v)) return { ok: false, error: 'Please check the PIN code - 6 digits are expected.' };
      payload[`${prefix}_${a.suffix}`] = v.slice(0, 160);
    }
  }
  if (input.permanent_same === 'yes' || input.permanent_same === 'on') payload.permanent_same = 'yes';
  if (payload.passport_expiry && !payload.passport) delete payload.passport_expiry;
  const meaningful = Object.keys(payload).filter((k) => k !== 'permanent_same');
  if (!meaningful.length) return { ok: false, error: 'Please fill in at least one detail.' };
  return { ok: true, payload };
}
