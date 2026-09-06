/**
 * Adapter for the India composite KYC response shape supplied with the brief.
 * Tolerant of missing/null fields and common key variations.
 */
import type {
  AddressRecord,
  BankAccount,
  CanonicalProfile,
  CreditBand,
  CreditProfile,
  EmploymentRecord,
  IdentityDocument,
  MobileIntelligence,
  Provenance,
  ProviderRiskSignal,
  RiskLevel,
  SourceClass,
  SourceRecord,
  SourceTier,
  VerificationStatus,
} from '@/lib/canonical/types';
import type { AdapterResult, ProviderAdapter } from './types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : typeof v === 'string' ? (['true', 'yes', 'y', '1'].includes(v.toLowerCase()) ? true : ['false', 'no', 'n', '0'].includes(v.toLowerCase()) ? false : null) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const pick = (o: Obj | null | undefined, ...keys: string[]): unknown => {
  if (!o) return undefined;
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
};

/** Known sub-sources inside the composite response. */
const SOURCE_META: Record<string, { label: string; sourceClass: SourceClass; tier: SourceTier }> = {
  PAN: { label: 'PAN (Income Tax Dept. via provider)', sourceClass: 'AUTHORIZED_PROVIDER', tier: 2 },
  UAN: { label: 'EPFO / UAN (via provider)', sourceClass: 'AUTHORIZED_PROVIDER', tier: 2 },
  EPFO: { label: 'EPFO / UAN (via provider)', sourceClass: 'AUTHORIZED_PROVIDER', tier: 2 },
  CREDIT: { label: 'Credit bureau (via provider)', sourceClass: 'AUTHORIZED_PROVIDER', tier: 2 },
  MOBILE: { label: 'Mobile network intelligence (via provider)', sourceClass: 'AUTHORIZED_PROVIDER', tier: 2 },
  BANK: { label: 'Bank verification (via provider)', sourceClass: 'AUTHORIZED_PROVIDER', tier: 2 },
  RISK: { label: 'Provider risk screen', sourceClass: 'AUTHORIZED_PROVIDER', tier: 2 },
  PROVIDER: { label: 'Verification provider', sourceClass: 'AUTHORIZED_PROVIDER', tier: 2 },
};

function sourceKeyOf(v: unknown, fallback = 'PROVIDER'): string {
  const s = str(v)?.toUpperCase() ?? fallback;
  if (s === 'EPFO') return 'UAN';
  if (s.includes('CIBIL') || s.includes('BUREAU') || s.includes('EXPERIAN') || s.includes('EQUIFAX') || s.includes('CRIF')) return 'CREDIT';
  return SOURCE_META[s] ? s : fallback;
}

function prov(sourceKey: string, evidencePath: string, retrievedAt: string | null, extra?: Partial<Provenance>): Provenance {
  const meta = SOURCE_META[sourceKey] ?? SOURCE_META.PROVIDER;
  return {
    sourceKey,
    sourceLabel: meta.label,
    sourceClass: meta.sourceClass,
    tier: meta.tier,
    assertion: 'VERIFIED_FACT',
    retrievedAt,
    evidencePath,
    recordId: null,
    confidence: null,
    ...extra,
  };
}

function statusOf(v: unknown): VerificationStatus {
  const s = str(v)?.toUpperCase();
  if (!s) return 'UNKNOWN';
  if (['COMPLETED', 'COMPLETE', 'SUCCESS', 'VERIFIED', 'DONE'].includes(s)) return 'COMPLETED';
  if (['PARTIAL', 'PARTIALLY_COMPLETED'].includes(s)) return 'PARTIAL';
  if (['PENDING', 'IN_PROGRESS', 'PROCESSING', 'QUEUED'].includes(s)) return 'PENDING';
  if (['FAILED', 'ERROR', 'REJECTED'].includes(s)) return 'FAILED';
  return 'UNKNOWN';
}

function riskLevelOf(v: unknown): RiskLevel {
  const s = str(v)?.toUpperCase();
  if (!s) return 'UNKNOWN';
  if (['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(s)) return s as RiskLevel;
  if (s === 'MODERATE') return 'MEDIUM';
  if (s === 'SEVERE') return 'CRITICAL';
  return 'UNKNOWN';
}

export function creditBandOf(score: number | null): CreditBand {
  if (score === null) return 'NOT_AVAILABLE';
  if (score <= 0) return 'NO_HISTORY';
  if (score >= 800) return 'EXCELLENT';
  if (score >= 750) return 'VERY_GOOD';
  if (score >= 700) return 'GOOD';
  if (score >= 650) return 'FAIR';
  return 'POOR';
}

function completeness(o: Obj | null | undefined, keys: string[]): number | null {
  if (!o) return null;
  const present = keys.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '').length;
  return keys.length ? Math.round((present / keys.length) * 100) / 100 : null;
}

export const indiaKycCompositeAdapter: ProviderAdapter = {
  key: 'india-kyc-composite',
  name: 'IndiaKYC Composite',
  version: '1.0.0',
  country: 'IN',
  domains: ['IDENTITY', 'CONTACT', 'DOCUMENTS', 'ADDRESS', 'BANKING', 'EMPLOYMENT', 'MOBILE', 'CREDIT', 'RISK'],

  detect(raw: unknown): boolean {
    if (!isObj(raw)) return false;
    const d = isObj(raw.data) ? raw.data : raw;
    return typeof raw.verification_id === 'string' && (isObj(d.personal) || isObj(d.documents) || isObj(d.employment));
  },

  normalize(raw: unknown): AdapterResult {
    const warnings: string[] = [];
    if (!isObj(raw)) throw new Error('Provider payload must be a JSON object');
    const d: Obj = isObj(raw.data) ? (raw.data as Obj) : raw;
    const base = isObj(raw.data) ? '/data' : '';
    const completedAt = str(pick(raw, 'completed_at', 'verified_at')) ?? null;
    const updatedAt = str(pick(raw, 'updated_at')) ?? completedAt;
    const requestedAt = str(pick(raw, 'created_at', 'requested_at')) ?? null;
    const defaultRetrieved = completedAt ?? updatedAt ?? requestedAt;

    const providerObj = isObj(raw.provider) ? raw.provider : null;
    const sources: SourceRecord[] = [];
    const addSource = (key: string, o: Obj | null | undefined, expectedKeys: string[], retrievedAt: string | null, path: string) => {
      const meta = SOURCE_META[key] ?? SOURCE_META.PROVIDER;
      const available = !!o && Object.keys(o).length > 0;
      const comp = completeness(o, expectedKeys);
      sources.push({
        key,
        label: meta.label,
        sourceClass: meta.sourceClass,
        tier: meta.tier,
        available,
        verificationStatus: !available ? 'NOT_AVAILABLE' : comp !== null && comp < 0.5 ? 'PARTIAL' : 'VERIFIED',
        retrievedAt: available ? retrievedAt : null,
        lastUpdatedAt: available ? (str(pick(o, 'last_updated', 'updated_at')) ?? retrievedAt) : null,
        confidence: available ? (num(pick(o, 'confidence', 'confidence_score')) ?? null) : null,
        completeness: comp,
        evidencePath: path,
      });
    };

    /* ---------------- personal ---------------- */
    const personal = isObj(d.personal) ? d.personal : null;
    const pPath = `${base}/personal`;
    const incomeSource = sourceKeyOf(pick(personal, 'income_source'), 'PAN');
    const incomeTypeRaw = str(pick(personal, 'income_type', 'income_kind'))?.toUpperCase();
    const incomeKind = incomeTypeRaw === 'DECLARED' ? 'DECLARED' : incomeTypeRaw === 'VERIFIED' ? 'VERIFIED' : incomeTypeRaw === 'ESTIMATED' ? 'ESTIMATED' : 'RETURNED';
    const incomeAmount = num(pick(personal, 'income', 'annual_income', 'declared_income'));
    const dob = str(pick(personal, 'dob', 'date_of_birth'));
    let age = num(pick(personal, 'age'));
    let ageProv = prov('PAN', `${pPath}/age`, defaultRetrieved);
    if (age === null && dob) {
      const dt = new Date(dob);
      if (!Number.isNaN(dt.getTime())) {
        const now = new Date();
        age = now.getFullYear() - dt.getFullYear() - (now < new Date(now.getFullYear(), dt.getMonth(), dt.getDate()) ? 1 : 0);
        ageProv = prov('PAN', `${pPath}/dob`, defaultRetrieved, { assertion: 'DERIVED' });
        warnings.push('Age derived from date of birth (provider did not return age).');
      }
    }
    const fullNameRaw = str(pick(personal, 'full_name', 'name'));
    const fullName = fullNameRaw ? fullNameRaw.replace(/\s+/g, ' ').trim() : null;
    if (fullNameRaw && fullName !== fullNameRaw) warnings.push('Full name whitespace normalised (original preserved in raw payload).');

    const person: CanonicalProfile['person'] = {
      fullName: { value: fullName, provenance: prov('PAN', `${pPath}/full_name`, defaultRetrieved) },
      gender: { value: str(pick(personal, 'gender'))?.toUpperCase() ?? null, provenance: prov('PAN', `${pPath}/gender`, defaultRetrieved) },
      dateOfBirth: { value: dob, provenance: prov('PAN', `${pPath}/dob`, defaultRetrieved) },
      age: { value: age, provenance: ageProv },
      occupation: { value: str(pick(personal, 'occupation')), provenance: prov('PAN', `${pPath}/occupation`, defaultRetrieved) },
      income: {
        value: incomeAmount === null ? null : { amount: incomeAmount, currency: str(pick(personal, 'currency')) ?? 'INR', period: 'ANNUAL', kind: incomeKind },
        provenance: prov(incomeSource, `${pPath}/income`, defaultRetrieved, { assertion: incomeKind === 'DECLARED' ? 'CLIENT_DECLARED' : 'VERIFIED_FACT' }),
      },
      relatives: arr(pick(personal, 'relatives')).flatMap((r, i) => {
        if (!isObj(r)) return [];
        const name = str(pick(r, 'name'));
        if (!name) return [];
        return [{ name, relation: str(pick(r, 'relation', 'relationship'))?.toUpperCase() ?? null, provenance: prov(sourceKeyOf(r.source, 'PAN'), `${pPath}/relatives/${i}`, defaultRetrieved) }];
      }),
      photoUrl: null,
    };
    addSource('PAN', isObj(d.documents) && isObj((d.documents as Obj).pan) ? ((d.documents as Obj).pan as Obj) : personal, ['number', 'name', 'type', 'aadhaar_linked', 'status'], defaultRetrieved, `${base}/documents/pan`);

    /* ---------------- contacts ---------------- */
    const phones = arr(d.phones).flatMap((p, i) => {
      if (!isObj(p)) return [];
      const number = str(pick(p, 'number', 'phone', 'mobile'));
      if (!number) return [];
      return [{ number, phoneType: str(pick(p, 'type', 'phone_type'))?.toUpperCase() ?? null, provenance: prov(sourceKeyOf(p.source), `${base}/phones/${i}`, defaultRetrieved) }];
    });
    const emails = arr(d.emails).flatMap((e, i) => {
      if (!isObj(e)) return [];
      const email = str(pick(e, 'email', 'address'));
      if (!email) return [];
      return [{ email, provenance: prov(sourceKeyOf(e.source), `${base}/emails/${i}`, defaultRetrieved) }];
    });

    /* ---------------- documents ---------------- */
    const docs = isObj(d.documents) ? d.documents : {};
    const identityDocuments: IdentityDocument[] = [];
    const docDef: Array<[string, IdentityDocument['docType']]> = [
      ['pan', 'PAN'],
      ['aadhaar', 'AADHAAR'],
      ['passport', 'PASSPORT'],
      ['voter_id', 'VOTER_ID'],
      ['driving_licence', 'DRIVING_LICENCE'],
      ['driving_license', 'DRIVING_LICENCE'],
      ['ration_card', 'RATION_CARD'],
    ];
    for (const [k, docType] of docDef) {
      const o = docs[k];
      if (!isObj(o)) continue;
      const path = `${base}/documents/${k}`;
      const number = str(pick(o, 'number', 'id'));
      const masked = str(pick(o, 'masked_number', 'masked'));
      if (!number && !masked) continue;
      const srcKey = docType === 'PAN' ? 'PAN' : sourceKeyOf(o.source, 'PAN');
      identityDocuments.push({
        docType,
        number,
        maskedNumber: masked,
        nameOnDocument: str(pick(o, 'name', 'name_on_document', 'registered_name')),
        subtype: str(pick(o, 'type', 'category')),
        status: str(pick(o, 'status'))?.toUpperCase() ?? null,
        aadhaarLinked: docType === 'PAN' ? bool(pick(o, 'aadhaar_linked')) : docType === 'AADHAAR' ? bool(pick(o, 'linked_to_pan')) : null,
        issuedAt: str(pick(o, 'issued_at', 'issue_date')),
        expiresAt: str(pick(o, 'expires_at', 'expiry_date')),
        provenance: prov(srcKey, path, str(pick(o, 'last_updated')) ?? defaultRetrieved),
      });
    }

    /* ---------------- addresses ---------------- */
    const addresses: AddressRecord[] = arr(d.addresses).flatMap((a, i) => {
      if (!isObj(a)) return [];
      const full = str(pick(a, 'full_address', 'address', 'complete_address'));
      const city = str(pick(a, 'city'));
      if (!full && !city) return [];
      return [
        {
          fullAddress: full,
          street: str(pick(a, 'street', 'line1')),
          city,
          state: str(pick(a, 'state')),
          country: str(pick(a, 'country')),
          pinCode: str(pick(a, 'pin_code', 'pincode', 'pin', 'postal_code')),
          addressType: str(pick(a, 'type', 'address_type'))?.toUpperCase() ?? null,
          provenance: prov(sourceKeyOf(a.source), `${base}/addresses/${i}`, defaultRetrieved),
        },
      ];
    });

    /* ---------------- bank ---------------- */
    const bankAccounts: BankAccount[] = arr(d.bank_accounts ?? d.banking).flatMap((b, i) => {
      if (!isObj(b)) return [];
      const accountNumber = str(pick(b, 'account_number', 'account'));
      const ifsc = str(pick(b, 'ifsc', 'ifsc_code'));
      if (!accountNumber && !ifsc) return [];
      return [
        {
          accountNumber,
          ifsc: ifsc?.toUpperCase() ?? null,
          bankName: str(pick(b, 'bank_name', 'bank')),
          branch: str(pick(b, 'branch', 'branch_name')),
          accountType: str(pick(b, 'account_type'))?.toUpperCase() ?? null,
          accountHolderName: str(pick(b, 'name_on_account', 'account_holder_name', 'holder_name')),
          verified: bool(pick(b, 'verified', 'is_verified')),
          provenance: prov(sourceKeyOf(b.source, 'BANK'), `${base}/bank_accounts/${i}`, defaultRetrieved),
        },
      ];
    });
    if (bankAccounts.length) addSource('BANK', { n: bankAccounts.length }, ['n'], defaultRetrieved, `${base}/bank_accounts`);

    /* ---------------- employment ---------------- */
    const emp = isObj(d.employment) ? d.employment : null;
    const empRetrieved = str(pick(emp, 'retrieved_at')) ?? defaultRetrieved;
    const empPath = `${base}/employment`;
    const employeeNameOnRecord = str(pick(emp, 'employee_name_on_record', 'employee_name', 'name_on_record'));
    const records: EmploymentRecord[] = arr(pick(emp, 'history', 'records', 'employers')).flatMap((h, i) => {
      if (!isObj(h)) return [];
      const name = str(pick(h, 'employer_name', 'employer', 'establishment_name'));
      if (!name) return [];
      const path = `${empPath}/history/${i}`;
      const exit = str(pick(h, 'exit_date', 'date_of_exit'));
      const rawStatus = str(pick(h, 'status', 'employment_status'))?.toUpperCase();
      const status: EmploymentRecord['status'] = rawStatus === 'CURRENT' || rawStatus === 'ACTIVE' || rawStatus === 'EMPLOYED' ? 'CURRENT' : rawStatus === 'EXITED' || rawStatus === 'LEFT' || exit ? 'EXITED' : rawStatus ? 'UNKNOWN' : exit ? 'EXITED' : 'UNKNOWN';
      const confidence = num(pick(h, 'employer_confidence_score', 'employer_confidence', 'confidence'));
      return [
        {
          employer: {
            name,
            establishmentId: str(pick(h, 'establishment_id', 'establishment_code')),
            ownershipType: str(pick(h, 'ownership_type')),
            setupDate: str(pick(h, 'establishment_setup_date', 'setup_date', 'date_of_setup')),
            employeeCount: num(pick(h, 'employee_count', 'employees')),
            pfFilings: arr(pick(h, 'pf_filings', 'filings')).flatMap((f) => {
              if (!isObj(f)) return [];
              const period = str(pick(f, 'wage_month', 'period', 'month'));
              if (!period) return [];
              return [{ period, employeeCount: num(pick(f, 'employees', 'employee_count')), amount: num(pick(f, 'amount', 'contribution')) }];
            }),
            confidence: confidence !== null && confidence > 1 ? confidence / 100 : confidence,
            provenance: prov('UAN', path, empRetrieved),
          },
          status,
          joiningDate: str(pick(h, 'joining_date', 'date_of_joining')),
          exitDate: exit,
          employeeNameOnRecord,
          employeeNameMatch: bool(pick(h, 'employee_name_match')) ?? bool(pick(emp, 'employee_name_match')),
          employerNameMatch: bool(pick(h, 'employer_name_match')),
          provenance: prov('UAN', path, empRetrieved),
        },
      ];
    });
    const epfo = emp
      ? {
          uan: str(pick(emp, 'uan')),
          memberId: str(pick(emp, 'member_id', 'epfo_member_id')),
          aadhaarLinked: bool(pick(emp, 'aadhaar_linked', 'uan_aadhaar_linked')),
          pfFilingAvailable: bool(pick(emp, 'pf_filing_available')),
          employeeNameMatch: bool(pick(emp, 'employee_name_match')),
          provenance: prov('UAN', empPath, empRetrieved),
        }
      : null;
    addSource('UAN', emp, ['uan', 'member_id', 'aadhaar_linked', 'employee_name_match', 'pf_filing_available', 'history'], empRetrieved, empPath);

    /* ---------------- mobile ---------------- */
    const m = isObj(d.mobile) ? d.mobile : null;
    const mRetrieved = str(pick(m, 'retrieved_at')) ?? defaultRetrieved;
    const ct = str(pick(m, 'connection_type', 'type'))?.toUpperCase();
    const mobile: MobileIntelligence | null = m
      ? {
          number: str(pick(m, 'number', 'mobile')),
          isValid: bool(pick(m, 'is_valid', 'valid')),
          subscriberStatus: str(pick(m, 'subscriber_status', 'status'))?.toUpperCase() ?? null,
          connectionType: ct === 'PREPAID' || ct === 'POSTPAID' ? ct : 'UNKNOWN',
          serviceProvider: str(pick(m, 'service_provider', 'operator', 'provider')),
          originalProvider: str(pick(m, 'original_provider', 'original_operator')),
          networkRegion: str(pick(m, 'network_region', 'circle', 'region')),
          isPorted: bool(pick(m, 'is_ported', 'ported')),
          provenance: prov('MOBILE', `${base}/mobile`, mRetrieved),
        }
      : null;
    addSource('MOBILE', m, ['number', 'is_valid', 'subscriber_status', 'connection_type', 'service_provider', 'network_region'], mRetrieved, `${base}/mobile`);

    /* ---------------- credit ---------------- */
    const c = isObj(d.credit) ? d.credit : null;
    const cRetrieved = str(pick(c, 'retrieved_at')) ?? defaultRetrieved;
    const score = num(pick(c, 'score', 'credit_score'));
    const credit: CreditProfile | null = c
      ? {
          score,
          band: creditBandOf(score),
          bureau: str(pick(c, 'bureau', 'source')),
          scoreDate: str(pick(c, 'score_date', 'as_of')),
          identifiers: isObj(c.identifiers) ? Object.fromEntries(Object.entries(c.identifiers).map(([k, v]) => [k, str(v)])) : {},
          accounts: arr(pick(c, 'accounts')).filter(isObj) as unknown as CreditProfile['accounts'],
          events: arr(pick(c, 'events', 'enquiries')).filter(isObj) as unknown as CreditProfile['events'],
          summary: {
            activeLoans: num(pick(c, 'active_loans')),
            securedLoans: num(pick(c, 'secured_loans')),
            unsecuredLoans: num(pick(c, 'unsecured_loans')),
            creditCards: num(pick(c, 'credit_cards')),
            totalOutstanding: num(pick(c, 'total_outstanding', 'outstanding_balance')),
            utilization: num(pick(c, 'utilization', 'credit_utilization')),
            enquiriesLast12m: num(pick(c, 'enquiries_last_12m', 'enquiries')),
            delinquencies: num(pick(c, 'delinquencies')),
          },
          provenance: prov('CREDIT', `${base}/credit`, cRetrieved),
        }
      : null;
    addSource('CREDIT', c, ['score', 'bureau', 'score_date'], cRetrieved, `${base}/credit`);

    /* ---------------- provider risk ---------------- */
    const riskArr = Array.isArray(d.risk) ? d.risk : isObj(d.risk) ? [d.risk] : [];
    const providerRisk: ProviderRiskSignal[] = riskArr.flatMap((r, i) => {
      if (!isObj(r)) return [];
      return [
        {
          isSafe: bool(pick(r, 'is_safe', 'safe')),
          riskLevel: riskLevelOf(pick(r, 'risk_level', 'level')),
          reason: str(pick(r, 'reason')),
          description: str(pick(r, 'description', 'detail')),
          detectedAt: str(pick(r, 'date_detected', 'detected_at')),
          updatedAt: str(pick(r, 'last_updated', 'updated_at')),
          provenance: prov('RISK', `${base}/risk/${i}`, str(pick(r, 'last_updated')) ?? defaultRetrieved, { recordId: str(pick(r, 'id')) }),
        },
      ];
    });
    addSource('RISK', riskArr.length ? { n: riskArr.length } : null, ['n'], defaultRetrieved, `${base}/risk`);

    const profile: CanonicalProfile = {
      schemaVersion: '1.0',
      provider: { key: indiaKycCompositeAdapter.key, name: str(pick(providerObj, 'name')) ?? indiaKycCompositeAdapter.name, adapterVersion: indiaKycCompositeAdapter.version },
      verification: {
        verificationId: str(pick(raw, 'verification_id', 'id')) ?? `unknown-${Date.now()}`,
        referenceId: str(pick(raw, 'reference_id', 'ref_id')),
        status: statusOf(pick(raw, 'status')),
        requestedAt,
        completedAt,
        updatedAt,
        providerRequestId: str(pick(providerObj, 'request_id')),
      },
      sources,
      person,
      contacts: { phones, emails },
      identityDocuments,
      addresses,
      bankAccounts,
      employment: { records, epfo },
      mobile,
      credit,
      providerRisk,
      warnings,
    };
    return { profile, warnings };
  },
};
