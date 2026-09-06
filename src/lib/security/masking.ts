/**
 * Field-level masking. All sensitive identifiers are masked by default.
 * Full values only leave the server through the audited reveal RPC.
 */
import { createHash } from 'node:crypto';

export type SensitiveKind =
  | 'PAN'
  | 'AADHAAR'
  | 'PASSPORT'
  | 'VOTER_ID'
  | 'DRIVING_LICENCE'
  | 'RATION_CARD'
  | 'BANK_ACCOUNT'
  | 'UAN'
  | 'PF_MEMBER_ID'
  | 'PHONE'
  | 'EMAIL'
  | 'GSTIN'
  | 'DIN'
  | 'OTHER';

export function normalizeIdentifier(v: string | null | undefined): string {
  return (v ?? '').replace(/[\s\-.()]/g, '').toUpperCase();
}

export function normalizePhone(v: string | null | undefined): string {
  let d = (v ?? '').replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(-10);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

export function normalizeEmail(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/** Deterministic hash used for lookups (search by PAN/phone/email) without indexing plaintext. */
export function hashIdentifier(kind: SensitiveKind, v: string | null | undefined): string | null {
  if (!v) return null;
  const norm = kind === 'PHONE' ? normalizePhone(v) : kind === 'EMAIL' ? normalizeEmail(v) : normalizeIdentifier(v);
  if (!norm) return null;
  return createHash('sha256').update(`${kind}:${norm}`).digest('hex');
}

export function maskPan(v: string | null | undefined): string | null {
  if (!v) return null;
  const n = normalizeIdentifier(v);
  if (n.length !== 10) return maskGeneric(n, 2, 1);
  return `${n.slice(0, 4)}*****${n.slice(-1)}`; // ABCP*****D
}

export function maskAadhaar(v: string | null | undefined): string | null {
  if (!v) return null;
  const n = normalizeIdentifier(v);
  const last4 = n.replace(/X/g, '').slice(-4);
  return `XXXX XXXX ${last4 || 'XXXX'}`;
}

export function maskBankAccount(v: string | null | undefined): string | null {
  if (!v) return null;
  const n = normalizeIdentifier(v);
  return 'X'.repeat(Math.max(n.length - 4, 3)) + n.slice(-4);
}

export function maskPassport(v: string | null | undefined): string | null {
  if (!v) return null;
  const n = normalizeIdentifier(v);
  return `${n.slice(0, 2)}${'*'.repeat(Math.max(n.length - 4, 2))}${n.slice(-2)}`; // PA****56
}

export function maskPhone(v: string | null | undefined): string | null {
  if (!v) return null;
  const n = normalizePhone(v);
  if (n.length < 6) return 'XXXXX';
  return `${n.slice(0, 2)}XXXXX${n.slice(-3)}`;
}

export function maskEmail(v: string | null | undefined): string | null {
  if (!v) return null;
  const e = normalizeEmail(v);
  const [local, domain] = e.split('@');
  if (!domain) return maskGeneric(e, 1, 1);
  const shown = local.slice(0, Math.min(2, local.length));
  return `${shown}${'*'.repeat(Math.max(local.length - shown.length, 3))}@${domain}`;
}

export function maskUan(v: string | null | undefined): string | null {
  if (!v) return null;
  const n = normalizeIdentifier(v);
  return `${'X'.repeat(Math.max(n.length - 4, 4))}${n.slice(-4)}`;
}

export function maskGeneric(v: string | null | undefined, keepStart = 2, keepEnd = 2): string | null {
  if (!v) return null;
  const n = String(v);
  if (n.length <= keepStart + keepEnd) return '*'.repeat(n.length);
  return `${n.slice(0, keepStart)}${'*'.repeat(n.length - keepStart - keepEnd)}${n.slice(-keepEnd)}`;
}

export function maskByKind(kind: SensitiveKind, v: string | null | undefined): string | null {
  switch (kind) {
    case 'PAN':
      return maskPan(v);
    case 'AADHAAR':
      return maskAadhaar(v);
    case 'BANK_ACCOUNT':
      return maskBankAccount(v);
    case 'PASSPORT':
      return maskPassport(v);
    case 'PHONE':
      return maskPhone(v);
    case 'EMAIL':
      return maskEmail(v);
    case 'UAN':
    case 'PF_MEMBER_ID':
      return maskUan(v);
    default:
      return maskGeneric(v, 2, 2);
  }
}

const SENSITIVE_KEY_RE =
  /(pan|aadhaar|aadhar|passport|account_number|accountnumber|uan|member_id|memberid|voter|licen[cs]e|ration|ifsc|number|email|phone|mobile|din|gstin|dob|full_name|name)/i;

/** Deep-redacts sensitive-looking keys before anything is logged. */
export function redactForLog<T>(input: T): T {
  const seen = new WeakSet();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) return '[circular]';
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k) && (typeof val === 'string' || typeof val === 'number')) {
        out[k] = maskGeneric(String(val), 1, 1);
      } else {
        out[k] = walk(val);
      }
    }
    return out;
  };
  return walk(input) as T;
}
