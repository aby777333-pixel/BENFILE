-- BENFILE phase 2: wealth, assets, liabilities, credit console, cash flow, family wealth, legal,
-- human-input sandbox, document centre, analysis versions, business approach, CRM interactions,
-- AIF + property verticals (funds, projects, plots, preferences, site visits, landowners),
-- opportunity scores, triggers, tasks, compliance rules, freshness windows, anomalies, storage.

-- ------------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------------
create type evidence_class as enum ('VERIFIED','CLIENT_DECLARED','OFFICIAL_PUBLIC_RECORD','AUTHORIZED_THIRD_PARTY','DERIVED_ESTIMATE','POSSIBLE_ASSOCIATION','ANALYST_PROVIDED');
create type confidence_level as enum ('VERIFIED','HIGH','MEDIUM','LOW','INSUFFICIENT');
create type ownership_scope as enum ('PERSONAL','JOINT','SPOUSE','HUF','FAMILY_COMPANY','TRUST','INHERITED','FAMILY_LINKED');
create type asset_category as enum ('REAL_ESTATE','BUSINESS_INTEREST','FINANCIAL_INVESTMENT','MUTUAL_FUND','SECURITY','DEPOSIT','CASH','RETIREMENT','INSURANCE','VEHICLE','LUXURY','OTHER');
create type valuation_basis as enum ('REGISTERED_TRANSACTION','OFFICIAL_GUIDELINE','ESTIMATED_MARKET','STATEMENT','NAV','INSURED_VALUE','DECLARED','NOT_VALUED');
create type liquidity_class as enum ('LIQUID','SEMI_LIQUID','ILLIQUID');
create type human_source as enum ('FIRST_HAND_OBSERVATION','CLIENT_DECLARED','THIRD_PARTY_STATEMENT','INTRODUCER_STATEMENT','RM_OPINION','UNVERIFIED_MARKET_INFORMATION','RUMOUR','UNKNOWN_SOURCE');
create type human_category as enum ('PERSONAL_OBSERVATION','CLIENT_SAID','THIRD_PARTY_SAID','MARKET_FEEDBACK','COMMERCIAL_IMPRESSION','POSSIBLE_RISK','OPPORTUNITY_NOTE','RELATIONSHIP_NOTE','OTHER');
create type human_status as enum ('OPEN','VERIFY_REQUESTED','VERIFIED','NOT_VERIFIED','POSSIBLE_MATCH','CONTRADICTED','ARCHIVED');
create type doc_status as enum ('UPLOADED','EXTRACTION_PENDING','EXTRACTED','UNDER_REVIEW','VERIFIED','REJECTED','REPLACEMENT_REQUIRED','EXPIRED','UNREADABLE');
create type doc_access as enum ('MASKED','KYC','PROPERTY_LEGAL','INVESTMENT_COMPLIANCE','GENERAL');
create type plot_status as enum ('AVAILABLE','HELD','RESERVED','BOOKED','REGISTERED','CANCELLED');
create type buyer_type as enum ('END_USER','INVESTOR','MIXED_UNKNOWN');
create type stance as enum ('INTERESTED','NOT_INTERESTED','UNKNOWN');

-- ------------------------------------------------------------------
-- Consent ledger extensions
-- ------------------------------------------------------------------
alter table consents
  add column if not exists data_categories text[] not null default '{}',
  add column if not exists permitted_actions text[] not null default '{}',
  add column if not exists legal_basis text,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists initiated_by uuid references staff_profiles(user_id);

-- Client extensions: profile mode, client type, HNI flag (evidence-based, never assumed)
alter table clients
  add column if not exists client_type text not null default 'INDIVIDUAL',
  add column if not exists hni_mode boolean not null default false,
  add column if not exists photo_document_id uuid,
  add column if not exists preferred_language text default 'en';

-- ------------------------------------------------------------------
-- Assets (canonical entities) + source records for cross-source resolution
-- ------------------------------------------------------------------
create table assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  category asset_category not null,
  subtype text,
  title text not null,
  details jsonb not null default '{}',          -- category-specific structured fields (survey no., CIN, folio, reg no...)
  value_low numeric,
  value_mid numeric,
  value_high numeric,
  currency text not null default 'INR',
  valuation_basis valuation_basis not null default 'NOT_VALUED',
  valuation_date date,
  pricing_source text,
  valuation_method text,
  liquidity liquidity_class not null default 'ILLIQUID',
  evidence_class evidence_class not null default 'CLIENT_DECLARED',
  confidence confidence_level not null default 'LOW',
  ownership_scope ownership_scope not null default 'PERSONAL',
  ownership_pct numeric(6,3),
  is_inherited boolean not null default false,
  encumbered boolean,
  linked_liability_id uuid,
  acquired_on date,
  disposed_on date,
  source_key text not null default 'ANALYST',
  dedupe_key text,
  status text not null default 'ACTIVE',         -- ACTIVE | DISPOSED | DISPUTED | REJECTED
  created_by uuid references staff_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, dedupe_key)
);
create index assets_client_idx on assets(client_id, category, status);

create table asset_source_records (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  source_key text not null,
  source_class source_class not null,
  tier smallint not null,
  record jsonb not null,
  record_id text,
  match_confidence integer,
  conflicting_fields jsonb not null default '[]',
  retrieved_at timestamptz not null default now()
);
create index asr_asset_idx on asset_source_records(asset_id);

-- Asset value history (never discard)
create table asset_valuations (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  basis valuation_basis not null,
  value_low numeric,
  value_mid numeric,
  value_high numeric,
  valuation_date date not null,
  pricing_source text,
  methodology text,
  comparable_date date,
  location text,
  confidence confidence_level not null default 'LOW',
  created_by uuid references staff_profiles(user_id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Liabilities
-- ------------------------------------------------------------------
create table liabilities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  liability_type text not null,                 -- HOME_LOAN, VEHICLE_LOAN, PERSONAL_LOAN, CREDIT_CARD, LAP, GOLD_LOAN, OD, GUARANTEE, ...
  lender text,
  original_amount numeric,
  outstanding numeric,
  monthly_obligation numeric,
  interest_rate numeric,
  opened_on date,
  maturity_on date,
  collateral text,
  linked_asset_id uuid references assets(id) on delete set null,
  secured boolean,
  repayment_status text,                        -- REGULAR | DPD_30 | DPD_60 | DPD_90 | SETTLED | WRITTEN_OFF | CLOSED | RESTRUCTURED
  days_past_due integer,
  role text not null default 'BORROWER',        -- BORROWER | CO_BORROWER | GUARANTOR | DIRECTOR_GUARANTOR
  evidence_class evidence_class not null default 'CLIENT_DECLARED',
  confidence confidence_level not null default 'LOW',
  source_key text not null default 'ANALYST',
  status text not null default 'ACTIVE',
  created_by uuid references staff_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index liabilities_client_idx on liabilities(client_id, status);

-- ------------------------------------------------------------------
-- Credit bureau reports (Credit Health Console - never reduced to one score)
-- ------------------------------------------------------------------
create table credit_bureau_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  run_id uuid references verification_runs(id) on delete set null,
  bureau text not null,
  score integer,
  report_date date,
  score_history jsonb not null default '[]',   -- [{date, score}]
  credit_age_months integer,
  total_accounts integer,
  active_accounts integer,
  closed_accounts integer,
  secured_loans integer,
  unsecured_loans integer,
  credit_cards integer,
  sanctioned_total numeric,
  outstanding_total numeric,
  utilization numeric,
  emi_total numeric,
  dpd_30_count integer,
  dpd_60_count integer,
  dpd_90_count integer,
  missed_payments_12m integer,
  write_offs integer,
  settlements integer,
  defaults integer,
  restructured integer,
  enquiries_6m integer,
  enquiries_12m integer,
  oldest_account_on date,
  newest_account_on date,
  accounts jsonb not null default '[]',        -- [{type, lender, secured, opened, closed, status, sanctioned, outstanding, emi, dpd, history:[{period,status}]}]
  enquiries jsonb not null default '[]',
  evidence_class evidence_class not null default 'AUTHORIZED_THIRD_PARTY',
  source_key text not null default 'CREDIT',
  retrieved_at timestamptz not null default now()
);
create index cbr_client_idx on credit_bureau_reports(client_id, report_date desc);

-- ------------------------------------------------------------------
-- Cash flow (consented banking / account aggregation)
-- ------------------------------------------------------------------
create table bank_relationships (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  bank_name text not null,
  account_type text,                            -- SAVINGS | CURRENT | SALARY | FD | RD | OD
  account_masked text,
  balance numeric,
  avg_monthly_balance numeric,
  balance_date date,
  evidence_class evidence_class not null default 'AUTHORIZED_THIRD_PARTY',
  source_key text not null default 'AA',
  consent_id uuid references consents(id) on delete set null,
  retrieved_at timestamptz not null default now()
);

create table cash_flow_periods (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  period text not null,                         -- YYYY-MM
  inflows numeric,
  outflows numeric,
  salary_credits numeric,
  other_income numeric,
  investment_transfers numeric,
  debt_payments numeric,
  essential_spend numeric,
  discretionary_spend numeric,
  cash_withdrawals numeric,
  large_inflows jsonb not null default '[]',
  large_outflows jsonb not null default '[]',
  returned_transactions integer,
  categories jsonb not null default '{}',      -- {HOUSING: n, GROCERIES: n, ...}
  evidence_class evidence_class not null default 'AUTHORIZED_THIRD_PARTY',
  source_key text not null default 'AA',
  consent_id uuid references consents(id) on delete set null,
  retrieved_at timestamptz not null default now(),
  unique (client_id, period, source_key)
);

-- ------------------------------------------------------------------
-- Family wealth (separate), legal matters, source of funds / wealth, wealth timeline
-- ------------------------------------------------------------------
create table family_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  relation text not null,
  evidence_class evidence_class not null default 'CLIENT_DECLARED',
  confidence confidence_level not null default 'LOW',
  entitlement text,                             -- BENEFICIAL_OWNER | INHERITANCE_ENTITLEMENT | TRUST_INTEREST | NONE_KNOWN
  note text,
  source_key text not null default 'ANALYST',
  created_at timestamptz not null default now()
);

create table legal_matters (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  finding_id uuid references external_findings(id) on delete set null,
  case_number text,
  court text,
  jurisdiction text,
  case_type text,
  category text,                                -- CIVIL | COMMERCIAL | PROPERTY | RECOVERY | CHEQUE | INSOLVENCY | COMPANY_LAW | CONSUMER | TAX | ARBITRATION | REGULATORY | CRIMINAL_COMPLAINT
  parties jsonb not null default '[]',
  client_role text,
  subject_kind text not null default 'PERSON',  -- PERSON | ASSOCIATED_COMPANY
  filing_date date,
  status text,
  latest_order_date date,
  orders jsonb not null default '[]',
  amount_involved numeric,
  source_key text not null,
  evidence_class evidence_class not null default 'OFFICIAL_PUBLIC_RECORD',
  identity_confidence integer,
  match_status text,
  review_status text not null default 'PENDING',
  reviewed_by uuid references staff_profiles(user_id),
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index legal_client_idx on legal_matters(client_id, review_status);

create table fund_sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  kind text not null,                           -- SOURCE_OF_FUNDS | SOURCE_OF_WEALTH
  category text not null,
  description text,
  amount numeric,
  evidence_document_id uuid,
  evidence_class evidence_class not null default 'CLIENT_DECLARED',
  status text not null default 'DECLARED',      -- DECLARED | EVIDENCE_REQUESTED | EVIDENCED | VERIFIED | REJECTED
  created_by uuid references staff_profiles(user_id),
  created_at timestamptz not null default now()
);

create table wealth_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  occurred_on date not null,
  event_type text not null,                     -- PROPERTY_PURCHASE | LOAN_OPENED | LOAN_CLOSED | DIRECTORSHIP | INHERITANCE | INVESTMENT | SALE | ...
  title text not null,
  amount numeric,
  asset_id uuid references assets(id) on delete set null,
  liability_id uuid references liabilities(id) on delete set null,
  evidence jsonb not null default '{}',
  evidence_class evidence_class not null default 'CLIENT_DECLARED',
  source_key text not null default 'ANALYST',
  created_at timestamptz not null default now()
);
create index wealth_events_client_idx on wealth_events(client_id, occurred_on desc);

-- ------------------------------------------------------------------
-- Human input sandbox (context, never fact)
-- ------------------------------------------------------------------
create table human_inputs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  category human_category not null,
  source_type human_source not null,
  body text not null,
  attributed_to text,
  author_confidence text not null default 'LOW', -- VERY_LOW | LOW | MEDIUM | HIGH (author confidence only)
  first_hand boolean not null default false,
  client_confirmed boolean not null default false,
  has_evidence boolean not null default false,
  related_company text,
  related_property text,
  related_transaction text,
  related_meeting_id uuid,
  related_document_id uuid,
  status human_status not null default 'OPEN',
  verification_result jsonb,
  verification_task_id uuid,
  author_id uuid not null references staff_profiles(user_id),
  created_at timestamptz not null default now(),
  language text default 'en'
);
create index human_inputs_client_idx on human_inputs(client_id, status);

-- ------------------------------------------------------------------
-- Document centre + photos (Supabase Storage backed)
-- ------------------------------------------------------------------
create table client_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  room text not null default 'KYC',             -- KYC | PROPERTY | AIF | FINANCIAL | GENERAL
  doc_type text not null,
  title text not null,
  storage_bucket text not null default 'client-documents',
  storage_path text,
  mime_type text,
  size_bytes integer,
  sha256 text,
  version integer not null default 1,
  supersedes_id uuid references client_documents(id) on delete set null,
  number_masked text,
  sensitive_value_id uuid,
  issue_date date,
  expiry_date date,
  issuing_authority text,
  country text default 'IN',
  name_on_document text,
  dob_on_document date,
  address_on_document text,
  extracted jsonb not null default '{}',
  extraction_status text not null default 'PENDING', -- PENDING | MANUAL | PARSED | PROVIDER
  classification jsonb not null default '{}',
  quality jsonb not null default '{}',
  tamper_signals jsonb not null default '[]',
  consistency jsonb not null default '[]',      -- [{check, status, left, right, explanation}]
  status doc_status not null default 'UPLOADED',
  review_status text not null default 'PENDING',
  access_level doc_access not null default 'KYC',
  evidence_class evidence_class not null default 'CLIENT_DECLARED',
  source_class source_class not null default 'USER_SUPPLIED_DOCUMENT',
  verification_provider text,
  verification_status text,
  consent_id uuid references consents(id) on delete set null,
  upload_source text not null default 'STAFF',  -- STAFF | CLIENT_PORTAL | PROVIDER
  uploaded_by uuid references staff_profiles(user_id),
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid references staff_profiles(user_id),
  reviewed_at timestamptz,
  review_note text,
  duplicate_of uuid references client_documents(id) on delete set null,
  refresh_due_on date
);
create index client_documents_client_idx on client_documents(client_id, room, status);
create index client_documents_sha_idx on client_documents(sha256);

create table client_photos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  purpose text not null default 'PROFILE',      -- PROFILE | ID_VERIFICATION | SELFIE
  storage_bucket text not null default 'client-photos',
  storage_path text not null,
  mime_type text,
  size_bytes integer,
  sha256 text,
  quality jsonb not null default '{}',          -- {width,height,blur?,glare?,faces?} operational only
  verification_status text not null default 'NOT_VERIFIED',
  verification_provider text,
  consent_id uuid references consents(id) on delete set null,
  upload_source text not null default 'STAFF',
  uploaded_by uuid references staff_profiles(user_id),
  uploaded_at timestamptz not null default now(),
  is_current boolean not null default true
);

-- ------------------------------------------------------------------
-- Versioned analyses & approach strategies
-- ------------------------------------------------------------------
create table client_analyses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  version integer not null,
  engine_version text not null,
  inputs jsonb not null,                        -- {verifiedSources, declaredSources, humanContextItems, humanInfluence:'NONE', ...}
  result jsonb not null,
  diff jsonb,
  computed_by uuid references staff_profiles(user_id),
  computed_at timestamptz not null default now(),
  unique (client_id, version)
);

create table approach_strategies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  version integer not null,
  objective text not null,
  engine_version text not null,
  result jsonb not null,
  confidence text not null,
  computed_by uuid references staff_profiles(user_id),
  computed_at timestamptz not null default now(),
  unique (client_id, version)
);

-- ------------------------------------------------------------------
-- CRM: interactions, interests, contact controls, tasks, triggers
-- ------------------------------------------------------------------
create table interactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  channel text not null,                        -- PHONE | WHATSAPP | EMAIL | VIDEO | IN_PERSON | PORTAL | SITE_VISIT
  direction text not null default 'OUTBOUND',   -- INBOUND | OUTBOUND
  kind text not null default 'CALL',            -- CALL | MEETING | MESSAGE | PROPOSAL | DOCUMENT_SENT | SITE_VISIT | FOLLOW_UP
  summary text not null,
  questions text[] not null default '{}',
  objections text[] not null default '{}',
  interests text[] not null default '{}',
  concerns text[] not null default '{}',
  commitments text[] not null default '{}',
  products_discussed text[] not null default '{}',
  client_declared_changes text[] not null default '{}',
  follow_up_at timestamptz,
  outcome text,                                 -- PROGRESSED | DECLINED | NO_RESPONSE | CONVERTED | PENDING
  decline_reason text,
  language text default 'en',
  original_text text,
  response_time_hours numeric,
  author_id uuid references staff_profiles(user_id),
  created_at timestamptz not null default now()
);
create index interactions_client_idx on interactions(client_id, occurred_at desc);

create table client_interests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  category text not null,                       -- EQUITIES | MUTUAL_FUNDS | REAL_ESTATE | FIXED_INCOME | AIF | PMS | PRIVATE_EQUITY | STARTUPS | GOLD | INTERNATIONAL | INSURANCE | RETIREMENT | TAX_PLANNING | ESTATE_PLANNING | BUSINESS_INVESTMENTS | LAND | PLOTS | COMMERCIAL_PROPERTY | SHORT_TERM_TRADING | HIGH_LEVERAGE
  stance stance not null default 'UNKNOWN',
  evidence_class evidence_class not null default 'CLIENT_DECLARED',
  source text,
  note text,
  updated_by uuid references staff_profiles(user_id),
  updated_at timestamptz not null default now(),
  unique (client_id, category)
);

create table contact_controls (
  client_id uuid primary key references clients(id) on delete cascade,
  do_not_contact boolean not null default false,
  preferred_channel text,
  preferred_frequency_days integer,
  marketing_permission boolean not null default false,
  preferred_language text default 'en',
  preferred_format text,
  reporting_frequency text,
  last_contact_at timestamptz,
  updated_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  title text not null,
  task_type text not null default 'FOLLOW_UP',  -- FOLLOW_UP | CALL | MEETING | DOCUMENT_REQUEST | REVERIFY | SITE_VISIT | PROPOSAL | KYC | REVIEW
  due_at timestamptz,
  assigned_to uuid references staff_profiles(user_id),
  status text not null default 'OPEN',          -- OPEN | DONE | CANCELLED
  priority text not null default 'NORMAL',
  source text not null default 'MANUAL',        -- MANUAL | NEXT_BEST_ACTION | TRIGGER | HUMAN_INPUT
  reason text,
  created_by uuid references staff_profiles(user_id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index tasks_assigned_idx on tasks(assigned_to, status, due_at);

create table opportunity_triggers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  trigger_type text not null,                   -- FD_MATURITY | LOAN_CLOSURE | PROPERTY_SALE | AIF_DISTRIBUTION | FUND_CLOSING | SITE_VISIT_DONE | KYC_COMPLETE | PROPOSAL_VIEWED | CALLBACK_DATE | CONCENTRATION | ...
  title text not null,
  source_key text not null,
  evidence jsonb not null default '{}',
  event_date date,
  confidence confidence_level not null default 'MEDIUM',
  recommended_action text,
  sensitive boolean not null default false,     -- inheritance, illness etc: never auto-contact
  status text not null default 'OPEN',
  created_at timestamptz not null default now()
);

create table opportunity_scores (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  vertical text not null,                       -- AIF | PROPERTY | ENGAGEMENT
  score integer,
  relevance text,                               -- HIGH | MEDIUM | LOW | INSUFFICIENT
  reasons jsonb not null default '[]',
  evidence jsonb not null default '[]',
  missing jsonb not null default '[]',
  confidence text not null default 'LOW',
  computed_at timestamptz not null default now(),
  unique (client_id, vertical)
);

-- ------------------------------------------------------------------
-- AIF vertical: funds, suitability journey, compliance rules
-- ------------------------------------------------------------------
create table aif_funds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,                       -- CAT_I | CAT_II | CAT_III
  strategy text,
  thesis text,
  min_commitment numeric not null,
  lock_in_years numeric,
  tenure_years numeric,
  target_size numeric,
  fees jsonb not null default '{}',             -- {management, performance, hurdle, setup}
  risk_factors text[] not null default '{}',
  status text not null default 'OPEN',          -- OPEN | CLOSING | CLOSED
  closing_date date,
  documents jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table aif_suitability (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  stage text not null default 'CLIENT_INTELLIGENCE', -- journey stage key
  investor_classification text,                 -- INDIVIDUAL | HNI | ACCREDITED | INSTITUTIONAL | NOT_ASSESSED
  questionnaire jsonb not null default '{}',    -- client-declared suitability answers
  risk_profile text,
  risk_profile_basis text,
  horizon text,
  liquidity_needs text,
  expected_amount numeric,
  sof_status text not null default 'PENDING',
  sow_status text not null default 'PENDING',
  kyc_status text not null default 'PENDING',
  aml_status text not null default 'PENDING',
  sanctions_status text not null default 'PENDING',
  pep_status text not null default 'PENDING',
  beneficial_owner_status text not null default 'PENDING',
  bank_verified boolean not null default false,
  fatca_crs jsonb not null default '{}',
  declarations jsonb not null default '{}',
  risk_acknowledged boolean not null default false,
  documents_executed boolean not null default false,
  compliance_approved_by uuid references staff_profiles(user_id),
  compliance_approved_at timestamptz,
  investment_approved_by uuid references staff_profiles(user_id),
  investment_approved_at timestamptz,
  fund_id uuid references aif_funds(id) on delete set null,
  commitment_amount numeric,
  contributions jsonb not null default '[]',
  updated_by uuid references staff_profiles(user_id),
  updated_at timestamptz not null default now(),
  unique (client_id)
);

create table compliance_rules (
  key text primary key,
  value jsonb not null,
  description text,
  version integer not null default 1,
  is_active boolean not null default true,
  updated_by uuid references staff_profiles(user_id),
  updated_at timestamptz not null default now()
);
insert into compliance_rules (key, value, description) values
  ('aif.min_commitment', '{"amount": 10000000, "currency": "INR"}', 'Minimum AIF commitment per investor (configurable; update when regulation changes)'),
  ('aif.accredited_investor', '{"net_worth": 75000000, "annual_income": 20000000, "or_liquid_net_worth": 50000000}', 'Accredited-investor thresholds used only when verified figures exist'),
  ('aif.required_documents', '["PAN","AADHAAR_MASKED","BANK_PROOF","SOURCE_OF_FUNDS","SUITABILITY_QUESTIONNAIRE","RISK_ACKNOWLEDGEMENT","FATCA_CRS"]', 'Documents required before compliance approval'),
  ('aif.required_screens', '["KYC","AML","SANCTIONS","PEP"]', 'Screens required before compliance approval'),
  ('property.min_dd_items', '["TITLE_CHAIN","PARENT_DOCUMENTS","EC","PATTA","SURVEY","APPROVAL","ACCESS","LITIGATION"]', 'Minimum legal due-diligence items before a plot may be shown as recommendable'),
  ('sales.max_contacts_7d', '{"count": 3}', 'Warn when contacts in the last 7 days exceed this'),
  ('sales.discount_approval_above_pct', '{"pct": 5}', 'Discounts above this percentage need approval');

create table freshness_windows (
  data_class text primary key,
  fresh_days integer not null,
  stale_days integer not null,
  expired_days integer not null,
  description text
);
insert into freshness_windows (data_class, fresh_days, stale_days, expired_days, description) values
  ('KYC', 365, 730, 1095, 'KYC refresh cycle'),
  ('CREDIT_REPORT', 30, 90, 180, 'Bureau report age'),
  ('EMPLOYMENT', 90, 180, 365, 'EPFO / employment verification'),
  ('BANKING', 30, 90, 180, 'Account aggregator / statements'),
  ('INVESTMENTS', 30, 90, 180, 'Portfolio statements'),
  ('PROPERTY_OWNERSHIP', 180, 365, 730, 'Property ownership records / EC'),
  ('PROPERTY_VALUATION', 180, 365, 730, 'Valuation age'),
  ('SANCTIONS', 30, 90, 180, 'Sanctions screening'),
  ('PEP', 90, 180, 365, 'PEP screening'),
  ('CORPORATE_RECORDS', 90, 180, 365, 'MCA / registry'),
  ('COURT_RECORDS', 90, 180, 365, 'Court / tribunal records'),
  ('SOURCE_OF_FUNDS', 180, 365, 730, 'Source of funds evidence'),
  ('SOURCE_OF_WEALTH', 365, 730, 1095, 'Source of wealth evidence'),
  ('CLIENT_PREFERENCES', 180, 365, 730, 'Declared preferences and suitability');

-- ------------------------------------------------------------------
-- Property vertical: projects, plots, DD, preferences, site visits, landowners
-- ------------------------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  project_type text not null default 'PLOTTED_LAYOUT', -- PLOTTED_LAYOUT | RESIDENTIAL | COMMERCIAL | LAND_PARCEL | FARM
  approval_authority text,
  approval_number text,
  approval_status text,                         -- APPROVED | PENDING | NOT_APPLICABLE
  rera_number text,
  survey_numbers text[] not null default '{}',
  city text not null,
  district text,
  state text not null default 'Tamil Nadu',
  locality text,
  lat numeric,
  lng numeric,
  total_area_acres numeric,
  plots_total integer,
  road_widths_ft integer[] not null default '{}',
  amenities text[] not null default '{}',
  osr_pct numeric,
  utilities jsonb not null default '{}',        -- {water, electricity, drainage, access_road}
  infrastructure jsonb not null default '[]',   -- [{name, kind, status: EXISTING|UNDER_CONSTRUCTION|PROPOSED|ANNOUNCED, distance_km, source}]
  geo jsonb not null default '{}',              -- {highways:[], airport_km, railway_km, it_parks:[], flood_zone, water_bodies, ht_lines, land_use}
  price_per_sqft numeric,
  price_history jsonb not null default '[]',
  guideline_value_per_sqft numeric,
  comparables jsonb not null default '[]',
  launch_price_per_sqft numeric,
  thesis text,
  documents jsonb not null default '[]',
  media jsonb not null default '[]',
  status text not null default 'ACTIVE',
  launched_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table plots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  plot_number text not null,
  survey_number text,
  area_sqft numeric not null,
  width_ft numeric,
  depth_ft numeric,
  facing text,
  road_width_ft integer,
  corner boolean not null default false,
  park_facing boolean not null default false,
  near_entrance boolean not null default false,
  status plot_status not null default 'AVAILABLE',
  price numeric,
  negotiated_price numeric,
  release_date date,
  held_for_client_id uuid references clients(id) on delete set null,
  held_until timestamptz,
  notes text,
  updated_at timestamptz not null default now(),
  unique (project_id, plot_number)
);
create index plots_project_idx on plots(project_id, status);

create table property_due_diligence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  item_key text not null,                       -- TITLE_CHAIN | PARENT_DOCUMENTS | SALE_DEED | PATTA | CHITTA | ADANGAL | FMB | SURVEY | EC | MORTGAGE | LITIGATION | ACQUISITION_NOTIFICATION | LAND_CLASSIFICATION | CONVERSION | ACCESS | RIGHT_OF_WAY | WATERBODY | FOREST | HT_LINE | CRZ | FLOOD | APPROVAL | RERA | OSR | ROAD_WIDTH | UTILITIES | REGISTRATION | PROMOTER_DOCS
  status text not null default 'PENDING',       -- VERIFIED | PENDING | NOT_AVAILABLE | POTENTIAL_ISSUE | CRITICAL_ISSUE
  finding text,
  source text,
  document_id uuid references client_documents(id) on delete set null,
  reviewer_id uuid references staff_profiles(user_id),
  checked_at timestamptz,
  unique (project_id, item_key)
);

create table property_preferences (
  client_id uuid primary key references clients(id) on delete cascade,
  buyer_type buyer_type not null default 'MIXED_UNKNOWN',
  buyer_type_basis text,
  purpose text,                                 -- SELF_USE | INVESTMENT | BOTH
  budget_min numeric,
  budget_max numeric,
  cities text[] not null default '{}',
  districts text[] not null default '{}',
  localities text[] not null default '{}',
  property_types text[] not null default '{}',  -- PLOT | LAND | VILLA | APARTMENT | COMMERCIAL | FARM
  plot_size_min_sqft numeric,
  plot_size_max_sqft numeric,
  facing text[] not null default '{}',
  road_width_min_ft integer,
  corner_preferred boolean,
  approval_required boolean not null default true,
  proximity text[] not null default '{}',       -- HIGHWAY | AIRPORT | IT_CORRIDOR | INDUSTRIAL | EDUCATION | RETIREMENT
  horizon text,
  financing text,                               -- CASH | LOAN | MIXED | UNKNOWN
  field_evidence jsonb not null default '{}',   -- {field: {evidence_class, source, date}}
  declared_at timestamptz,
  updated_by uuid references staff_profiles(user_id),
  updated_at timestamptz not null default now()
);

create table site_visits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  plot_ids uuid[] not null default '{}',
  scheduled_at timestamptz,
  rm_id uuid references staff_profiles(user_id),
  property_rep_id uuid references staff_profiles(user_id),
  attendees text[] not null default '{}',
  pickup_required boolean not null default false,
  pickup_point text,
  meeting_point text,
  itinerary jsonb not null default '[]',
  status text not null default 'PROPOSED',      -- PROPOSED | SCHEDULED | COMPLETED | CANCELLED
  feedback jsonb,                               -- {liked, disliked, preferred_plots, price_reaction, location_reaction, road_width_pref, plot_size_reaction, amenities, questions, objections, decision_timeline, follow_up_date}
  created_by uuid references staff_profiles(user_id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table plot_interest (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  plot_id uuid not null references plots(id) on delete cascade,
  stance stance not null default 'INTERESTED',
  reason text,
  source text not null default 'RM',            -- RM | SITE_VISIT | PORTAL | MATCHING
  created_at timestamptz not null default now(),
  unique (client_id, plot_id)
);

create table landowner_profiles (
  client_id uuid primary key references clients(id) on delete cascade,
  stage text not null default 'LEAD',           -- LEAD | OWNERSHIP_VERIFICATION | DOCUMENT_COLLECTION | TITLE_REVIEW | EC | ACCESS_REVIEW | PLANNING | LOCATION | VALUATION | DEVELOPMENT_POTENTIAL | COMMERCIAL | DECISION | LEGAL | EXECUTION
  land_location text,
  survey_numbers text[] not null default '{}',
  extent_acres numeric,
  co_owners text[] not null default '{}',
  title_documents text[] not null default '{}',
  patta_status text,
  ec_status text,
  approval_potential text,
  access text,
  road_frontage_ft numeric,
  current_use text,
  expected_price numeric,
  negotiable boolean,
  reason_for_sale text,
  timeline text,
  development jsonb not null default '{}',      -- {suitability, layout_potential, developable_acres, constraints, comparables, economics}
  updated_by uuid references staff_profiles(user_id),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Non-individual entities, anomalies, conflicts
-- ------------------------------------------------------------------
create table entity_profiles (
  client_id uuid primary key references clients(id) on delete cascade,
  entity_type text not null,                    -- COMPANY | LLP | PARTNERSHIP | TRUST | FAMILY_OFFICE | HUF | SOCIETY | FOUNDATION | INSTITUTION
  registration_number text,
  incorporation_date date,
  directors jsonb not null default '[]',
  signatories jsonb not null default '[]',
  beneficial_owners jsonb not null default '[]',
  investment_authority text,
  financials jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table anomalies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  anomaly_type text not null,
  detail text not null,
  evidence jsonb not null default '{}',
  severity severity_level not null default 'MEDIUM',
  status text not null default 'REVIEW_REQUIRED', -- REVIEW_REQUIRED | REVIEWED | DISMISSED
  fingerprint text not null,
  reviewer_id uuid references staff_profiles(user_id),
  reviewed_at timestamptz,
  detected_at timestamptz not null default now(),
  unique (client_id, fingerprint)
);

create table conflict_signals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  conflict_type text not null,
  detail text not null,
  evidence jsonb not null default '{}',
  status text not null default 'REVIEW_REQUIRED',
  created_at timestamptz not null default now()
);

-- Client portal access tokens (hashed) for self-service uploads and declarations
create table portal_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  token_hash text not null unique,
  purpose text not null default 'SELF_SERVICE',
  expires_at timestamptz not null,
  created_by uuid references staff_profiles(user_id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked boolean not null default false
);

create table portal_submissions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  token_id uuid references portal_tokens(id) on delete set null,
  kind text not null,                           -- DETAILS | OBJECTIVES | PROPERTY_REQUIREMENTS | SUITABILITY | CONSENT | CONSENT_WITHDRAWAL | DOCUMENT | CORRECTION
  payload jsonb not null,
  status text not null default 'PENDING_REVIEW',
  reviewed_by uuid references staff_profiles(user_id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Helper: lookup by hash across phone/bank/pan for anomaly engine (counts only, no values)
-- ------------------------------------------------------------------
create or replace function shared_identifier_clients(p_client_id uuid)
returns table (kind text, value_hash text, other_client_ids uuid[])
language sql stable security definer set search_path = public as $$
  select s.kind, s.value_hash, array_agg(distinct o.client_id)
  from sensitive_values s
  join sensitive_values o on o.kind = s.kind and o.value_hash = s.value_hash and o.client_id <> s.client_id
  where s.client_id = p_client_id and has_perm('clients:read') and s.kind in ('PAN','PHONE','BANK_ACCOUNT','EMAIL','UAN')
  group by s.kind, s.value_hash;
$$;
grant execute on function shared_identifier_clients(uuid) to authenticated;

-- Portal token validation for anon access (used by storage policies and portal RPCs)
create or replace function portal_token_valid(p_token text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_client uuid;
begin
  select client_id into v_client from portal_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and not revoked and expires_at > now();
  return v_client;
end $$;

create or replace function portal_context(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_out jsonb;
begin
  v_client := portal_token_valid(p_token);
  if v_client is null then return null; end if;
  update portal_tokens set last_used_at = now() where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  select jsonb_build_object(
    'clientId', c.id,
    'clientCode', c.client_code,
    'displayName', c.display_name,
    'consentStatus', c.consent_status,
    'documentRequests', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'documentType', d.document_type, 'reason', d.reason, 'status', d.status, 'requestedAt', d.requested_at)), '[]') from document_requests d where d.client_id = c.id),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'docType', x.doc_type, 'title', x.title, 'status', x.status, 'uploadedAt', x.uploaded_at)), '[]') from client_documents x where x.client_id = c.id and x.upload_source = 'CLIENT_PORTAL'),
    'submissions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'status', s.status, 'createdAt', s.created_at)), '[]') from portal_submissions s where s.client_id = c.id),
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'purpose', k.purpose, 'status', k.status, 'grantedAt', k.granted_at, 'expiresAt', k.expires_at, 'sources', k.sources_authorized)), '[]') from consents k where k.client_id = c.id)
  ) into v_out from clients c where c.id = v_client;
  return v_out;
end $$;

create or replace function portal_submit(p_token text, p_kind text, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_id uuid; v_token uuid;
begin
  v_client := portal_token_valid(p_token);
  if v_client is null then raise exception 'invalid or expired link'; end if;
  if p_kind not in ('DETAILS','OBJECTIVES','PROPERTY_REQUIREMENTS','SUITABILITY','CONSENT','CONSENT_WITHDRAWAL','CORRECTION','CONTACT_PREFERENCES') then raise exception 'unsupported submission'; end if;
  select id into v_token from portal_tokens where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  insert into portal_submissions (client_id, token_id, kind, payload) values (v_client, v_token, p_kind, p_payload) returning id into v_id;
  if p_kind = 'CONSENT_WITHDRAWAL' then
    update consents set status = 'WITHDRAWN', withdrawn_at = now() where client_id = v_client and status = 'GRANTED';
    update clients set consent_status = 'WITHDRAWN' where id = v_client;
  end if;
  insert into intelligence_events (client_id, event_type, title, detail, source_key)
  values (v_client, 'PORTAL_SUBMISSION', 'Client portal submission: ' || p_kind, 'Awaiting staff review', 'CLIENT_PORTAL');
  return v_id;
end $$;

create or replace function portal_register_document(p_token text, p_doc_type text, p_title text, p_path text, p_mime text, p_size integer, p_sha text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_id uuid;
begin
  v_client := portal_token_valid(p_token);
  if v_client is null then raise exception 'invalid or expired link'; end if;
  if p_path not like ('portal/' || v_client::text || '/%') then raise exception 'invalid path'; end if;
  insert into client_documents (client_id, room, doc_type, title, storage_bucket, storage_path, mime_type, size_bytes, sha256, status, extraction_status, upload_source, access_level, evidence_class)
  values (v_client, case when p_doc_type in ('SALE_DEED','PARENT_DEED','PATTA','CHITTA','ADANGAL','EC','FMB','SURVEY_PLAN','LAYOUT','PROPERTY_TAX') then 'PROPERTY' when p_doc_type in ('MUTUAL_FUND_STATEMENT','DEMAT_STATEMENT','INVESTMENT_STATEMENT','AIF_DOCUMENT','PMS_STATEMENT','INSURANCE','LOAN_STATEMENT') then 'FINANCIAL' else 'KYC' end,
          p_doc_type, p_title, 'client-uploads', p_path, p_mime, p_size, p_sha, 'UPLOADED', 'PENDING', 'CLIENT_PORTAL', 'KYC', 'CLIENT_DECLARED')
  returning id into v_id;
  update document_requests set status = 'RECEIVED', fulfilled_at = now(), document_id = v_id
  where client_id = v_client and status = 'REQUESTED' and upper(replace(document_type, ' ', '_')) like ('%' || split_part(p_doc_type, '_', 1) || '%');
  insert into intelligence_events (client_id, event_type, title, detail, source_key)
  values (v_client, 'PORTAL_DOCUMENT', 'Client uploaded ' || p_doc_type, p_title, 'CLIENT_PORTAL');
  return v_id;
end $$;

grant execute on function portal_token_valid(text), portal_context(text), portal_submit(text,text,jsonb), portal_register_document(text,text,text,text,text,integer,text) to anon, authenticated;

-- Staff: mint a portal token (returns the raw token once)
create or replace function mint_portal_token(p_client_id uuid, p_days integer default 14)
returns text language plpgsql security definer set search_path = public as $$
declare v_raw text;
begin
  if not has_perm('documents:request') then raise exception 'not authorised'; end if;
  v_raw := encode(extensions.gen_random_bytes(24), 'hex');
  insert into portal_tokens (client_id, token_hash, expires_at, created_by) values (p_client_id, encode(extensions.digest(v_raw, 'sha256'), 'hex'), now() + make_interval(days => p_days), auth.uid());
  perform log_audit('portal.token_mint', p_client_id, 'portal_tokens', null, null, jsonb_build_object('days', p_days));
  return v_raw;
end $$;
grant execute on function mint_portal_token(uuid,integer) to authenticated;

-- ------------------------------------------------------------------
-- Storage buckets + policies
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('client-documents', 'client-documents', false, 52428800, array['application/pdf','image/jpeg','image/png','image/webp','text/csv','application/json','text/plain','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('client-photos', 'client-photos', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('client-uploads', 'client-uploads', false, 52428800, array['application/pdf','image/jpeg','image/png','image/webp','text/csv','application/json','text/plain']),
  ('property-media', 'property-media', false, 104857600, array['application/pdf','image/jpeg','image/png','image/webp','video/mp4'])
on conflict (id) do nothing;

create policy "staff read client documents" on storage.objects for select to authenticated using (bucket_id in ('client-documents','client-photos','client-uploads','property-media') and has_perm('clients:read'));
create policy "staff write client documents" on storage.objects for insert to authenticated with check (bucket_id in ('client-documents','client-photos','property-media') and (has_perm('documents:request') or has_perm('clients:write')));
create policy "staff update client documents" on storage.objects for update to authenticated using (bucket_id in ('client-documents','client-photos','property-media') and has_perm('clients:write'));
create policy "staff delete client documents" on storage.objects for delete to authenticated using (bucket_id in ('client-documents','client-photos','property-media') and has_perm('retention:manage'));
-- portal uploads: anon may insert only under portal/<clientId>/ for a valid token passed as the second folder segment
create policy "portal upload" on storage.objects for insert to anon with check (bucket_id = 'client-uploads' and (storage.foldername(name))[1] = 'portal' and portal_token_valid((storage.foldername(name))[3]) = ((storage.foldername(name))[2])::uuid);

-- ------------------------------------------------------------------
-- RLS for new tables
-- ------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array['assets','asset_source_records','asset_valuations','liabilities','credit_bureau_reports','bank_relationships','cash_flow_periods','family_links','legal_matters','fund_sources','wealth_events','human_inputs','client_documents','client_photos','client_analyses','approach_strategies','interactions','client_interests','contact_controls','tasks','opportunity_triggers','opportunity_scores','aif_funds','aif_suitability','compliance_rules','freshness_windows','projects','plots','property_due_diligence','property_preferences','site_visits','plot_interest','landowner_profiles','entity_profiles','anomalies','conflict_signals','portal_tokens','portal_submissions'])
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
  -- read for all staff with clients:read
  for t in select unnest(array['assets','asset_source_records','asset_valuations','liabilities','family_links','legal_matters','fund_sources','wealth_events','human_inputs','client_analyses','approach_strategies','interactions','client_interests','contact_controls','tasks','opportunity_triggers','opportunity_scores','aif_funds','aif_suitability','compliance_rules','freshness_windows','projects','plots','property_due_diligence','property_preferences','site_visits','plot_interest','landowner_profiles','entity_profiles','anomalies','conflict_signals','portal_submissions'])
  loop
    execute format('create policy %I_read on %I for select using (has_perm(''clients:read''))', t, t);
  end loop;
  -- write for analysts and above
  for t in select unnest(array['assets','asset_source_records','asset_valuations','liabilities','family_links','legal_matters','fund_sources','wealth_events','client_analyses','approach_strategies','interactions','client_interests','contact_controls','tasks','opportunity_triggers','opportunity_scores','property_preferences','site_visits','plot_interest','landowner_profiles','entity_profiles','anomalies','conflict_signals'])
  loop
    execute format('create policy %I_write on %I for insert with check (has_perm(''clients:write'') or has_perm(''notes:write''))', t, t);
    execute format('create policy %I_update on %I for update using (has_perm(''clients:write'') or has_perm(''notes:write''))', t, t);
  end loop;
end $$;

-- financial detail tables need financial:read
create policy cbr_read on credit_bureau_reports for select using (has_perm('financial:read'));
create policy cbr_write on credit_bureau_reports for insert with check (has_perm('verification:ingest'));
create policy bankrel_read on bank_relationships for select using (has_perm('financial:read'));
create policy bankrel_write on bank_relationships for insert with check (has_perm('verification:ingest') or has_perm('clients:write'));
create policy cashflow_read on cash_flow_periods for select using (has_perm('financial:read'));
create policy cashflow_write on cash_flow_periods for insert with check (has_perm('verification:ingest') or has_perm('clients:write'));

-- human inputs: anyone with notes:write may add; only the author or disputes:manage may update
create policy human_write on human_inputs for insert with check (has_perm('notes:write') and author_id = auth.uid());
create policy human_update on human_inputs for update using (author_id = auth.uid() or has_perm('disputes:manage') or has_perm('external:review'));

-- documents: access levels by role
create policy docs_read on client_documents for select using (
  has_perm('clients:read') and (
    access_level = 'GENERAL'
    or (access_level = 'MASKED')
    or (access_level = 'KYC' and (has_perm('sensitive:reveal') or has_perm('documents:request')))
    or (access_level = 'PROPERTY_LEGAL' and (has_perm('clients:write') or has_perm('audit:read')))
    or (access_level = 'INVESTMENT_COMPLIANCE' and (has_perm('sensitive:reveal') or has_perm('audit:read')))
  )
);
create policy docs_write on client_documents for insert with check (has_perm('documents:request') or has_perm('clients:write'));
create policy docs_update on client_documents for update using (has_perm('documents:request') or has_perm('clients:write'));
create policy photos_read on client_photos for select using (has_perm('clients:read'));
create policy photos_write on client_photos for insert with check (has_perm('documents:request') or has_perm('clients:write'));
create policy photos_update on client_photos for update using (has_perm('clients:write'));

-- admin-only writes
create policy funds_write on aif_funds for all using (has_perm('scoring:configure') or has_perm('consent:manage')) with check (has_perm('scoring:configure') or has_perm('consent:manage'));
create policy suit_write on aif_suitability for insert with check (has_perm('investor:capture'));
create policy suit_update on aif_suitability for update using (has_perm('investor:capture') or has_perm('risk:review'));
create policy rules_write on compliance_rules for all using (has_perm('scoring:configure')) with check (has_perm('scoring:configure'));
create policy fresh_write on freshness_windows for all using (has_perm('scoring:configure')) with check (has_perm('scoring:configure'));
create policy projects_write on projects for all using (has_perm('clients:write')) with check (has_perm('clients:write'));
create policy plots_write on plots for all using (has_perm('clients:write')) with check (has_perm('clients:write'));
create policy dd_write on property_due_diligence for all using (has_perm('clients:write') or has_perm('disputes:manage')) with check (has_perm('clients:write') or has_perm('disputes:manage'));
create policy portal_tokens_read on portal_tokens for select using (has_perm('documents:request'));
create policy portal_sub_update on portal_submissions for update using (has_perm('clients:write'));

-- touch triggers
create trigger assets_touch before update on assets for each row execute function touch_updated_at();
create trigger liabilities_touch before update on liabilities for each row execute function touch_updated_at();
create trigger plots_touch before update on plots for each row execute function touch_updated_at();
create trigger projects_touch before update on projects for each row execute function touch_updated_at();

revoke all on all tables in schema public from anon;
