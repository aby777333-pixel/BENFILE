/**
 * BENFILE canonical intelligence model.
 *
 * Every provider adapter normalises into this model. Every engine reads from it.
 * The UI never touches raw provider payloads except through the evidence drawer.
 *
 * Four assertion kinds are distinguished everywhere (DB + UI):
 *   VERIFIED_FACT       - directly returned by a trusted source
 *   CLIENT_DECLARED     - supplied by the client
 *   DERIVED             - calculated from verified information
 *   ANALYST_ASSESSMENT  - entered or approved by an authorised analyst
 */

export const ASSERTION_KINDS = ['VERIFIED_FACT', 'CLIENT_DECLARED', 'DERIVED', 'ANALYST_ASSESSMENT'] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

/** Source classes (what kind of institution produced the record). */
export const SOURCE_CLASSES = [
  'OFFICIAL_GOVERNMENT',
  'AUTHORIZED_PROVIDER',
  'INSTITUTIONAL',
  'NEWS_MEDIA',
  'PROFESSIONAL_PROFILE',
  'PUBLIC_WEB',
  'USER_GENERATED',
  'PUBLIC_RECORD',
  'USER_SUPPLIED_DOCUMENT',
] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

/** Trust tiers 1 (highest) to 7 (lowest). */
export type SourceTier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const SOURCE_CLASS_TIER: Record<SourceClass, SourceTier> = {
  OFFICIAL_GOVERNMENT: 1,
  AUTHORIZED_PROVIDER: 2,
  INSTITUTIONAL: 3,
  NEWS_MEDIA: 4,
  PROFESSIONAL_PROFILE: 5,
  PUBLIC_WEB: 6,
  USER_GENERATED: 7,
  PUBLIC_RECORD: 3,
  USER_SUPPLIED_DOCUMENT: 5,
};

export const TIER_LABEL: Record<SourceTier, string> = {
  1: 'Tier 1 - Official government / regulatory',
  2: 'Tier 2 - Authorised verification provider',
  3: 'Tier 3 - Official company / institutional',
  4: 'Tier 4 - Established news / media',
  5: 'Tier 5 - Professional / public profile',
  6: 'Tier 6 - General public web',
  7: 'Tier 7 - Unverified user-generated',
};

export const SOURCE_CLASS_LABEL: Record<SourceClass, string> = {
  OFFICIAL_GOVERNMENT: 'Official government source',
  AUTHORIZED_PROVIDER: 'Authorised third-party verification provider',
  INSTITUTIONAL: 'Official company / institutional source',
  NEWS_MEDIA: 'News / media organisation',
  PROFESSIONAL_PROFILE: 'Professional / public profile',
  PUBLIC_WEB: 'General public web',
  USER_GENERATED: 'Unverified user-generated content',
  PUBLIC_RECORD: 'Public record',
  USER_SUPPLIED_DOCUMENT: 'User-supplied document',
};

/** A provenance stamp attached to every fact. */
export interface Provenance {
  /** Stable key for the source (e.g. "PAN", "UAN", "CIBIL", "MOBILE_INTEL"). */
  sourceKey: string;
  sourceLabel: string;
  sourceClass: SourceClass;
  tier: SourceTier;
  assertion: AssertionKind;
  /** ISO timestamp the value was retrieved/verified by the source. */
  retrievedAt?: string | null;
  /** Provider-side record identifier where available. */
  recordId?: string | null;
  /** JSON pointer into the raw provider payload (evidence drawer). */
  evidencePath?: string | null;
  /** 0..1 confidence supplied by the source, if any. */
  confidence?: number | null;
}

export interface Fact<T> {
  value: T | null;
  provenance: Provenance;
}

export type VerificationStatus = 'COMPLETED' | 'PARTIAL' | 'PENDING' | 'FAILED' | 'UNKNOWN';

export interface VerificationMeta {
  verificationId: string;
  referenceId: string | null;
  status: VerificationStatus;
  requestedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  providerRequestId?: string | null;
}

export interface SourceRecord {
  key: string;
  label: string;
  sourceClass: SourceClass;
  tier: SourceTier;
  available: boolean;
  verificationStatus: 'VERIFIED' | 'PARTIAL' | 'UNVERIFIED' | 'NOT_AVAILABLE' | 'ERROR';
  retrievedAt: string | null;
  lastUpdatedAt: string | null;
  confidence: number | null;
  /** 0..1 - how many expected fields the source returned. */
  completeness: number | null;
  evidencePath?: string | null;
}

export type IncomeKind = 'DECLARED' | 'RETURNED' | 'VERIFIED' | 'ESTIMATED';

export interface Income {
  amount: number | null;
  currency: string;
  period: 'ANNUAL' | 'MONTHLY';
  kind: IncomeKind;
}

export interface Relative {
  name: string;
  relation: string | null;
  provenance: Provenance;
}

export interface PersonalIdentity {
  fullName: Fact<string>;
  gender: Fact<string>;
  dateOfBirth: Fact<string>;
  age: Fact<number>;
  occupation: Fact<string>;
  income: Fact<Income>;
  relatives: Relative[];
  photoUrl?: Fact<string> | null;
}

export interface PhoneRecord {
  number: string; // full - masked at the boundary
  phoneType: string | null;
  provenance: Provenance;
}

export interface EmailRecord {
  email: string;
  provenance: Provenance;
}

export type IdentityDocumentType =
  | 'PAN'
  | 'AADHAAR'
  | 'PASSPORT'
  | 'VOTER_ID'
  | 'DRIVING_LICENCE'
  | 'RATION_CARD'
  | 'GSTIN'
  | 'DIN'
  | 'OTHER';

export interface IdentityDocument {
  docType: IdentityDocumentType;
  /** Full number when supplied - never rendered unmasked without an audited reveal. */
  number: string | null;
  /** Provider-supplied masked value (e.g. Aadhaar is only ever masked). */
  maskedNumber: string | null;
  nameOnDocument: string | null;
  subtype: string | null; // e.g. PAN type "Individual"
  status: string | null;
  aadhaarLinked: boolean | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  provenance: Provenance;
}

export interface AddressRecord {
  fullAddress: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pinCode: string | null;
  addressType: string | null;
  provenance: Provenance;
}

export interface BankAccount {
  accountNumber: string | null;
  ifsc: string | null;
  bankName: string | null;
  branch: string | null;
  accountType: string | null;
  accountHolderName: string | null;
  verified: boolean | null;
  provenance: Provenance;
}

export interface PfFiling {
  period: string; // YYYY-MM
  employeeCount: number | null;
  amount: number | null;
}

export interface EmployerIntelligence {
  name: string;
  establishmentId: string | null;
  ownershipType: string | null;
  setupDate: string | null;
  employeeCount: number | null;
  pfFilings: PfFiling[];
  confidence: number | null;
  provenance: Provenance;
}

export type EmploymentStatus = 'CURRENT' | 'EXITED' | 'UNKNOWN';

export interface EmploymentRecord {
  employer: EmployerIntelligence;
  status: EmploymentStatus;
  joiningDate: string | null;
  exitDate: string | null;
  employeeNameOnRecord: string | null;
  employeeNameMatch: boolean | null;
  employerNameMatch: boolean | null;
  provenance: Provenance;
}

export interface EpfoRecord {
  uan: string | null;
  memberId: string | null;
  aadhaarLinked: boolean | null;
  pfFilingAvailable: boolean | null;
  employeeNameMatch: boolean | null;
  provenance: Provenance;
}

export interface EmploymentIntelligence {
  records: EmploymentRecord[];
  epfo: EpfoRecord | null;
}

export interface MobileIntelligence {
  number: string | null;
  isValid: boolean | null;
  subscriberStatus: string | null;
  connectionType: 'PREPAID' | 'POSTPAID' | 'UNKNOWN';
  serviceProvider: string | null;
  originalProvider: string | null;
  networkRegion: string | null;
  isPorted: boolean | null;
  provenance: Provenance;
}

export type CreditBand = 'EXCELLENT' | 'VERY_GOOD' | 'GOOD' | 'FAIR' | 'POOR' | 'NO_HISTORY' | 'NOT_AVAILABLE';

/** Designed for bureau expansion (loans, cards, enquiries) without restructuring. */
export interface CreditAccount {
  accountType: string; // e.g. HOME_LOAN, CREDIT_CARD
  secured: boolean | null;
  lender: string | null;
  openedAt: string | null;
  closedAt: string | null;
  status: string | null;
  sanctioned: number | null;
  outstanding: number | null;
  overdue: number | null;
  utilization?: number | null;
  paymentHistory?: Array<{ period: string; status: string }>;
  provenance?: Provenance;
}

export interface CreditEvent {
  kind: 'ENQUIRY' | 'DELINQUENCY' | 'DEFAULT' | 'SETTLEMENT' | 'WRITE_OFF';
  date: string | null;
  lender: string | null;
  amount: number | null;
  detail: string | null;
  provenance?: Provenance;
}

export interface CreditProfile {
  score: number | null;
  band: CreditBand;
  bureau: string | null;
  scoreDate: string | null;
  identifiers: Record<string, string | null>;
  accounts: CreditAccount[];
  events: CreditEvent[];
  summary: {
    activeLoans: number | null;
    securedLoans: number | null;
    unsecuredLoans: number | null;
    creditCards: number | null;
    totalOutstanding: number | null;
    utilization: number | null;
    enquiriesLast12m: number | null;
    delinquencies: number | null;
  };
  provenance: Provenance;
}

export type RiskLevel = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

/** A risk indicator exactly as the provider stated it (no reinterpretation). */
export interface ProviderRiskSignal {
  isSafe: boolean | null;
  riskLevel: RiskLevel;
  reason: string | null;
  description: string | null;
  detectedAt: string | null;
  updatedAt: string | null;
  provenance: Provenance;
}

export interface CanonicalProfile {
  schemaVersion: '1.0';
  provider: { key: string; name: string; adapterVersion: string };
  verification: VerificationMeta;
  sources: SourceRecord[];
  person: PersonalIdentity;
  contacts: { phones: PhoneRecord[]; emails: EmailRecord[] };
  identityDocuments: IdentityDocument[];
  addresses: AddressRecord[];
  bankAccounts: BankAccount[];
  employment: EmploymentIntelligence;
  mobile: MobileIntelligence | null;
  credit: CreditProfile | null;
  providerRisk: ProviderRiskSignal[];
  /** Adapter warnings (unknown fields, coerced values). Never shown as facts. */
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Engine outputs                                                      */
/* ------------------------------------------------------------------ */

export type MatchStatus = 'MATCH' | 'PARTIAL_MATCH' | 'MISMATCH' | 'NOT_AVAILABLE';

export interface IdentityCheck {
  key: string;
  label: string;
  leftSource: string;
  rightSource: string;
  leftValue: string | null; // masked at boundary when sensitive
  rightValue: string | null;
  sensitive: boolean;
  status: MatchStatus;
  score: number | null;
  explanation: string;
}

export type RiskCategory =
  | 'IDENTITY'
  | 'CREDIT'
  | 'EMPLOYMENT'
  | 'CONTACT'
  | 'BANKING'
  | 'ADDRESS'
  | 'MOBILE'
  | 'DATA_CONSISTENCY'
  | 'DATA_FRESHNESS'
  | 'EXTERNAL'
  | 'LEGAL'
  | 'REGULATORY'
  | 'SANCTIONS'
  | 'ADVERSE_MEDIA';

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SignalOrigin = 'PROVIDER' | 'RULES_ENGINE' | 'EXTERNAL' | 'ANALYST';
export type SignalStatus = 'OPEN' | 'NEEDS_REVIEW' | 'REVIEWED' | 'ESCALATED' | 'DISMISSED' | 'RESOLVED';

export interface EvidenceRef {
  label: string;
  sourceKey: string;
  path?: string | null; // JSON pointer into raw
  value?: string | null; // masked display value
}

export interface RiskSignal {
  fingerprint: string;
  ruleKey: string;
  category: RiskCategory;
  severity: Severity;
  origin: SignalOrigin;
  sourceKey: string;
  title: string;
  explanation: string;
  evidence: EvidenceRef[];
  detectedAt: string | null;
  updatedAt: string | null;
  status: SignalStatus;
  requiresReview: boolean;
}

export type FreshnessLabel = 'FRESH' | 'RECENT' | 'AGING' | 'STALE' | 'UNKNOWN';

export interface DataQualityRow {
  sourceKey: string;
  label: string;
  tier: SourceTier;
  available: boolean;
  verificationStatus: SourceRecord['verificationStatus'];
  retrievedAt: string | null;
  lastUpdatedAt: string | null;
  ageDays: number | null;
  freshness: FreshnessLabel;
  confidence: number | null;
  completeness: number | null;
}

export type IndicatorState = 'STRONG' | 'GOOD' | 'MODERATE' | 'WEAK' | 'NOT_AVAILABLE' | 'NEEDS_REVIEW';

export interface HealthIndicator {
  key: string;
  label: string;
  state: IndicatorState;
  display: string;
  assertion: AssertionKind;
  detail: string;
  evidence: EvidenceRef[];
}

export interface ScoreComponent {
  key: string;
  label: string;
  weight: number; // 0..1 (sum = 1)
  score: number | null; // 0..100 ; null = not available (excluded, weight redistributed)
  rationale: string;
  evidence: EvidenceRef[];
}

export interface ProfileScore {
  configVersion: string;
  total: number | null;
  coverage: number; // share of weight that had data
  components: ScoreComponent[];
  computedAt: string;
  disclaimer: string;
}

export interface SummaryLine {
  key: string;
  label: string;
  value: string;
  tone: 'good' | 'neutral' | 'warn' | 'bad' | 'muted';
  assertion: AssertionKind;
  evidence: EvidenceRef[];
}

export interface FinancialCapacity {
  status: 'INSUFFICIENT' | 'PARTIAL' | 'AVAILABLE';
  statement: string;
  inputs: Array<{ key: string; label: string; available: boolean; assertion?: AssertionKind; value?: string | null }>;
}

export interface Assessment {
  engineVersion: string;
  computedAt: string;
  identityChecks: IdentityCheck[];
  riskSignals: RiskSignal[];
  dataQuality: DataQualityRow[];
  health: HealthIndicator[];
  score: ProfileScore;
  summary: SummaryLine[];
  capacity: FinancialCapacity;
  overall: {
    profileStatus: 'VERIFIED' | 'NEEDS_REVIEW' | 'PARTIAL' | 'PENDING';
    riskLevel: Severity | 'NONE';
    completeness: number; // 0..1
    freshness: FreshnessLabel;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    needsReview: string[]; // human-readable list of what needs review
    missing: string[];
  };
}
