/** Phase-2 row shapes (mirror supabase/migrations/0002_wealth_os.sql) and engine contracts. */

export type EvidenceClass = 'VERIFIED' | 'CLIENT_DECLARED' | 'OFFICIAL_PUBLIC_RECORD' | 'AUTHORIZED_THIRD_PARTY' | 'DERIVED_ESTIMATE' | 'POSSIBLE_ASSOCIATION' | 'ANALYST_PROVIDED';
export type Confidence = 'VERIFIED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
export type OwnershipScope = 'PERSONAL' | 'JOINT' | 'SPOUSE' | 'HUF' | 'FAMILY_COMPANY' | 'TRUST' | 'INHERITED' | 'FAMILY_LINKED';
export type AssetCategory = 'REAL_ESTATE' | 'BUSINESS_INTEREST' | 'FINANCIAL_INVESTMENT' | 'MUTUAL_FUND' | 'SECURITY' | 'DEPOSIT' | 'CASH' | 'RETIREMENT' | 'INSURANCE' | 'VEHICLE' | 'LUXURY' | 'OTHER';
export type ValuationBasis = 'REGISTERED_TRANSACTION' | 'OFFICIAL_GUIDELINE' | 'ESTIMATED_MARKET' | 'STATEMENT' | 'NAV' | 'INSURED_VALUE' | 'DECLARED' | 'NOT_VALUED';
export type Liquidity = 'LIQUID' | 'SEMI_LIQUID' | 'ILLIQUID';

export const EVIDENCE_LABEL: Record<EvidenceClass, string> = {
  VERIFIED: 'Verified',
  CLIENT_DECLARED: 'Client declared',
  OFFICIAL_PUBLIC_RECORD: 'Official public record',
  AUTHORIZED_THIRD_PARTY: 'Authorised third-party data',
  DERIVED_ESTIMATE: 'Derived estimate',
  POSSIBLE_ASSOCIATION: 'Possible association',
  ANALYST_PROVIDED: 'Analyst provided',
};

/** Evidence classes that may contribute to a net-worth figure. Possible associations never do. */
export const COUNTABLE_EVIDENCE: EvidenceClass[] = ['VERIFIED', 'OFFICIAL_PUBLIC_RECORD', 'AUTHORIZED_THIRD_PARTY', 'DERIVED_ESTIMATE', 'CLIENT_DECLARED'];
export const RELIABLE_EVIDENCE: EvidenceClass[] = ['VERIFIED', 'OFFICIAL_PUBLIC_RECORD', 'AUTHORIZED_THIRD_PARTY'];

export interface AssetRow {
  id: string;
  client_id: string;
  category: AssetCategory;
  subtype: string | null;
  title: string;
  details: Record<string, unknown>;
  value_low: number | null;
  value_mid: number | null;
  value_high: number | null;
  currency: string;
  valuation_basis: ValuationBasis;
  valuation_date: string | null;
  pricing_source: string | null;
  valuation_method: string | null;
  liquidity: Liquidity;
  evidence_class: EvidenceClass;
  confidence: Confidence;
  ownership_scope: OwnershipScope;
  ownership_pct: number | null;
  is_inherited: boolean;
  encumbered: boolean | null;
  linked_liability_id: string | null;
  acquired_on: string | null;
  disposed_on: string | null;
  source_key: string;
  status: string;
}

export interface LiabilityRow {
  id: string;
  client_id: string;
  liability_type: string;
  lender: string | null;
  original_amount: number | null;
  outstanding: number | null;
  monthly_obligation: number | null;
  interest_rate: number | null;
  opened_on: string | null;
  maturity_on: string | null;
  collateral: string | null;
  linked_asset_id: string | null;
  secured: boolean | null;
  repayment_status: string | null;
  days_past_due: number | null;
  role: string;
  evidence_class: EvidenceClass;
  confidence: Confidence;
  source_key: string;
  status: string;
}

export interface BureauReportRow {
  id: string;
  bureau: string;
  score: number | null;
  report_date: string | null;
  score_history: Array<{ date: string; score: number }>;
  credit_age_months: number | null;
  total_accounts: number | null;
  active_accounts: number | null;
  closed_accounts: number | null;
  secured_loans: number | null;
  unsecured_loans: number | null;
  credit_cards: number | null;
  sanctioned_total: number | null;
  outstanding_total: number | null;
  utilization: number | null;
  emi_total: number | null;
  dpd_30_count: number | null;
  dpd_60_count: number | null;
  dpd_90_count: number | null;
  missed_payments_12m: number | null;
  write_offs: number | null;
  settlements: number | null;
  defaults: number | null;
  restructured: number | null;
  enquiries_6m: number | null;
  enquiries_12m: number | null;
  oldest_account_on: string | null;
  newest_account_on: string | null;
  accounts: Array<{ type: string; lender: string; secured: boolean; opened: string; closed?: string | null; status: string; sanctioned: number; outstanding: number; emi?: number | null; dpd?: number; history?: Array<{ period: string; status: string }> }>;
  enquiries: Array<{ date: string; lender: string; purpose: string }>;
  evidence_class: EvidenceClass;
  source_key: string;
  retrieved_at: string;
}

export interface CashFlowRow {
  period: string;
  inflows: number | null;
  outflows: number | null;
  salary_credits: number | null;
  other_income: number | null;
  investment_transfers: number | null;
  debt_payments: number | null;
  essential_spend: number | null;
  discretionary_spend: number | null;
  cash_withdrawals: number | null;
  large_inflows: Array<{ date: string; amount: number; label: string }>;
  large_outflows: Array<{ date: string; amount: number; label: string }>;
  returned_transactions: number | null;
  categories: Record<string, number>;
  evidence_class: EvidenceClass;
  source_key: string;
}

export interface BankRelationshipRow {
  bank_name: string;
  account_type: string | null;
  balance: number | null;
  avg_monthly_balance: number | null;
  balance_date: string | null;
  evidence_class: EvidenceClass;
}

export interface FamilyLinkRow {
  id: string;
  name: string;
  relation: string;
  evidence_class: EvidenceClass;
  confidence: Confidence;
  entitlement: string | null;
  note: string | null;
}

export interface LegalMatterRow {
  id: string;
  case_number: string | null;
  court: string | null;
  jurisdiction: string | null;
  case_type: string | null;
  category: string | null;
  parties: Array<{ name: string; role: string }>;
  client_role: string | null;
  subject_kind: string;
  filing_date: string | null;
  status: string | null;
  latest_order_date: string | null;
  amount_involved: number | null;
  source_key: string;
  evidence_class: EvidenceClass;
  identity_confidence: number | null;
  match_status: string | null;
  review_status: string;
}

export interface InteractionRow {
  id: string;
  occurred_at: string;
  channel: string;
  direction: string;
  kind: string;
  summary: string;
  questions: string[];
  objections: string[];
  interests: string[];
  concerns: string[];
  commitments: string[];
  products_discussed: string[];
  client_declared_changes: string[];
  follow_up_at: string | null;
  outcome: string | null;
  decline_reason: string | null;
  response_time_hours: number | null;
}

export interface InterestRow {
  category: string;
  stance: 'INTERESTED' | 'NOT_INTERESTED' | 'UNKNOWN';
  evidence_class: EvidenceClass;
  source: string | null;
  note: string | null;
}

export interface ContactControlsRow {
  do_not_contact: boolean;
  preferred_channel: string | null;
  preferred_frequency_days: number | null;
  marketing_permission: boolean;
  preferred_format: string | null;
  last_contact_at: string | null;
}

export interface FundSourceRow {
  id: string;
  kind: 'SOURCE_OF_FUNDS' | 'SOURCE_OF_WEALTH';
  category: string;
  description: string | null;
  amount: number | null;
  evidence_class: EvidenceClass;
  status: string;
}

export interface WealthEventRow {
  id: string;
  occurred_on: string;
  event_type: string;
  title: string;
  amount: number | null;
  asset_id: string | null;
  liability_id: string | null;
  evidence: Record<string, unknown>;
  evidence_class: EvidenceClass;
  source_key: string;
}

export interface HumanInputRow {
  id: string;
  category: string;
  source_type: string;
  body: string;
  attributed_to: string | null;
  author_confidence: string;
  first_hand: boolean;
  client_confirmed: boolean;
  has_evidence: boolean;
  related_company: string | null;
  related_property: string | null;
  status: string;
  verification_result: Record<string, unknown> | null;
  author_id: string;
  created_at: string;
}

export interface PropertyPreferencesRow {
  buyer_type: 'END_USER' | 'INVESTOR' | 'MIXED_UNKNOWN';
  buyer_type_basis: string | null;
  purpose: string | null;
  budget_min: number | null;
  budget_max: number | null;
  cities: string[];
  districts: string[];
  localities: string[];
  property_types: string[];
  plot_size_min_sqft: number | null;
  plot_size_max_sqft: number | null;
  facing: string[];
  road_width_min_ft: number | null;
  corner_preferred: boolean | null;
  approval_required: boolean;
  proximity: string[];
  horizon: string | null;
  financing: string | null;
  field_evidence: Record<string, { evidence_class: EvidenceClass; source: string; date?: string }>;
  declared_at?: string | null;
}

export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  project_type: string;
  approval_authority: string | null;
  approval_number: string | null;
  approval_status: string | null;
  rera_number: string | null;
  survey_numbers: string[];
  city: string;
  district: string | null;
  state: string;
  locality: string | null;
  lat: number | null;
  lng: number | null;
  total_area_acres: number | null;
  plots_total: number | null;
  road_widths_ft: number[];
  amenities: string[];
  osr_pct: number | null;
  utilities: Record<string, string>;
  infrastructure: Array<{ name: string; kind: string; status: 'EXISTING' | 'UNDER_CONSTRUCTION' | 'PROPOSED' | 'ANNOUNCED'; distance_km: number | null; source: string }>;
  geo: Record<string, unknown>;
  price_per_sqft: number | null;
  price_history: Array<{ date: string; price_per_sqft: number }>;
  guideline_value_per_sqft: number | null;
  comparables: Array<{ project: string; price_per_sqft: number; date: string; source: string }>;
  launch_price_per_sqft: number | null;
  thesis: string | null;
  documents: Array<{ name: string; type: string; status: string }>;
  status: string;
}

export interface PlotRow {
  id: string;
  project_id: string;
  plot_number: string;
  area_sqft: number;
  width_ft: number | null;
  depth_ft: number | null;
  facing: string | null;
  road_width_ft: number | null;
  corner: boolean;
  park_facing: boolean;
  near_entrance: boolean;
  status: 'AVAILABLE' | 'HELD' | 'RESERVED' | 'BOOKED' | 'REGISTERED' | 'CANCELLED';
  price: number | null;
  negotiated_price: number | null;
}

export interface DdItemRow {
  project_id: string | null;
  item_key: string;
  status: 'VERIFIED' | 'PENDING' | 'NOT_AVAILABLE' | 'POTENTIAL_ISSUE' | 'CRITICAL_ISSUE';
  finding: string | null;
}

export interface AifFundRow {
  id: string;
  name: string;
  category: string;
  strategy: string | null;
  thesis: string | null;
  min_commitment: number;
  lock_in_years: number | null;
  tenure_years: number | null;
  fees: Record<string, unknown>;
  risk_factors: string[];
  status: string;
  closing_date: string | null;
}

export interface AifSuitabilityRow {
  stage: string;
  investor_classification: string | null;
  questionnaire: Record<string, unknown>;
  risk_profile: string | null;
  risk_profile_basis: string | null;
  horizon: string | null;
  liquidity_needs: string | null;
  expected_amount: number | null;
  sof_status: string;
  sow_status: string;
  kyc_status: string;
  aml_status: string;
  sanctions_status: string;
  pep_status: string;
  beneficial_owner_status: string;
  bank_verified: boolean;
  risk_acknowledged: boolean;
  documents_executed: boolean;
  compliance_approved_at: string | null;
  investment_approved_at: string | null;
  fund_id: string | null;
  commitment_amount: number | null;
}

export interface ClientDocumentRow {
  id: string;
  room: string;
  doc_type: string;
  title: string;
  storage_bucket: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  version: number;
  number_masked: string | null;
  sensitive_value_id: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_authority: string | null;
  name_on_document: string | null;
  dob_on_document: string | null;
  address_on_document: string | null;
  extracted: Record<string, unknown>;
  extraction_status: string;
  classification: Record<string, unknown>;
  quality: Record<string, unknown>;
  tamper_signals: Array<{ signal: string; detail: string }>;
  consistency: Array<{ check: string; status: string; left: string | null; right: string | null; explanation: string }>;
  status: string;
  review_status: string;
  access_level: string;
  evidence_class: EvidenceClass;
  upload_source: string;
  uploaded_by: string | null;
  uploaded_at: string;
  refresh_due_on: string | null;
  duplicate_of: string | null;
}

/** Everything the Analyze / Approach engines are allowed to see, already separated by evidence layer. */
export interface ClientIntelligenceContext {
  clientId: string;
  displayName: string;
  now: Date;
  verified: {
    incomeAnnual: number | null; // from verification (returned/verified income)
    incomeEvidence: EvidenceClass | null;
    employmentCurrent: boolean | null;
    employmentTenureMonths: number | null;
    employerName: string | null;
    creditScore: number | null;
    identityConsistency: 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_AVAILABLE';
    addressConsistency: 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_AVAILABLE';
    contactConsistency: 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_AVAILABLE';
    verificationConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
    profileScore: number | null;
    openRiskSignals: Array<{ title: string; severity: string; requiresReview: boolean }>;
    freshness: string | null;
    completeness: number | null;
  };
  assets: AssetRow[];
  liabilities: LiabilityRow[];
  bureau: BureauReportRow | null;
  cashFlow: CashFlowRow[];
  banks: BankRelationshipRow[];
  family: FamilyLinkRow[];
  legal: LegalMatterRow[];
  fundSources: FundSourceRow[];
  events: WealthEventRow[];
  interactions: InteractionRow[];
  interests: InterestRow[];
  contact: ContactControlsRow | null;
  investorProfile: { objectives: string[]; horizon: string | null; liquidity: string | null; riskTolerance: string | null; experience: string | null; incomeRange: string | null; netWorthRange: string | null; sourceOfFunds: string | null; sourceOfWealth: string | null; expectedAmount: number | null; preferences: string[]; confirmed: boolean } | null;
  propertyPreferences: PropertyPreferencesRow | null;
  aifSuitability: AifSuitabilityRow | null;
  /** Human context is passed ONLY so the engine can list what needs verification. It never feeds a score. */
  humanInputs: HumanInputRow[];
  documents: ClientDocumentRow[];
  externalPending: number;
}

export interface Evidenced<T> {
  value: T;
  confidence: Confidence;
  basis: string; // one sentence: how this was derived
  evidence: Array<{ label: string; source: string; value?: string | null; path?: string | null }>;
  evidenceClass: EvidenceClass | 'OBSERVED_PATTERN' | 'AI_INTERPRETATION' | 'INSUFFICIENT_DATA';
  missing?: string[];
}
