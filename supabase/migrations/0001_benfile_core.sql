-- BENFILE core schema: clients, verification runs, normalised intelligence,
-- RBAC, consent, audit, cases, external intelligence.
-- All tables are RLS-protected; staff access is permission-gated.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ------------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------------
create type staff_role as enum ('SUPER_ADMIN','COMPLIANCE_OFFICER','SENIOR_ANALYST','ANALYST','RELATIONSHIP_MANAGER','AUDITOR');
create type assertion_kind as enum ('VERIFIED_FACT','CLIENT_DECLARED','DERIVED','ANALYST_ASSESSMENT');
create type source_class as enum ('OFFICIAL_GOVERNMENT','AUTHORIZED_PROVIDER','INSTITUTIONAL','NEWS_MEDIA','PROFESSIONAL_PROFILE','PUBLIC_WEB','USER_GENERATED','PUBLIC_RECORD','USER_SUPPLIED_DOCUMENT');
create type client_status as enum ('PENDING','VERIFIED','NEEDS_REVIEW','PARTIAL','REJECTED','ARCHIVED');
create type review_status as enum ('UNREVIEWED','IN_REVIEW','REVIEWED','ESCALATED');
create type severity_level as enum ('INFO','LOW','MEDIUM','HIGH','CRITICAL');
create type signal_status as enum ('OPEN','NEEDS_REVIEW','REVIEWED','ESCALATED','DISMISSED','RESOLVED');
create type signal_origin as enum ('PROVIDER','RULES_ENGINE','EXTERNAL','ANALYST');
create type match_status as enum ('MATCH','PARTIAL_MATCH','MISMATCH','NOT_AVAILABLE');
create type entity_match_status as enum ('CONFIRMED','HIGH_CONFIDENCE','POSSIBLE_MATCH','LOW_CONFIDENCE','NOT_A_MATCH');
create type finding_review as enum ('PENDING','ADDED','REJECTED','FLAGGED');
create type case_status as enum ('OPEN','IN_REVIEW','ESCALATED','AWAITING_CLIENT','CLOSED');
create type consent_status as enum ('GRANTED','PENDING','EXPIRED','WITHDRAWN');
create type dispute_flag as enum ('INCORRECT','OUTDATED','WRONG_PERSON','DISPUTED','UNVERIFIED','SOURCE_ERROR');
create type relationship_status as enum ('CONFIRMED','POSSIBLE','REJECTED');

-- ------------------------------------------------------------------
-- Staff, roles, permissions
-- ------------------------------------------------------------------
create table staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role staff_role not null default 'ANALYST',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table role_permissions (
  role staff_role not null,
  permission text not null,
  primary key (role, permission)
);

insert into role_permissions (role, permission)
select 'SUPER_ADMIN', p from unnest(array[
  'clients:read','clients:write','clients:delete','verification:ingest','verification:request','risk:review','risk:escalate',
  'cases:manage','cases:assign','notes:write','documents:request','sensitive:reveal','reports:export','audit:read',
  'external:search','external:review','consent:manage','disputes:manage','investor:capture','scoring:configure',
  'users:manage','retention:manage','financial:read']) as p;
insert into role_permissions (role, permission)
select 'COMPLIANCE_OFFICER', p from unnest(array[
  'clients:read','clients:write','verification:ingest','verification:request','risk:review','risk:escalate',
  'cases:manage','cases:assign','notes:write','documents:request','sensitive:reveal','reports:export','audit:read',
  'external:search','external:review','consent:manage','disputes:manage','investor:capture','retention:manage','financial:read']) as p;
insert into role_permissions (role, permission)
select 'SENIOR_ANALYST', p from unnest(array[
  'clients:read','clients:write','verification:ingest','verification:request','risk:review','risk:escalate',
  'cases:manage','cases:assign','notes:write','documents:request','sensitive:reveal','reports:export',
  'external:search','external:review','consent:manage','disputes:manage','investor:capture','financial:read']) as p;
insert into role_permissions (role, permission)
select 'ANALYST', p from unnest(array[
  'clients:read','clients:write','verification:ingest','verification:request','risk:review','cases:manage',
  'notes:write','documents:request','reports:export','external:search','external:review','investor:capture','financial:read']) as p;
insert into role_permissions (role, permission)
select 'RELATIONSHIP_MANAGER', p from unnest(array['clients:read','notes:write','documents:request','consent:manage','investor:capture']) as p;
insert into role_permissions (role, permission)
select 'AUDITOR', p from unnest(array['clients:read','audit:read','financial:read']) as p;

create or replace function current_staff_role() returns staff_role
language sql stable security definer set search_path = public as $$
  select role from staff_profiles where user_id = auth.uid() and is_active;
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_profiles where user_id = auth.uid() and is_active);
$$;

create or replace function has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff_profiles s join role_permissions rp on rp.role = s.role
    where s.user_id = auth.uid() and s.is_active and rp.permission = p
  );
$$;

-- ------------------------------------------------------------------
-- Data sources catalogue
-- ------------------------------------------------------------------
create table data_sources (
  key text primary key,
  name text not null,
  source_class source_class not null,
  tier smallint not null check (tier between 1 and 7),
  provider_key text,
  country text not null default 'IN',
  description text
);
insert into data_sources (key, name, source_class, tier, provider_key, description) values
  ('PAN','PAN (Income Tax Dept. via provider)','AUTHORIZED_PROVIDER',2,'india-kyc-composite','PAN verification and linked demographics'),
  ('UAN','EPFO / UAN (via provider)','AUTHORIZED_PROVIDER',2,'india-kyc-composite','Employment and PF history'),
  ('CREDIT','Credit bureau (via provider)','AUTHORIZED_PROVIDER',2,'india-kyc-composite','Bureau score and identifiers'),
  ('MOBILE','Mobile network intelligence (via provider)','AUTHORIZED_PROVIDER',2,'india-kyc-composite','Number validity and subscriber status'),
  ('BANK','Bank verification (via provider)','AUTHORIZED_PROVIDER',2,'india-kyc-composite','Account and IFSC information'),
  ('RISK','Provider risk screen','AUTHORIZED_PROVIDER',2,'india-kyc-composite','Provider-declared risk indicators'),
  ('PROVIDER','Verification provider','AUTHORIZED_PROVIDER',2,'india-kyc-composite','Composite provider metadata'),
  ('MCA','MCA corporate registry','OFFICIAL_GOVERNMENT',1,'mca-sandbox','Company and director master data'),
  ('GST','GST registration','OFFICIAL_GOVERNMENT',1,'gst-sandbox','GSTIN verification'),
  ('ECOURTS','Court records','PUBLIC_RECORD',3,'courts-sandbox','Public court and tribunal records'),
  ('SANCTIONS','Sanctions & watchlists','OFFICIAL_GOVERNMENT',1,'sanctions-sandbox','Sanctions / PEP screening'),
  ('NEWS','News & media','NEWS_MEDIA',4,'media-sandbox','Established media coverage'),
  ('PROFESSIONAL','Professional profiles','PROFESSIONAL_PROFILE',5,'professional-sandbox','Public professional profiles'),
  ('SOCIAL','Public social profiles','USER_GENERATED',7,'social-sandbox','Public social profiles'),
  ('WEB','Public web','PUBLIC_WEB',6,'web-sandbox','General web mentions');

-- ------------------------------------------------------------------
-- Clients
-- ------------------------------------------------------------------
create sequence client_code_seq start 1;

create table clients (
  id uuid primary key default gen_random_uuid(),
  client_code text not null unique default ('BF-' || lpad(nextval('client_code_seq')::text, 6, '0')),
  display_name text not null,
  country text not null default 'IN',
  status client_status not null default 'PENDING',
  review_status review_status not null default 'UNREVIEWED',
  risk_level text not null default 'NONE',
  credit_band text,
  employment_status text,
  occupation text,
  city text,
  completeness numeric(4,3),
  freshness text,
  latest_run_id uuid,
  last_verified_at timestamptz,
  consent_status consent_status not null default 'PENDING',
  assigned_to uuid references staff_profiles(user_id),
  created_by uuid references staff_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text
);
create index clients_search_trgm on clients using gin (search_text gin_trgm_ops);
create index clients_status_idx on clients (status, risk_level, review_status);

-- ------------------------------------------------------------------
-- Consent & lawful purpose
-- ------------------------------------------------------------------
create table consents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  status consent_status not null default 'GRANTED',
  purpose text not null,
  purpose_code text not null default 'KYC_ONBOARDING',
  granted_at timestamptz,
  expires_at timestamptz,
  reverify_after timestamptz,
  sources_authorized text[] not null default '{}',
  provider_key text,
  consent_reference text,
  evidence_document_id uuid,
  captured_by uuid references staff_profiles(user_id),
  created_at timestamptz not null default now()
);
create index consents_client_idx on consents(client_id, status);

-- ------------------------------------------------------------------
-- Verification runs (snapshots; never overwritten)
-- ------------------------------------------------------------------
create table verification_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  run_seq integer not null,
  provider_key text not null,
  adapter_version text not null,
  engine_version text,
  verification_id text not null,
  reference_id text,
  status text not null,
  requested_at timestamptz,
  completed_at timestamptz,
  snapshot_label text,
  canonical jsonb not null,
  assessment jsonb,
  warnings text[] not null default '{}',
  ingested_by uuid references staff_profiles(user_id),
  ingested_at timestamptz not null default now(),
  unique (client_id, run_seq)
);
create index verification_runs_client_idx on verification_runs(client_id, run_seq desc);
create index verification_runs_vid_idx on verification_runs(verification_id);
alter table clients add constraint clients_latest_run_fk foreign key (latest_run_id) references verification_runs(id) deferrable initially deferred;

-- Raw provider payloads: separated, access only via RPC for authorised roles.
create table raw_provider_payloads (
  run_id uuid primary key references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  payload jsonb not null,
  sha256 text not null,
  stored_at timestamptz not null default now()
);

-- Full sensitive identifiers. No SELECT policy; reveal only via reveal_sensitive().
create table sensitive_values (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  run_id uuid references verification_runs(id) on delete cascade,
  kind text not null,
  entity_table text not null,
  field_key text not null,
  value_full text not null,
  value_hash text not null,
  created_at timestamptz not null default now()
);
create index sensitive_values_hash_idx on sensitive_values(kind, value_hash);
create index sensitive_values_client_idx on sensitive_values(client_id);

-- ------------------------------------------------------------------
-- Normalised intelligence (one row-set per run)
-- ------------------------------------------------------------------
create table personal_details (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  full_name text,
  gender text,
  dob date,
  age integer,
  age_assertion assertion_kind,
  occupation text,
  income_amount numeric,
  income_currency text,
  income_period text,
  income_kind text,
  income_assertion assertion_kind,
  income_source_key text,
  relatives jsonb not null default '[]',
  source_key text not null,
  assertion assertion_kind not null default 'VERIFIED_FACT'
);
create index personal_details_run_idx on personal_details(run_id);

create table identity_documents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  doc_type text not null,
  number_masked text,
  number_hash text,
  sensitive_value_id uuid references sensitive_values(id) on delete set null,
  name_on_document text,
  subtype text,
  status text,
  aadhaar_linked boolean,
  source_key text not null,
  tier smallint not null default 2,
  assertion assertion_kind not null default 'VERIFIED_FACT',
  evidence_path text,
  retrieved_at timestamptz
);
create index identity_documents_hash_idx on identity_documents(doc_type, number_hash);
create index identity_documents_run_idx on identity_documents(run_id);

create table client_addresses (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  full_address text,
  street text,
  city text,
  state text,
  country text,
  pin_code text,
  address_type text,
  source_key text not null,
  tier smallint not null default 2,
  assertion assertion_kind not null default 'VERIFIED_FACT',
  evidence_path text
);
create index client_addresses_run_idx on client_addresses(run_id);

create table phone_numbers (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  number_masked text not null,
  number_hash text not null,
  sensitive_value_id uuid references sensitive_values(id) on delete set null,
  phone_type text,
  source_key text not null,
  tier smallint not null default 2,
  assertion assertion_kind not null default 'VERIFIED_FACT',
  evidence_path text
);
create index phone_numbers_hash_idx on phone_numbers(number_hash);
create index phone_numbers_run_idx on phone_numbers(run_id);

create table emails (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  email_masked text not null,
  email_hash text not null,
  sensitive_value_id uuid references sensitive_values(id) on delete set null,
  source_key text not null,
  tier smallint not null default 2,
  assertion assertion_kind not null default 'VERIFIED_FACT',
  evidence_path text
);
create index emails_hash_idx on emails(email_hash);
create index emails_run_idx on emails(run_id);

create table bank_accounts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  account_masked text,
  account_hash text,
  sensitive_value_id uuid references sensitive_values(id) on delete set null,
  ifsc text,
  bank_name text,
  branch text,
  account_type text,
  holder_name text,
  verified boolean,
  source_key text not null,
  tier smallint not null default 2,
  assertion assertion_kind not null default 'VERIFIED_FACT',
  evidence_path text
);
create index bank_accounts_run_idx on bank_accounts(run_id);

create table employers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  establishment_id text,
  ownership_type text,
  setup_date date,
  employee_count integer,
  pf_filings jsonb not null default '[]',
  confidence numeric(4,3),
  source_key text not null default 'UAN',
  first_seen_run_id uuid references verification_runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (establishment_id)
);

create table employment_records (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  employer_id uuid references employers(id) on delete set null,
  employer_name text not null,
  establishment_id text,
  status text not null,
  joining_date date,
  exit_date date,
  tenure_months integer,
  employee_name_on_record text,
  employee_name_match boolean,
  employer_name_match boolean,
  employer_confidence numeric(4,3),
  source_key text not null default 'UAN',
  tier smallint not null default 2,
  assertion assertion_kind not null default 'VERIFIED_FACT',
  evidence_path text
);
create index employment_records_run_idx on employment_records(run_id);

create table epfo_records (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  uan_masked text,
  uan_hash text,
  uan_sensitive_value_id uuid references sensitive_values(id) on delete set null,
  member_id_masked text,
  member_id_sensitive_value_id uuid references sensitive_values(id) on delete set null,
  aadhaar_linked boolean,
  pf_filing_available boolean,
  employee_name_match boolean,
  source_key text not null default 'UAN',
  assertion assertion_kind not null default 'VERIFIED_FACT',
  evidence_path text,
  retrieved_at timestamptz
);

create table credit_profiles (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  score integer,
  band text not null,
  bureau text,
  score_date date,
  identifiers_masked jsonb not null default '{}',
  -- bureau expansion (nullable until a bureau adapter supplies them)
  active_loans integer,
  secured_loans integer,
  unsecured_loans integer,
  credit_cards integer,
  total_outstanding numeric,
  utilization numeric,
  enquiries_12m integer,
  delinquencies integer,
  accounts jsonb not null default '[]',
  events jsonb not null default '[]',
  source_key text not null default 'CREDIT',
  tier smallint not null default 2,
  assertion assertion_kind not null default 'VERIFIED_FACT',
  evidence_path text,
  retrieved_at timestamptz
);
create index credit_profiles_run_idx on credit_profiles(run_id);

create table mobile_intelligence (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  number_masked text,
  number_hash text,
  is_valid boolean,
  subscriber_status text,
  connection_type text,
  service_provider text,
  original_provider text,
  network_region text,
  is_ported boolean,
  source_key text not null default 'MOBILE',
  assertion assertion_kind not null default 'VERIFIED_FACT',
  evidence_path text,
  retrieved_at timestamptz
);

create table identity_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  check_key text not null,
  label text not null,
  left_source text not null,
  right_source text not null,
  left_value_masked text,
  right_value_masked text,
  sensitive boolean not null default false,
  status match_status not null,
  score numeric(4,3),
  explanation text not null,
  assertion assertion_kind not null default 'DERIVED'
);
create index identity_checks_run_idx on identity_checks(run_id);

create table data_quality (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  source_key text not null,
  label text not null,
  tier smallint not null,
  available boolean not null,
  verification_status text not null,
  retrieved_at timestamptz,
  last_updated_at timestamptz,
  age_days integer,
  freshness text not null,
  confidence numeric(4,3),
  completeness numeric(4,3)
);
create index data_quality_run_idx on data_quality(run_id);

create table scoring_configs (
  version text primary key,
  weights jsonb not null,
  notes text,
  is_active boolean not null default false,
  created_by uuid references staff_profiles(user_id),
  created_at timestamptz not null default now()
);
insert into scoring_configs (version, weights, notes, is_active) values
  ('score-1.0', '{"identity":0.25,"employment":0.2,"credit":0.2,"contact":0.1,"completeness":0.1,"risk":0.15}', 'Initial weighting. Credit capped at 20% so the score never becomes a proxy credit score.', true);

create table profile_scores (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  config_version text not null,
  total integer,
  coverage numeric(4,3) not null,
  components jsonb not null,
  computed_at timestamptz not null default now()
);
create index profile_scores_run_idx on profile_scores(run_id);

-- Risk signals persist across runs (review state must survive re-verification)
create table risk_signals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  run_id uuid references verification_runs(id) on delete set null,
  fingerprint text not null,
  rule_key text not null,
  category text not null,
  severity severity_level not null,
  origin signal_origin not null,
  source_key text not null,
  title text not null,
  explanation text not null,
  evidence jsonb not null default '[]',
  detected_at timestamptz,
  updated_at timestamptz not null default now(),
  status signal_status not null default 'OPEN',
  requires_review boolean not null default false,
  reviewer_id uuid references staff_profiles(user_id),
  reviewer_notes text,
  reviewed_at timestamptz,
  unique (client_id, fingerprint)
);
create index risk_signals_client_idx on risk_signals(client_id, status, severity);

-- ------------------------------------------------------------------
-- Analyst workspace
-- ------------------------------------------------------------------
create sequence case_code_seq start 1;
create table cases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  case_code text not null unique default ('CASE-' || lpad(nextval('case_code_seq')::text, 5, '0')),
  title text not null,
  status case_status not null default 'OPEN',
  priority text not null default 'NORMAL',
  assigned_to uuid references staff_profiles(user_id),
  opened_by uuid references staff_profiles(user_id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closure_reason text,
  updated_at timestamptz not null default now()
);
create index cases_assigned_idx on cases(assigned_to, status);

create table analyst_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  case_id uuid references cases(id) on delete set null,
  author_id uuid not null references staff_profiles(user_id),
  kind text not null default 'NOTE',
  body text not null,
  assertion assertion_kind not null default 'ANALYST_ASSESSMENT',
  created_at timestamptz not null default now()
);
create index analyst_notes_client_idx on analyst_notes(client_id, created_at desc);

create table documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  doc_type text not null,
  storage_path text,
  sha256 text,
  assertion assertion_kind not null default 'CLIENT_DECLARED',
  source_class source_class not null default 'USER_SUPPLIED_DOCUMENT',
  uploaded_by uuid references staff_profiles(user_id),
  uploaded_at timestamptz not null default now()
);

create table document_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  case_id uuid references cases(id) on delete set null,
  document_type text not null,
  reason text,
  status text not null default 'REQUESTED',
  requested_by uuid references staff_profiles(user_id),
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  document_id uuid references documents(id) on delete set null
);

create table report_exports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  run_id uuid references verification_runs(id) on delete set null,
  reference text not null unique,
  format text not null default 'HTML',
  sections text[] not null default '{}',
  masked boolean not null default true,
  exported_by uuid references staff_profiles(user_id),
  created_at timestamptz not null default now()
);

create table investor_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  consent_id uuid references consents(id) on delete set null,
  objectives text[] not null default '{}',
  horizon text,
  liquidity_needs text,
  risk_tolerance text,
  experience text,
  income_range text,
  net_worth_range text,
  source_of_funds text,
  source_of_wealth text,
  expected_investment_amount numeric,
  preferences text[] not null default '{}',
  declaration jsonb not null default '{}',
  assertion assertion_kind not null default 'CLIENT_DECLARED',
  captured_by uuid references staff_profiles(user_id),
  captured_at timestamptz not null default now()
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  entity_table text not null,
  entity_id uuid,
  field_key text,
  flag dispute_flag not null,
  reason text not null,
  status text not null default 'OPEN',
  raised_by uuid references staff_profiles(user_id),
  raised_at timestamptz not null default now(),
  resolution text,
  resolved_by uuid references staff_profiles(user_id),
  resolved_at timestamptz
);
create index disputes_client_idx on disputes(client_id, status);

create table retention_policies (
  id uuid primary key default gen_random_uuid(),
  scope text not null,          -- source class, source key or 'CASE_CLOSURE' / 'CONSENT_EXPIRY'
  retain_days integer not null,
  basis text not null,
  action text not null default 'DELETE', -- DELETE | ANONYMIZE
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into retention_policies (scope, retain_days, basis, action) values
  ('AUTHORIZED_PROVIDER', 1825, 'KYC record-keeping (5 years after relationship end)', 'DELETE'),
  ('USER_GENERATED', 180, 'Low-trust public content is not retained beyond investigation window', 'DELETE'),
  ('PUBLIC_WEB', 365, 'Public web findings expire unless attached to a reviewed case', 'DELETE'),
  ('NEWS_MEDIA', 730, 'Adverse-media findings retained for review continuity', 'ANONYMIZE'),
  ('CONSENT_EXPIRY', 30, 'Grace period after consent expiry before deletion workflow', 'DELETE');

-- ------------------------------------------------------------------
-- External intelligence
-- ------------------------------------------------------------------
create table external_searches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  consent_id uuid references consents(id) on delete set null,
  purpose text not null,
  connectors text[] not null default '{}',
  status text not null default 'COMPLETED',
  requested_by uuid references staff_profiles(user_id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'
);

create table external_findings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  search_id uuid references external_searches(id) on delete set null,
  connector_key text not null,
  result_type text not null,
  title text not null,
  excerpt text,
  url text,
  source_name text not null,
  source_class source_class not null,
  tier smallint not null,
  record_id text,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  match_score integer not null default 0,
  match_status entity_match_status not null,
  match_reasons jsonb not null default '[]',
  category text,
  severity text,
  entity_role text,
  data jsonb not null default '{}',
  review_status finding_review not null default 'PENDING',
  reviewed_by uuid references staff_profiles(user_id),
  reviewed_at timestamptz,
  review_note text,
  unique (client_id, connector_key, record_id)
);
create index external_findings_client_idx on external_findings(client_id, review_status, result_type);

create table relationships (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  from_type text not null,
  from_id text not null,
  from_label text not null,
  to_type text not null,
  to_id text not null,
  to_label text not null,
  relation text not null,
  status relationship_status not null default 'POSSIBLE',
  confidence integer,
  source_key text not null,
  tier smallint not null default 6,
  evidence jsonb not null default '{}',
  finding_id uuid references external_findings(id) on delete set null,
  retrieved_at timestamptz not null default now(),
  unique (client_id, from_type, from_id, to_type, to_id, relation)
);
create index relationships_client_idx on relationships(client_id);

create table intelligence_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  event_type text not null,
  title text not null,
  detail text,
  source_key text,
  previous_value text,
  new_value text,
  reviewer_status text not null default 'UNREVIEWED',
  run_id uuid references verification_runs(id) on delete set null,
  finding_id uuid references external_findings(id) on delete set null,
  actor_id uuid references staff_profiles(user_id)
);
create index intelligence_events_client_idx on intelligence_events(client_id, occurred_at desc);

create table refresh_schedules (
  client_id uuid primary key references clients(id) on delete cascade,
  enabled boolean not null default false,
  last_checked_at timestamptz,
  next_permitted_at timestamptz,
  interval_days integer not null default 90,
  sources_checked text[] not null default '{}',
  authorized_until timestamptz,
  consent_id uuid references consents(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Audit log (append-only)
-- ------------------------------------------------------------------
create table audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_role staff_role,
  action text not null,
  client_id uuid,
  entity_table text,
  entity_id text,
  field_key text,
  details jsonb not null default '{}',
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_logs_client_idx on audit_logs(client_id, created_at desc);
create index audit_logs_actor_idx on audit_logs(actor_id, created_at desc);

create or replace function log_audit(p_action text, p_client_id uuid default null, p_entity_table text default null, p_entity_id text default null, p_field_key text default null, p_details jsonb default '{}', p_ip text default null, p_ua text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not is_staff() then raise exception 'not authorised'; end if;
  insert into audit_logs(actor_id, actor_role, action, client_id, entity_table, entity_id, field_key, details, ip, user_agent)
  values (auth.uid(), current_staff_role(), p_action, p_client_id, p_entity_table, p_entity_id, p_field_key, coalesce(p_details, '{}'), p_ip, p_ua)
  returning id into v_id;
  return v_id;
end $$;

-- Controlled reveal of a full sensitive value: permission-checked, always audited.
create or replace function reveal_sensitive(p_id uuid, p_reason text)
returns table (value_full text, kind text, field_key text)
language plpgsql security definer set search_path = public as $$
declare r sensitive_values%rowtype;
begin
  if not has_perm('sensitive:reveal') then raise exception 'not authorised to reveal sensitive fields'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'a reason of at least 5 characters is required'; end if;
  select * into r from sensitive_values where id = p_id;
  if not found then raise exception 'not found'; end if;
  perform log_audit('sensitive.reveal', r.client_id, r.entity_table, r.id::text, r.field_key, jsonb_build_object('kind', r.kind, 'reason', p_reason));
  return query select r.value_full, r.kind, r.field_key;
end $$;

-- Raw payload access (evidence drawer): audited, permission-checked.
create or replace function get_raw_payload(p_run_id uuid, p_reason text default 'evidence review')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r raw_provider_payloads%rowtype;
begin
  if not has_perm('clients:read') then raise exception 'not authorised'; end if;
  select * into r from raw_provider_payloads where run_id = p_run_id;
  if not found then return null; end if;
  perform log_audit('evidence.raw_view', r.client_id, 'raw_provider_payloads', r.run_id::text, null, jsonb_build_object('reason', p_reason));
  return r.payload;
end $$;

-- Lookup by hashed identifier (search by PAN / phone / email) without exposing values.
create or replace function find_clients_by_hash(p_kind text, p_hash text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct client_id from sensitive_values where kind = p_kind and value_hash = p_hash and has_perm('clients:read');
$$;

-- Dashboard aggregates (no PII).
create or replace function dashboard_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when has_perm('clients:read') then jsonb_build_object(
    'clients_total', (select count(*) from clients where status <> 'ARCHIVED'),
    'clients_verified', (select count(*) from clients where status = 'VERIFIED'),
    'pending_verification', (select count(*) from clients where status = 'PENDING'),
    'requiring_review', (select count(*) from clients where status = 'NEEDS_REVIEW' or review_status = 'IN_REVIEW'),
    'high_risk_alerts', (select count(*) from risk_signals where severity in ('HIGH','CRITICAL') and status not in ('DISMISSED','RESOLVED')),
    'open_signals', (select count(*) from risk_signals where status in ('OPEN','NEEDS_REVIEW')),
    'stale_profiles', (select count(*) from clients where freshness in ('STALE','AGING')),
    'incomplete_profiles', (select count(*) from clients where completeness is not null and completeness < 0.75),
    'cases_mine', (select count(*) from cases where assigned_to = auth.uid() and status <> 'CLOSED'),
    'cases_awaiting_review', (select count(*) from cases where status in ('OPEN','IN_REVIEW','ESCALATED')),
    'findings_pending', (select count(*) from external_findings where review_status = 'PENDING'),
    'runs_last_7d', (select count(*) from verification_runs where ingested_at > now() - interval '7 days')
  ) else '{}'::jsonb end;
$$;

-- updated_at triggers
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger clients_touch before update on clients for each row execute function touch_updated_at();
create trigger cases_touch before update on cases for each row execute function touch_updated_at();
create trigger staff_touch before update on staff_profiles for each row execute function touch_updated_at();

-- ------------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array[
    'staff_profiles','role_permissions','data_sources','clients','consents','verification_runs','raw_provider_payloads',
    'sensitive_values','personal_details','identity_documents','client_addresses','phone_numbers','emails','bank_accounts',
    'employers','employment_records','epfo_records','credit_profiles','mobile_intelligence','identity_checks','data_quality',
    'scoring_configs','profile_scores','risk_signals','cases','analyst_notes','documents','document_requests','report_exports',
    'investor_profiles','disputes','retention_policies','external_searches','external_findings','relationships',
    'intelligence_events','refresh_schedules','audit_logs'])
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- staff_profiles: everyone sees active staff (names for assignment); only users:manage edits.
create policy staff_read on staff_profiles for select using (is_staff());
create policy staff_manage on staff_profiles for all using (has_perm('users:manage')) with check (has_perm('users:manage'));
create policy role_permissions_read on role_permissions for select using (is_staff());
create policy data_sources_read on data_sources for select using (is_staff());

-- Generic read policies (clients:read) and write policies per permission
create policy clients_read on clients for select using (has_perm('clients:read'));
create policy clients_write on clients for insert with check (has_perm('clients:write'));
create policy clients_update on clients for update using (has_perm('clients:write') or has_perm('risk:review') or has_perm('cases:manage'));
create policy clients_delete on clients for delete using (has_perm('clients:delete'));

create policy consents_read on consents for select using (has_perm('clients:read'));
create policy consents_write on consents for insert with check (has_perm('consent:manage') or has_perm('verification:ingest'));
create policy consents_update on consents for update using (has_perm('consent:manage'));

create policy runs_read on verification_runs for select using (has_perm('clients:read'));
create policy runs_write on verification_runs for insert with check (has_perm('verification:ingest'));
create policy runs_update on verification_runs for update using (has_perm('verification:ingest'));

-- raw payloads: insert only; read via get_raw_payload()
create policy raw_write on raw_provider_payloads for insert with check (has_perm('verification:ingest'));
-- sensitive values: insert only; read via reveal_sensitive()
create policy sensitive_write on sensitive_values for insert with check (has_perm('verification:ingest'));

do $$
declare t text;
begin
  for t in select unnest(array['personal_details','identity_documents','client_addresses','phone_numbers','emails','employers','employment_records','epfo_records','mobile_intelligence','identity_checks','data_quality','profile_scores'])
  loop
    execute format('create policy %I_read on %I for select using (has_perm(''clients:read''))', t, t);
    execute format('create policy %I_write on %I for insert with check (has_perm(''verification:ingest''))', t, t);
  end loop;
  for t in select unnest(array['bank_accounts','credit_profiles'])
  loop
    execute format('create policy %I_read on %I for select using (has_perm(''financial:read''))', t, t);
    execute format('create policy %I_write on %I for insert with check (has_perm(''verification:ingest''))', t, t);
  end loop;
end $$;
create policy employers_update on employers for update using (has_perm('verification:ingest'));

create policy scoring_read on scoring_configs for select using (is_staff());
create policy scoring_write on scoring_configs for all using (has_perm('scoring:configure')) with check (has_perm('scoring:configure'));

create policy signals_read on risk_signals for select using (has_perm('clients:read'));
create policy signals_write on risk_signals for insert with check (has_perm('verification:ingest') or has_perm('risk:review'));
create policy signals_update on risk_signals for update using (has_perm('risk:review') or has_perm('verification:ingest'));

create policy cases_read on cases for select using (has_perm('clients:read'));
create policy cases_write on cases for insert with check (has_perm('cases:manage'));
create policy cases_update on cases for update using (has_perm('cases:manage'));

create policy notes_read on analyst_notes for select using (has_perm('clients:read'));
create policy notes_write on analyst_notes for insert with check (has_perm('notes:write') and author_id = auth.uid());

create policy documents_read on documents for select using (has_perm('clients:read'));
create policy documents_write on documents for insert with check (has_perm('documents:request') or has_perm('clients:write'));
create policy docreq_read on document_requests for select using (has_perm('clients:read'));
create policy docreq_write on document_requests for insert with check (has_perm('documents:request'));
create policy docreq_update on document_requests for update using (has_perm('documents:request'));

create policy exports_read on report_exports for select using (has_perm('clients:read'));
create policy exports_write on report_exports for insert with check (has_perm('reports:export'));

create policy investor_read on investor_profiles for select using (has_perm('clients:read'));
create policy investor_write on investor_profiles for insert with check (has_perm('investor:capture'));

create policy disputes_read on disputes for select using (has_perm('clients:read'));
create policy disputes_write on disputes for insert with check (has_perm('disputes:manage') or has_perm('notes:write'));
create policy disputes_update on disputes for update using (has_perm('disputes:manage'));

create policy retention_read on retention_policies for select using (is_staff());
create policy retention_write on retention_policies for all using (has_perm('retention:manage')) with check (has_perm('retention:manage'));

create policy ext_search_read on external_searches for select using (has_perm('clients:read'));
create policy ext_search_write on external_searches for insert with check (has_perm('external:search'));
create policy ext_search_update on external_searches for update using (has_perm('external:search'));
create policy findings_read on external_findings for select using (has_perm('clients:read'));
create policy findings_write on external_findings for insert with check (has_perm('external:search'));
create policy findings_update on external_findings for update using (has_perm('external:review'));
create policy rel_read on relationships for select using (has_perm('clients:read'));
create policy rel_write on relationships for insert with check (has_perm('external:search') or has_perm('verification:ingest'));
create policy rel_update on relationships for update using (has_perm('external:review'));
create policy events_read on intelligence_events for select using (has_perm('clients:read'));
create policy events_write on intelligence_events for insert with check (is_staff());
create policy refresh_read on refresh_schedules for select using (has_perm('clients:read'));
create policy refresh_write on refresh_schedules for all using (has_perm('verification:request')) with check (has_perm('verification:request'));

-- audit logs: readable only with audit:read; never updatable/deletable; inserted via log_audit()
create policy audit_read on audit_logs for select using (has_perm('audit:read'));

-- Lock down direct grants: anon gets nothing.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
grant execute on function is_staff(), current_staff_role(), has_perm(text), log_audit(text,uuid,text,text,text,jsonb,text,text), reveal_sensitive(uuid,text), get_raw_payload(uuid,text), find_clients_by_hash(text,text), dashboard_stats() to authenticated;

-- sensitive_values has no SELECT policy by design, so INSERT ... RETURNING is impossible under RLS.
-- Inserts go through this permission-checked RPC instead.
create or replace function store_sensitive(p_client_id uuid, p_run_id uuid, p_kind text, p_entity_table text, p_field_key text, p_value_full text, p_value_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_perm('verification:ingest') then raise exception 'not authorised to store sensitive values'; end if;
  insert into sensitive_values (client_id, run_id, kind, entity_table, field_key, value_full, value_hash)
  values (p_client_id, p_run_id, p_kind, p_entity_table, p_field_key, p_value_full, p_value_hash)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function store_sensitive(uuid,uuid,text,text,text,text,text) from public, anon;
grant execute on function store_sensitive(uuid,uuid,text,text,text,text,text) to authenticated;
