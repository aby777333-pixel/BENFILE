/** Data anomaly & fraud-signal engine. Emits ANOMALY DETECTED / REVIEW REQUIRED, never "fraud". */
import { createHash } from 'node:crypto';
import type { CanonicalProfile } from '@/lib/canonical/types';
import { compareNames } from '@/lib/engines/normalize';
import type { ClientDocumentRow } from './types';

export interface Anomaly {
  fingerprint: string;
  type: string;
  detail: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  evidence: Record<string, unknown>;
}

const fp = (...p: string[]) => createHash('sha1').update(p.join('|')).digest('hex').slice(0, 16);

export function detectAnomalies(input: { profile: CanonicalProfile | null; sharedIdentifiers: Array<{ kind: string; other_client_ids: string[] }>; documents: ClientDocumentRow[]; now?: Date }): Anomaly[] {
  const now = input.now ?? new Date();
  const out: Anomaly[] = [];
  const p = input.profile;
  for (const s of input.sharedIdentifiers) {
    const label = s.kind === 'PHONE' ? 'phone number' : s.kind === 'BANK_ACCOUNT' ? 'bank account' : s.kind === 'PAN' ? 'PAN' : s.kind === 'EMAIL' ? 'e-mail address' : s.kind;
    out.push({ fingerprint: fp('shared', s.kind, ...s.other_client_ids.sort()), type: `SHARED_${s.kind}`, detail: `The same ${label} appears on ${s.other_client_ids.length} other client profile(s). Legitimate for family members or joint accounts; requires review.`, severity: s.kind === 'PAN' ? 'HIGH' : 'MEDIUM', evidence: { kind: s.kind, otherClients: s.other_client_ids } });
  }
  if (p) {
    const dob = p.person.dateOfBirth.value ? new Date(p.person.dateOfBirth.value) : null;
    if (dob && !Number.isNaN(dob.getTime())) {
      const age = (now.getTime() - dob.getTime()) / (365.25 * 86_400_000);
      if (age < 18 || age > 110 || dob > now) out.push({ fingerprint: fp('dob', p.person.dateOfBirth.value!), type: 'IMPLAUSIBLE_DOB', detail: `Date of birth ${p.person.dateOfBirth.value} implies age ${Math.floor(age)}.`, severity: 'HIGH', evidence: { dob: p.person.dateOfBirth.value } });
      for (const r of p.employment.records) if (r.joiningDate && new Date(r.joiningDate) < new Date(dob.getFullYear() + 14, dob.getMonth(), dob.getDate())) out.push({ fingerprint: fp('emp-before-14', r.employer.name), type: 'EMPLOYMENT_BEFORE_WORKING_AGE', detail: `Employment at ${r.employer.name} starts ${r.joiningDate}, before the client's 14th birthday.`, severity: 'HIGH', evidence: { joiningDate: r.joiningDate, dob: p.person.dateOfBirth.value } });
    }
    const current = p.employment.records.filter((r) => r.status === 'CURRENT');
    if (current.length > 1) out.push({ fingerprint: fp('multi-current', ...current.map((c) => c.employer.name).sort()), type: 'MULTIPLE_SIMULTANEOUS_EMPLOYERS', detail: `${current.length} employers show as current on the EPFO record (${current.map((c) => c.employer.name).join(', ')}). May be a transfer not yet closed; requires review.`, severity: 'MEDIUM', evidence: { employers: current.map((c) => c.employer.name) } });
    for (const r of p.employment.records) if (r.joiningDate && r.exitDate && new Date(r.exitDate) < new Date(r.joiningDate)) out.push({ fingerprint: fp('exit-before-join', r.employer.name), type: 'CONFLICTING_EMPLOYMENT_DATES', detail: `${r.employer.name}: exit ${r.exitDate} precedes joining ${r.joiningDate}.`, severity: 'MEDIUM', evidence: { joiningDate: r.joiningDate, exitDate: r.exitDate } });
    const sorted = [...p.employment.records].filter((r) => r.joiningDate).sort((a, b) => a.joiningDate!.localeCompare(b.joiningDate!));
    for (let i = 1; i < sorted.length; i++) { const prev = sorted[i - 1]; const cur = sorted[i]; if (prev.exitDate && cur.joiningDate && new Date(cur.joiningDate) < new Date(prev.exitDate) && (new Date(prev.exitDate).getTime() - new Date(cur.joiningDate).getTime()) / 86_400_000 > 60) out.push({ fingerprint: fp('overlap', prev.employer.name, cur.employer.name), type: 'OVERLAPPING_EMPLOYMENT', detail: `${prev.employer.name} (exit ${prev.exitDate}) overlaps ${cur.employer.name} (join ${cur.joiningDate}) by more than 60 days.`, severity: 'LOW', evidence: { prev: prev.employer.name, cur: cur.employer.name } }); }
    const bank = p.bankAccounts[0];
    if (bank?.accountHolderName && p.person.fullName.value && compareNames(bank.accountHolderName, p.person.fullName.value).status === 'MISMATCH') out.push({ fingerprint: fp('bank-holder', bank.accountHolderName), type: 'BANK_HOLDER_NAME_MISMATCH', detail: 'Bank account holder name does not match the verified identity name.', severity: 'HIGH', evidence: { holder: bank.accountHolderName } });
  }
  const bySha = new Map<string, ClientDocumentRow[]>();
  for (const d of input.documents) if (d.sha256) bySha.set(d.sha256, [...(bySha.get(d.sha256) ?? []), d]);
  for (const [sha, docs] of bySha) if (docs.length > 1 && new Set(docs.map((d) => d.doc_type)).size > 1) out.push({ fingerprint: fp('dup-doc', sha), type: 'DUPLICATE_DOCUMENT_REUSED', detail: `The same file was uploaded as ${docs.map((d) => d.doc_type).join(' and ')}.`, severity: 'MEDIUM', evidence: { sha256: sha, docTypes: docs.map((d) => d.doc_type) } });
  for (const d of input.documents) {
    for (const c of d.consistency ?? []) if (c.status === 'MISMATCH') out.push({ fingerprint: fp('doc-mismatch', d.id, c.check), type: 'DOCUMENT_FIELD_MISMATCH', detail: `${d.doc_type}: ${c.explanation}`, severity: 'MEDIUM', evidence: { documentId: d.id, check: c.check } });
    for (const t of d.tamper_signals ?? []) out.push({ fingerprint: fp('tamper', d.id, t.signal), type: 'POSSIBLE_TAMPER_SIGNAL', detail: `${d.doc_type}: ${t.detail}`, severity: 'MEDIUM', evidence: { documentId: d.id, signal: t.signal } });
  }
  return out;
}
