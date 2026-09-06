/**
 * Document intelligence: classification, structured parsing (JSON/CSV/text), consistency against Client 360,
 * expiry / refresh flags, duplicate detection, and operational-only quality/tamper signals.
 * OCR / provider verification are integration points (extraction_status = MANUAL until connected).
 */
import { compareNames } from '@/lib/engines/normalize';
import { maskByKind, type SensitiveKind } from '@/lib/security/masking';
import type { ClientDocumentRow } from './types';

export const DOC_TYPES: Array<{ key: string; label: string; room: 'KYC' | 'PROPERTY' | 'FINANCIAL' | 'AIF' | 'GENERAL'; sensitiveKind?: SensitiveKind; access: 'MASKED' | 'KYC' | 'PROPERTY_LEGAL' | 'INVESTMENT_COMPLIANCE' | 'GENERAL'; expires?: boolean; refreshDays?: number }> = [
  { key: 'PAN_CARD', label: 'PAN card', room: 'KYC', sensitiveKind: 'PAN', access: 'KYC', refreshDays: 730 },
  { key: 'AADHAAR', label: 'Aadhaar (masked)', room: 'KYC', sensitiveKind: 'AADHAAR', access: 'KYC', refreshDays: 730 },
  { key: 'PASSPORT', label: 'Passport', room: 'KYC', sensitiveKind: 'PASSPORT', access: 'KYC', expires: true },
  { key: 'DRIVING_LICENCE', label: 'Driving licence', room: 'KYC', sensitiveKind: 'DRIVING_LICENCE', access: 'KYC', expires: true },
  { key: 'VOTER_ID', label: 'Voter ID', room: 'KYC', sensitiveKind: 'VOTER_ID', access: 'KYC' },
  { key: 'RATION_CARD', label: 'Ration card', room: 'KYC', sensitiveKind: 'RATION_CARD', access: 'KYC' },
  { key: 'PHOTOGRAPH', label: 'Photograph', room: 'KYC', access: 'MASKED' },
  { key: 'BANK_STATEMENT', label: 'Bank statement', room: 'FINANCIAL', sensitiveKind: 'BANK_ACCOUNT', access: 'INVESTMENT_COMPLIANCE', refreshDays: 90 },
  { key: 'CANCELLED_CHEQUE', label: 'Cancelled cheque / bank proof', room: 'KYC', sensitiveKind: 'BANK_ACCOUNT', access: 'KYC' },
  { key: 'SALARY_SLIP', label: 'Salary slips', room: 'FINANCIAL', access: 'INVESTMENT_COMPLIANCE', refreshDays: 90 },
  { key: 'FORM_16', label: 'Form 16 / ITR', room: 'FINANCIAL', sensitiveKind: 'PAN', access: 'INVESTMENT_COMPLIANCE', refreshDays: 365 },
  { key: 'GST_DOCUMENT', label: 'GST document', room: 'FINANCIAL', sensitiveKind: 'GSTIN', access: 'INVESTMENT_COMPLIANCE' },
  { key: 'COMPANY_DOCUMENT', label: 'Company / shareholding document', room: 'FINANCIAL', access: 'INVESTMENT_COMPLIANCE' },
  { key: 'EMPLOYMENT_LETTER', label: 'Employment letter', room: 'KYC', access: 'GENERAL' },
  { key: 'EPFO_DOCUMENT', label: 'EPFO / UAN document', room: 'KYC', sensitiveKind: 'UAN', access: 'KYC' },
  { key: 'CREDIT_REPORT', label: 'Credit report', room: 'FINANCIAL', access: 'INVESTMENT_COMPLIANCE', refreshDays: 90 },
  { key: 'MUTUAL_FUND_STATEMENT', label: 'Mutual-fund statement', room: 'FINANCIAL', access: 'INVESTMENT_COMPLIANCE', refreshDays: 90 },
  { key: 'DEMAT_STATEMENT', label: 'Demat statement', room: 'FINANCIAL', access: 'INVESTMENT_COMPLIANCE', refreshDays: 90 },
  { key: 'INVESTMENT_STATEMENT', label: 'Investment statement', room: 'FINANCIAL', access: 'INVESTMENT_COMPLIANCE', refreshDays: 90 },
  { key: 'INSURANCE', label: 'Insurance policy', room: 'FINANCIAL', access: 'GENERAL', expires: true },
  { key: 'SALE_DEED', label: 'Sale deed', room: 'PROPERTY', access: 'PROPERTY_LEGAL' },
  { key: 'PARENT_DEED', label: 'Parent deed', room: 'PROPERTY', access: 'PROPERTY_LEGAL' },
  { key: 'PATTA', label: 'Patta', room: 'PROPERTY', access: 'PROPERTY_LEGAL' },
  { key: 'CHITTA', label: 'Chitta', room: 'PROPERTY', access: 'PROPERTY_LEGAL' },
  { key: 'ADANGAL', label: 'Adangal', room: 'PROPERTY', access: 'PROPERTY_LEGAL' },
  { key: 'EC', label: 'Encumbrance certificate', room: 'PROPERTY', access: 'PROPERTY_LEGAL', refreshDays: 365 },
  { key: 'FMB', label: 'FMB / survey sketch', room: 'PROPERTY', access: 'PROPERTY_LEGAL' },
  { key: 'SURVEY_PLAN', label: 'Survey plan', room: 'PROPERTY', access: 'PROPERTY_LEGAL' },
  { key: 'LAYOUT', label: 'Layout / approval', room: 'PROPERTY', access: 'PROPERTY_LEGAL' },
  { key: 'PROPERTY_TAX', label: 'Property-tax receipt', room: 'PROPERTY', access: 'PROPERTY_LEGAL' },
  { key: 'VEHICLE_RC', label: 'Vehicle registration', room: 'GENERAL', access: 'GENERAL' },
  { key: 'LOAN_STATEMENT', label: 'Loan statement', room: 'FINANCIAL', access: 'INVESTMENT_COMPLIANCE', refreshDays: 90 },
  { key: 'TRUST_DOCUMENT', label: 'Trust document', room: 'FINANCIAL', access: 'INVESTMENT_COMPLIANCE' },
  { key: 'WILL_PROBATE', label: 'Will / probate / succession', room: 'FINANCIAL', access: 'INVESTMENT_COMPLIANCE' },
  { key: 'AIF_DOCUMENT', label: 'AIF document', room: 'AIF', access: 'INVESTMENT_COMPLIANCE' },
  { key: 'PMS_STATEMENT', label: 'PMS statement', room: 'AIF', access: 'INVESTMENT_COMPLIANCE', refreshDays: 90 },
  { key: 'SOURCE_OF_FUNDS', label: 'Source-of-funds evidence', room: 'AIF', access: 'INVESTMENT_COMPLIANCE', refreshDays: 365 },
  { key: 'SOURCE_OF_WEALTH', label: 'Source-of-wealth evidence', room: 'AIF', access: 'INVESTMENT_COMPLIANCE' },
  { key: 'SUITABILITY_QUESTIONNAIRE', label: 'Suitability questionnaire', room: 'AIF', access: 'INVESTMENT_COMPLIANCE', refreshDays: 365 },
  { key: 'OTHER', label: 'Other supporting document', room: 'GENERAL', access: 'GENERAL' },
];
export const docTypeMeta = (key: string) => DOC_TYPES.find((d) => d.key === key) ?? DOC_TYPES[DOC_TYPES.length - 1];

/** Guess the document type from a filename when the uploader did not choose one. */
export function classifyByName(name: string): string {
  const n = name.toLowerCase();
  const map: Array<[RegExp, string]> = [[/pan/, 'PAN_CARD'], [/aadha?ar/, 'AADHAAR'], [/passport/, 'PASSPORT'], [/licen[cs]e|dl\b/, 'DRIVING_LICENCE'], [/voter|epic/, 'VOTER_ID'], [/statement.*bank|bank.*statement|acct|account/, 'BANK_STATEMENT'], [/cheque|check/, 'CANCELLED_CHEQUE'], [/salary|payslip/, 'SALARY_SLIP'], [/form ?16|itr/, 'FORM_16'], [/gst/, 'GST_DOCUMENT'], [/cibil|experian|equifax|crif|credit report/, 'CREDIT_REPORT'], [/cams|kfin|mutual|mf\b/, 'MUTUAL_FUND_STATEMENT'], [/demat|cdsl|nsdl|holding/, 'DEMAT_STATEMENT'], [/sale ?deed/, 'SALE_DEED'], [/parent ?deed|mother ?deed/, 'PARENT_DEED'], [/patta/, 'PATTA'], [/chitta/, 'CHITTA'], [/adangal/, 'ADANGAL'], [/\bec\b|encumbrance/, 'EC'], [/fmb/, 'FMB'], [/layout|dtcp|cmda|approval/, 'LAYOUT'], [/property ?tax/, 'PROPERTY_TAX'], [/rc\b|registration certificate|vehicle/, 'VEHICLE_RC'], [/loan/, 'LOAN_STATEMENT'], [/trust/, 'TRUST_DOCUMENT'], [/will|probate|succession/, 'WILL_PROBATE'], [/ppm|aif/, 'AIF_DOCUMENT'], [/pms/, 'PMS_STATEMENT'], [/insurance|policy/, 'INSURANCE'], [/photo|selfie|jpg|jpeg|png/, 'PHOTOGRAPH']];
  for (const [re, k] of map) if (re.test(n)) return k;
  return 'OTHER';
}

export interface ParsedFields {
  name?: string | null;
  dob?: string | null;
  number?: string | null;
  address?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  issuingAuthority?: string | null;
  holdings?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/** Parses machine-readable uploads (JSON / CSV / plain key:value text). Binary files return null (needs OCR/provider). */
export function parseStructured(mime: string | null, name: string, text: string | null): ParsedFields | null {
  if (!text) return null;
  const t = text.trim();
  if (mime === 'application/json' || name.endsWith('.json')) {
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      const g = (...ks: string[]) => { for (const k of ks) { const v = j[k]; if (v !== undefined && v !== null) return String(v); } return null; };
      return { name: g('name', 'full_name', 'holder_name', 'name_on_document'), dob: g('dob', 'date_of_birth'), number: g('number', 'pan', 'document_number', 'account_number', 'id'), address: g('address'), issueDate: g('issue_date', 'issued_on'), expiryDate: g('expiry_date', 'valid_till'), issuingAuthority: g('issuing_authority', 'issuer'), holdings: Array.isArray(j.holdings) ? (j.holdings as Array<Record<string, unknown>>) : undefined, raw: j };
    } catch {
      return null;
    }
  }
  if (mime === 'text/csv' || name.endsWith('.csv')) {
    const lines = t.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return null;
    const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((c, i) => [head[i], c.trim()])));
    return { holdings: rows, rowCount: rows.length };
  }
  if (mime === 'text/plain' || name.endsWith('.txt')) {
    const kv: Record<string, string> = {};
    for (const line of t.split(/\r?\n/)) { const m = line.match(/^([A-Za-z _/-]{2,40}):\s*(.+)$/); if (m) kv[m[1].trim().toLowerCase()] = m[2].trim(); }
    return { name: kv.name ?? kv['full name'] ?? null, dob: kv.dob ?? kv['date of birth'] ?? null, number: kv.number ?? kv.pan ?? kv['account number'] ?? null, address: kv.address ?? null, raw: kv };
  }
  return null;
}

export interface ProfileFacts {
  fullName: string | null;
  dob: string | null;
  panMasked?: string | null;
  addresses: string[];
  bankHolderName?: string | null;
}

export function consistencyChecks(docType: string, fields: ParsedFields | null, extra: { name_on_document?: string | null; dob_on_document?: string | null; address_on_document?: string | null }, profile: ProfileFacts) {
  const name = extra.name_on_document ?? fields?.name ?? null;
  const dob = extra.dob_on_document ?? fields?.dob ?? null;
  const addr = extra.address_on_document ?? fields?.address ?? null;
  const out: ClientDocumentRow['consistency'] = [];
  if (name || profile.fullName) {
    const r = compareNames(name, profile.fullName);
    out.push({ check: 'NAME_VS_PROFILE', status: r.status, left: name, right: profile.fullName, explanation: r.explanation });
  }
  if (dob || profile.dob) out.push({ check: 'DOB_VS_PROFILE', status: !dob || !profile.dob ? 'NOT_AVAILABLE' : dob.slice(0, 10) === profile.dob.slice(0, 10) ? 'MATCH' : 'MISMATCH', left: dob, right: profile.dob, explanation: !dob || !profile.dob ? 'Date of birth not present on both.' : dob.slice(0, 10) === profile.dob.slice(0, 10) ? 'Same date of birth.' : 'Date of birth differs from the verified profile. Needs review; not automatically fraud.' });
  if (addr) {
    const hit = profile.addresses.some((a) => a && addr.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(a.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)));
    out.push({ check: 'ADDRESS_VS_PROFILE', status: hit ? 'MATCH' : 'PARTIAL_MATCH', left: addr, right: profile.addresses[0] ?? null, explanation: hit ? 'Address matches a verified address.' : 'Address differs from verified addresses; multiple addresses are common.' });
  }
  if (docType === 'CANCELLED_CHEQUE' || docType === 'BANK_STATEMENT') {
    const r = compareNames(name, profile.bankHolderName ?? profile.fullName);
    out.push({ check: 'BANK_HOLDER_VS_IDENTITY', status: r.status, left: name, right: profile.bankHolderName ?? profile.fullName, explanation: r.explanation });
  }
  return out;
}

export function qualitySignals(input: { mime: string | null; size: number | null; name: string; sha256: string | null; existingShas: Map<string, string> }): { quality: Record<string, unknown>; tamper: Array<{ signal: string; detail: string }>; duplicateOf: string | null } {
  const tamper: Array<{ signal: string; detail: string }> = [];
  const quality: Record<string, unknown> = { sizeBytes: input.size, mime: input.mime };
  const ext = input.name.split('.').pop()?.toLowerCase();
  if (input.size !== null && input.size < 2048) { quality.tooSmall = true; tamper.push({ signal: 'TINY_FILE', detail: `File is only ${input.size} bytes; likely unreadable or truncated.` }); }
  if (input.mime && ext && ((input.mime === 'application/pdf' && ext !== 'pdf') || (input.mime.startsWith('image/') && !['jpg', 'jpeg', 'png', 'webp'].includes(ext)))) tamper.push({ signal: 'EXTENSION_MIME_MISMATCH', detail: `Extension .${ext} does not match content type ${input.mime}.` });
  const dup = input.sha256 ? (input.existingShas.get(input.sha256) ?? null) : null;
  if (dup) tamper.push({ signal: 'DUPLICATE_FILE', detail: 'Identical file already uploaded for this client.' });
  quality.readable = !quality.tooSmall;
  return { quality, tamper, duplicateOf: dup };
}

export function refreshDue(docType: string, uploadedAt: string, expiry: string | null): { refreshDueOn: string | null; flag: 'CURRENT' | 'AGEING' | 'STALE' | 'EXPIRED' | 'REFRESH_REQUIRED' } {
  const meta = docTypeMeta(docType);
  const now = Date.now();
  if (expiry) {
    const e = new Date(expiry).getTime();
    if (e < now) return { refreshDueOn: expiry, flag: 'EXPIRED' };
    if (e - now < 90 * 86_400_000) return { refreshDueOn: expiry, flag: 'REFRESH_REQUIRED' };
  }
  if (meta.refreshDays) {
    const due = new Date(new Date(uploadedAt).getTime() + meta.refreshDays * 86_400_000);
    const ageDays = (now - new Date(uploadedAt).getTime()) / 86_400_000;
    return { refreshDueOn: due.toISOString().slice(0, 10), flag: ageDays > meta.refreshDays ? 'STALE' : ageDays > meta.refreshDays * 0.75 ? 'AGEING' : 'CURRENT' };
  }
  return { refreshDueOn: null, flag: 'CURRENT' };
}

export function maskDocNumber(docType: string, number: string | null | undefined): string | null {
  const k = docTypeMeta(docType).sensitiveKind;
  return k ? maskByKind(k, number) : number ? maskByKind('OTHER', number) : null;
}
