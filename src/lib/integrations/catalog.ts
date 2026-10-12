/**
 * BENFILE integration catalogue.
 *
 * One entry per third-party API identified for the platform (docs/BENFILE_APIS.pdf).
 * Each entry declares the environment variables that must be present for the
 * integration to run LIVE. Nothing here holds a secret - only variable *names*.
 *
 *   implementation:
 *     LIVE_CONNECTOR     - a connector exists in code and switches on when its env vars are set
 *     INTEGRATION_POINT  - the contract (adapter / connector interface) exists; the provider
 *                          requires commercial onboarding before an endpoint can be called
 *     PORTAL_ONLY        - the source has no public developer API; manual / document workflow
 */
export type IntegrationCategory =
  | 'KYC_IDENTITY'
  | 'BANKING_FINANCIAL'
  | 'CREDIT'
  | 'EMPLOYMENT'
  | 'CORPORATE_TAX'
  | 'AML_COMPLIANCE'
  | 'LEGAL'
  | 'INVESTMENTS'
  | 'PROPERTY_LAND'
  | 'PUBLIC_PROFESSIONAL';

export const CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  KYC_IDENTITY: '1. KYC & Identity',
  BANKING_FINANCIAL: '2. Banking & Financial',
  CREDIT: '3. Credit',
  EMPLOYMENT: '4. Employment / UAN / EPFO',
  CORPORATE_TAX: '5. Corporate & Tax',
  AML_COMPLIANCE: '6. AML & Compliance',
  LEGAL: '7. Legal',
  INVESTMENTS: '8. Investments',
  PROPERTY_LAND: '9. Property & Land',
  PUBLIC_PROFESSIONAL: '10. Public & Professional Intelligence',
};

export type Implementation = 'LIVE_CONNECTOR' | 'INTEGRATION_POINT' | 'PORTAL_ONLY';

/** Which BENFILE surface consumes the data. */
export type ConsumerModule = 'VERIFICATION_INGEST' | 'EXTERNAL_INTELLIGENCE' | 'WEALTH' | 'DOCUMENTS' | 'PROPERTY' | 'CLIENT_PORTAL';

export interface IntegrationEntry {
  /** Catalogue number, e.g. "6.1". */
  id: string;
  category: IntegrationCategory;
  name: string;
  provider: string;
  purpose: string;
  module: ConsumerModule;
  implementation: Implementation;
  /** Environment variables that must all be set for LIVE operation. */
  envVars: string[];
  /** Connector / adapter key in code when implementation is LIVE_CONNECTOR. */
  connectorKey?: string;
  /** Sandbox connector this live integration supersedes when configured. */
  supersedesSandbox?: string;
  docsUrl: string;
  sandbox: string;
  /** Consent / legal notes that gate usage. */
  consent?: string;
  endpoint?: string;
}

export type IntegrationStatus = 'LIVE' | 'SANDBOX_FALLBACK' | 'NOT_CONFIGURED' | 'MANUAL';

const E = {
  hyperverge: ['HYPERVERGE_APP_ID', 'HYPERVERGE_APP_KEY'],
  setu: (product: string) => ['SETU_CLIENT_ID', 'SETU_CLIENT_SECRET', `SETU_${product}_PRODUCT_INSTANCE_ID`],
  attestr: ['ATTESTR_AUTH_TOKEN'],
  indiconnect: ['INDICONNECT_APP_ID', 'INDICONNECT_SERVICE_KEY', 'INDICONNECT_AUTH_TOKEN'],
  scofit: ['SCOFIT_API_KEY'],
  complyadvantage: ['COMPLYADVANTAGE_API_KEY'],
  ecourts: ['ECOURTS_API_TOKEN'],
  casparser: ['CASPARSER_API_KEY'],
  landlens: ['LANDLENS_API_KEY'],
  brave: ['BRAVE_SEARCH_API_KEY'],
};

export const INTEGRATION_CATALOG: IntegrationEntry[] = [
  /* ---------------- 1. KYC & Identity ---------------- */
  { id: '1.1', category: 'KYC_IDENTITY', name: 'PAN Verification', provider: 'Protean / Income Tax Department', purpose: 'Verify PAN details against official records.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: ['PROTEAN_PAN_USER_ID', 'PROTEAN_PAN_API_KEY'], docsUrl: 'https://www.incometax.gov.in/iec/foportal/central-state-government-approved-undertaking-agency', sandbox: 'Depends on onboarding as an approved undertaking agency.', consent: 'Government-backed verification; lawful purpose required.' },
  { id: '1.2', category: 'KYC_IDENTITY', name: 'KYC / Identity Verification', provider: 'HyperVerge', purpose: 'Identity verification results feed the identity domain of the canonical model.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: E.hyperverge, docsUrl: 'https://documentation.hyperverge.co/api-reference', sandbox: 'Staging environment available (appId + appKey).' },
  { id: '1.3', category: 'KYC_IDENTITY', name: 'Aadhaar eKYC', provider: 'Setu', purpose: 'Name, DOB, gender, address and masked Aadhaar details.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: E.setu('EKYC'), docsUrl: 'https://docs.setu.co/data/ekyc/quickstart', sandbox: 'Yes.', consent: 'Aadhaar OTP consent from the client; only masked Aadhaar is ever stored.' },
  { id: '1.4', category: 'KYC_IDENTITY', name: 'DigiLocker Documents', provider: 'API Setu / DigiLocker', purpose: 'Fetch government-issued documents with customer consent.', module: 'DOCUMENTS', implementation: 'INTEGRATION_POINT', envVars: ['DIGILOCKER_CLIENT_ID', 'DIGILOCKER_CLIENT_SECRET'], docsUrl: 'https://apisetu.gov.in/digilocker', sandbox: 'Through partner onboarding.', consent: 'Client-initiated DigiLocker consent flow.' },
  { id: '1.5', category: 'KYC_IDENTITY', name: 'Document OCR / Verification', provider: 'HyperVerge', purpose: 'Extract fields from KYC documents; structured parse in the document centre.', module: 'DOCUMENTS', implementation: 'INTEGRATION_POINT', envVars: E.hyperverge, docsUrl: 'https://documentation.hyperverge.co/api-reference/india_api/OCR%20APIs/driving_licence_ocr_api', sandbox: 'Provider staging.' },
  { id: '1.6', category: 'KYC_IDENTITY', name: 'Bank Account Verification (KYC)', provider: 'Setu', purpose: 'Penny-drop account verification during KYC.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: E.setu('BAV'), docsUrl: 'https://docs.setu.co/data/bav/penny-drop/api-integration/sync', sandbox: 'https://dg-sandbox.setu.co' },
  { id: '1.7', category: 'KYC_IDENTITY', name: 'Mobile Verification', provider: 'HyperVerge', purpose: 'Mobile-number account detection and identity signals.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: E.hyperverge, endpoint: 'POST https://ind-thomas.hyperverge.co/v1/mobileLookup', docsUrl: 'https://documentation.hyperverge.co/api-reference/', sandbox: 'Provider onboarding.' },
  { id: '1.8', category: 'KYC_IDENTITY', name: 'Email OTP Verification', provider: 'MSG91', purpose: 'Email ownership via OTP (client portal).', module: 'CLIENT_PORTAL', implementation: 'INTEGRATION_POINT', envVars: ['MSG91_AUTHKEY'], docsUrl: 'https://docs.msg91.com/otp-widget', sandbox: 'Provider account required.' },
  { id: '1.9', category: 'KYC_IDENTITY', name: 'Address Verification', provider: 'Mappls', purpose: 'Geographic validity and consistency of a declared address.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: ['MAPPLS_CLIENT_ID', 'MAPPLS_CLIENT_SECRET'], docsUrl: 'https://developer.mappls.com/documentation/sdk/rest-apis/mappls-reserved-apis/mappls-location-verification-api/readme', sandbox: 'Requires Mappls account.' },

  /* ---------------- 2. Banking & Financial ---------------- */
  { id: '2.1', category: 'BANKING_FINANCIAL', name: 'Bank Account Verification', provider: 'Setu', purpose: 'Penny drop: verification status, account-holder name, reference.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: E.setu('BAV'), endpoint: 'POST /api/verify/ban (sync), POST /api/verify/ban/async', docsUrl: 'https://docs.setu.co/data/bav/penny-drop/quickstart', sandbox: 'https://dg-sandbox.setu.co' },
  { id: '2.2', category: 'BANKING_FINANCIAL', name: 'Bank Statement', provider: 'Setu Insights', purpose: 'Balances, transactions and financial insights from AA data or PDF statements.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.setu('INSIGHTS'), endpoint: 'POST /v3/fiData, POST /v3/pdf-ingest', docsUrl: 'https://docs.setu.co/data/insights/quickstart', sandbox: 'https://di-uat.setu.co' },
  { id: '2.3', category: 'BANKING_FINANCIAL', name: 'Account Aggregator', provider: 'Setu AA', purpose: 'Consented financial data through the AA framework.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.setu('AA'), docsUrl: 'https://docs.setu.co/data/account-aggregator/quickstart', sandbox: 'Setu AA sandbox; production needs Sahamati onboarding.', consent: 'Client approves an AA consent artefact; purpose and validity are bound to it.' },
  { id: '2.4', category: 'BANKING_FINANCIAL', name: 'Financial Information (FI data)', provider: 'Setu AA', purpose: 'Profile, account summary and transactions via data sessions.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.setu('AA'), endpoint: 'POST /sessions, GET /sessions/:id', docsUrl: 'https://docs.setu.co/data/account-aggregator/fi-data-types', sandbox: 'Setu FIP mock data.', consent: 'AA consent required.' },
  { id: '2.5', category: 'BANKING_FINANCIAL', name: 'FD / Deposit Information', provider: 'Setu AA', purpose: 'DEPOSIT, TERM_DEPOSIT, RECURRING_DEPOSIT FI types.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.setu('AA'), docsUrl: 'https://docs.setu.co/data/account-aggregator/fi-data-types', sandbox: 'Setu FIP mock data.', consent: 'AA consent required.' },
  { id: '2.6', category: 'BANKING_FINANCIAL', name: 'Source of Funds', provider: 'Perfios', purpose: 'Bank-statement analysis / income verification.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: ['PERFIOS_CLIENT_ID', 'PERFIOS_CLIENT_SECRET'], docsUrl: 'https://perfios.ai/in/products/perfios-hub', sandbox: 'Through Perfios Hub.' },
  { id: '2.7', category: 'BANKING_FINANCIAL', name: 'Source of Wealth', provider: 'Setu AA', purpose: 'Deposits, MFs, bonds, G-secs, AIFs, equities for source-of-wealth assessment.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.setu('AA'), docsUrl: 'https://docs.setu.co/data/account-aggregator/fi-data-types', sandbox: 'Setu FIP mock data.', consent: 'AA consent required.' },
  { id: '2.8', category: 'BANKING_FINANCIAL', name: 'Asset & Concentration Analysis', provider: 'Setu Insights', purpose: 'Portfolio insights from AA data or statements.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.setu('INSIGHTS'), endpoint: 'POST /v3/insight, GET /v3/insight?reportId=', docsUrl: 'https://docs.setu.co/data/insights/quickstart', sandbox: 'https://di-uat.setu.co' },

  /* ---------------- 3. Credit ---------------- */
  { id: '3.1', category: 'CREDIT', name: 'Credit Score', provider: 'TransUnion CIBIL', purpose: 'Consumer credit score for the credit domain.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: ['CIBIL_MEMBER_CODE', 'CIBIL_API_KEY'], docsUrl: 'https://apimarketplace.transunioncibil.com/', sandbox: 'UAT after KAM approval.', consent: 'Bureau pull requires explicit client consent and permitted purpose.' },
  { id: '3.2', category: 'CREDIT', name: 'Credit Report', provider: 'TransUnion CIBIL', purpose: 'Full credit report and history.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: ['CIBIL_MEMBER_CODE', 'CIBIL_API_KEY'], docsUrl: 'https://apimarketplace.transunioncibil.com/', sandbox: 'UAT after KAM approval.', consent: 'Bureau consent required.' },
  { id: '3.3', category: 'CREDIT', name: 'Credit Risk', provider: 'TransUnion CIBIL', purpose: 'Risk scores incl. new-to-credit.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: ['CIBIL_MEMBER_CODE', 'CIBIL_API_KEY'], docsUrl: 'https://apimarketplace.transunioncibil.com/', sandbox: 'UAT after KAM approval.', consent: 'Bureau consent required.' },
  { id: '3.4', category: 'CREDIT', name: 'Commercial Credit', provider: 'CRIF High Mark', purpose: 'Business credit information.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: ['CRIF_USER_ID', 'CRIF_API_KEY'], docsUrl: 'https://www.crifhighmark.com/', sandbox: 'Contact CRIF.' },

  /* ---------------- 4. Employment ---------------- */
  { id: '4.1', category: 'EMPLOYMENT', name: 'UAN Verification', provider: 'Attestr', purpose: 'UAN validity, employee name, employer, member ID, joining/exit dates.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: E.attestr, endpoint: 'POST https://api.attestr.com/api/v2/public/checkx/epfo/uan', docsUrl: 'https://docs.attestr.com/attestr-docs/epfo-uan-verification-employment-history-api', sandbox: 'Not specified.', consent: 'Explicit, verifiable consent under Attestr DPDP V3.' },
  { id: '4.2', category: 'EMPLOYMENT', name: 'UAN Lookup', provider: 'Indiconnect', purpose: 'UAN from a registered mobile number.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: E.indiconnect, endpoint: 'POST https://api.staging.indiconnect.in/idverifygr/verification (GraphQL)', docsUrl: 'https://developer.indiconnect.in/32552580e0', sandbox: 'Staging endpoint with test credentials.' },
  { id: '4.3', category: 'EMPLOYMENT', name: 'Employment History', provider: 'Attestr', purpose: 'EPFO employment history by UAN.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: E.attestr, endpoint: 'POST https://api.attestr.com/api/v2/public/checkx/epfo/uan', docsUrl: 'https://docs.attestr.com/attestr-docs/epfo-uan-verification-employment-history-api', sandbox: 'Not specified.', consent: 'DPDP V3 consent.' },
  { id: '4.4', category: 'EMPLOYMENT', name: 'Current Employment', provider: 'Scofit', purpose: 'Status, tenure, estimated income, PF balance.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: E.scofit, endpoint: 'POST https://api.scofit.app/v1/employment/verify', docsUrl: 'https://www.scofit.app/apis/employment-verification/', sandbox: 'Confirm with Scofit onboarding.' },
  { id: '4.5', category: 'EMPLOYMENT', name: 'Previous Employment', provider: 'Attestr', purpose: 'Previous employers via UAN.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: E.attestr, docsUrl: 'https://docs.attestr.com/attestr-docs/epfo-uan-verification-employment-history-api', sandbox: 'Not specified.', consent: 'DPDP V3 consent.' },
  { id: '4.6', category: 'EMPLOYMENT', name: 'Employer Verification', provider: 'FastKYC', purpose: 'Employer, role, employment type, service length.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: ['FASTKYC_API_KEY'], docsUrl: 'https://fastkyc.com/apis/current-employment-details/', sandbox: 'Dev console / free trial.' },
  { id: '4.7', category: 'EMPLOYMENT', name: 'Employment Status', provider: 'Scofit', purpose: 'Active / exited / transferred with PF history.', module: 'VERIFICATION_INGEST', implementation: 'INTEGRATION_POINT', envVars: E.scofit, endpoint: 'POST https://api.scofit.app/v1/employment/verify', docsUrl: 'https://www.scofit.app/apis/employment-verification/', sandbox: 'Confirm with Scofit onboarding.' },

  /* ---------------- 5. Corporate & Tax ---------------- */
  { id: '5.1', category: 'CORPORATE_TAX', name: 'MCA Company Verification', provider: 'Attestr', purpose: 'Company master data by CIN / LLPIN (status, capital, address, directors).', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'attestr-mca', supersedesSandbox: 'mca-sandbox', envVars: E.attestr, endpoint: 'POST https://api.attestr.com/api/v2/public/corpx/business/master', docsUrl: 'https://docs.attestr.com/attestr-docs/indian-company-registration-verification-api', sandbox: 'Not specified.', consent: 'Director personal data (DIN/PAN) needs DPDP V3 consent.' },
  { id: '5.2', category: 'CORPORATE_TAX', name: 'Director Verification', provider: 'Attestr', purpose: 'Directors, DIN, designation, appointment date, disqualification.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'attestr-mca', supersedesSandbox: 'mca-sandbox', envVars: E.attestr, docsUrl: 'https://docs.attestr.com/attestr-docs/indian-company-registration-verification-api', sandbox: 'Not specified.', consent: 'DPDP V3 consent.' },
  { id: '5.3', category: 'CORPORATE_TAX', name: 'Company Search', provider: 'Attestr', purpose: 'Registered companies by name (employer resolution).', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'attestr-mca', supersedesSandbox: 'mca-sandbox', envVars: E.attestr, endpoint: 'POST https://api.attestr.com/api/v2/public/corpx/business/autocomplete', docsUrl: 'https://docs.attestr.com/attestr-docs/company-name-autocomplete-api', sandbox: 'Not specified.' },
  { id: '5.4', category: 'CORPORATE_TAX', name: 'LLP Verification', provider: 'Attestr', purpose: 'LLP registration, status, partners.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'attestr-mca', supersedesSandbox: 'mca-sandbox', envVars: E.attestr, docsUrl: 'https://docs.attestr.com/attestr-docs/indian-company-registration-verification-api', sandbox: 'Not specified.' },
  { id: '5.5', category: 'CORPORATE_TAX', name: 'GST Verification', provider: 'HyperVerge', purpose: 'GST registration details by GSTIN.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'INTEGRATION_POINT', envVars: E.hyperverge, docsUrl: 'https://documentation.hyperverge.co/api-reference/india_api/', sandbox: 'Not specified.' },
  { id: '5.6', category: 'CORPORATE_TAX', name: 'GSTIN Details', provider: 'HyperVerge', purpose: 'GSTIN business details.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'INTEGRATION_POINT', envVars: E.hyperverge, docsUrl: 'https://documentation.hyperverge.co/api-reference/india_api/', sandbox: 'Not specified.' },
  { id: '5.7', category: 'CORPORATE_TAX', name: 'Udyam / MSME Verification', provider: 'Indiconnect', purpose: 'Udyam registration details without OTP.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'INTEGRATION_POINT', envVars: E.indiconnect, endpoint: 'POST https://api.staging.indiconnect.in/idverifygr/verification (GraphQL)', docsUrl: 'https://developer.indiconnect.in/31360625e0', sandbox: 'Staging endpoint with test credentials.' },

  /* ---------------- 6. AML & Compliance ---------------- */
  { id: '6.1', category: 'AML_COMPLIANCE', name: 'AML Screening', provider: 'Dilisense', purpose: 'Sanctions, PEP, criminal and warning lists in one checkIndividual call.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'dilisense', supersedesSandbox: 'sanctions-sandbox', envVars: ['DILISENSE_API_KEY'], endpoint: 'GET https://api.dilisense.com/v1/checkIndividual', docsUrl: 'https://developers.dilisense.com/', sandbox: 'Free developer tier - 100 requests / month.' },
  { id: '6.2', category: 'AML_COMPLIANCE', name: 'PEP Screening', provider: 'Dilisense', purpose: 'PEP and PEP-class matches with pep_type.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'dilisense', supersedesSandbox: 'sanctions-sandbox', envVars: ['DILISENSE_API_KEY'], endpoint: 'GET https://api.dilisense.com/v1/checkIndividual', docsUrl: 'https://developers.dilisense.com/', sandbox: 'Free developer tier - 100 requests / month.' },
  { id: '6.3', category: 'AML_COMPLIANCE', name: 'Sanctions Screening', provider: 'OpenSanctions', purpose: 'Query-by-example match against consolidated sanctions, export-control and watch lists.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'opensanctions', supersedesSandbox: 'sanctions-sandbox', envVars: ['OPENSANCTIONS_API_KEY'], endpoint: 'POST https://api.opensanctions.org/match/default', docsUrl: 'https://www.opensanctions.org/docs/api/', sandbox: 'Free community tier for testing.' },
  { id: '6.4', category: 'AML_COMPLIANCE', name: 'Adverse Media', provider: 'Dilisense', purpose: 'Adverse-media articles (6 categories) as NEWS findings via GET /v1/media/checkIndividual. Separate Dilisense product: set DILISENSE_ADVERSE_MEDIA=true once subscribed.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'dilisense', supersedesSandbox: 'sanctions-sandbox', envVars: ['DILISENSE_API_KEY'], docsUrl: 'https://developers.dilisense.com/', sandbox: 'Free developer tier - 100 requests / month.' },
  { id: '6.5', category: 'AML_COMPLIANCE', name: 'Ongoing Monitoring', provider: 'OpenSanctions', purpose: 'Re-run the match on the continuous-refresh schedule; changed_since filter surfaces new designations.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'INTEGRATION_POINT', envVars: ['OPENSANCTIONS_API_KEY'], endpoint: 'POST https://api.opensanctions.org/match/default?changed_since=', docsUrl: 'https://www.opensanctions.org/docs/api/', sandbox: 'Free community tier for testing.' },

  /* ---------------- 7. Legal ---------------- */
  { id: '7.1', category: 'LEGAL', name: 'Court Records', provider: 'eCourtsIndia', purpose: 'Supreme Court, High Courts, District Courts.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'ecourts', supersedesSandbox: 'courts-sandbox', envVars: E.ecourts, endpoint: 'https://webapi.ecourtsindia.com', docsUrl: 'https://ecourtsindia.com/api/docs', sandbox: 'No sandbox; INR 200 free credits on signup.' },
  { id: '7.2', category: 'LEGAL', name: 'Tribunal Records', provider: 'eCourtsIndia', purpose: 'NCLT, NCLAT and other tribunals.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'ecourts', supersedesSandbox: 'courts-sandbox', envVars: E.ecourts, docsUrl: 'https://ecourtsindia.com/api/docs', sandbox: 'No sandbox; free credits on signup.' },
  { id: '7.3', category: 'LEGAL', name: 'Litigation Search', provider: 'eCourtsIndia', purpose: 'Search by litigant / petitioner / respondent.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'ecourts', supersedesSandbox: 'courts-sandbox', envVars: E.ecourts, endpoint: 'GET /api/partner/search', docsUrl: 'https://ecourtsindia.com/api/docs', sandbox: 'No sandbox; free credits on signup.' },
  { id: '7.4', category: 'LEGAL', name: 'Legal Case Monitoring', provider: 'eCourtsIndia', purpose: 'Case refresh / bulk refresh for continuous monitoring.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'INTEGRATION_POINT', envVars: E.ecourts, endpoint: 'POST /api/partner/case/{cnr}/refresh', docsUrl: 'https://ecourtsindia.com/api/docs', sandbox: 'No sandbox.' },
  { id: '7.5', category: 'LEGAL', name: 'Court Orders / Judgments', provider: 'eCourtsIndia', purpose: 'Order PDFs and extracted text.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'INTEGRATION_POINT', envVars: E.ecourts, endpoint: 'GET /api/partner/case/{cnr}/order/{filename}', docsUrl: 'https://ecourtsindia.com/api/docs', sandbox: 'No sandbox.' },

  /* ---------------- 8. Investments ---------------- */
  { id: '8.1', category: 'INVESTMENTS', name: 'Mutual Fund Holdings', provider: 'CASParser', purpose: 'Folios, holdings, transactions from CAMS/KFintech CAS.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.casparser, endpoint: 'POST https://api.casparser.in/v4/smart/parse', docsUrl: 'https://casparser.in/docs', sandbox: 'API key sandbox-with-json-responses returns samples.' },
  { id: '8.2', category: 'INVESTMENTS', name: 'Consolidated Account Statement', provider: 'CASParser', purpose: 'Investor details and MF data.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.casparser, endpoint: 'POST https://api.casparser.in/v4/cams_kfintech/parse', docsUrl: 'https://casparser.in/docs/quickstart', sandbox: 'sandbox-with-json-responses' },
  { id: '8.3', category: 'INVESTMENTS', name: 'Demat / Securities Holdings', provider: 'CASParser', purpose: 'CDSL / NSDL holdings.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.casparser, endpoint: 'POST https://api.casparser.in/v4/cdsl/parse | /v4/nsdl/parse', docsUrl: 'https://casparser.in/docs/quickstart', sandbox: 'sandbox-with-json-responses' },
  { id: '8.4', category: 'INVESTMENTS', name: 'Equity Holdings', provider: 'CASParser', purpose: 'Equity holdings from CDSL/NSDL.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.casparser, docsUrl: 'https://casparser.in/docs/quickstart', sandbox: 'sandbox-with-json-responses' },
  { id: '8.5', category: 'INVESTMENTS', name: 'Bonds / Government Securities', provider: 'CASParser', purpose: 'Bond and G-sec holdings.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.casparser, docsUrl: 'https://casparser.in/docs/quickstart', sandbox: 'sandbox-with-json-responses' },
  { id: '8.6', category: 'INVESTMENTS', name: 'AIF Holdings', provider: 'CASParser', purpose: 'AIF units and values.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.casparser, docsUrl: 'https://casparser.in/docs/quickstart', sandbox: 'sandbox-with-json-responses' },
  { id: '8.7', category: 'INVESTMENTS', name: 'Insurance / NPS Holdings', provider: 'CASParser', purpose: 'Insurance and NPS holdings.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.casparser, endpoint: 'POST https://api.casparser.in/v4/smart/parse', docsUrl: 'https://casparser.in/docs/quickstart', sandbox: 'sandbox-with-json-responses' },
  { id: '8.8', category: 'INVESTMENTS', name: 'Portfolio Analytics', provider: 'CASParser', purpose: 'Allocation and portfolio insights.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.casparser, docsUrl: 'https://casparser.in/docs/quickstart', sandbox: 'sandbox-with-json-responses' },
  { id: '8.9', category: 'INVESTMENTS', name: 'Mutual Fund Portfolio Data', provider: 'CASParser', purpose: 'Schemes, units, valuations.', module: 'WEALTH', implementation: 'INTEGRATION_POINT', envVars: E.casparser, docsUrl: 'https://casparser.in/docs/quickstart', sandbox: 'sandbox-with-json-responses' },

  /* ---------------- 9. Property & Land ---------------- */
  { id: '9.1', category: 'PROPERTY_LAND', name: 'Patta / Chitta', provider: 'TamilNilam', purpose: 'Land-record details.', module: 'PROPERTY', implementation: 'PORTAL_ONLY', envVars: ['TAMILNILAM_API_KEY'], docsUrl: 'https://eservices.tn.gov.in/eservicesnew', sandbox: 'API for authorised stakeholders only; not publicly documented.' },
  { id: '9.2', category: 'PROPERTY_LAND', name: 'FMB / Survey Records', provider: 'TamilNilam', purpose: 'Field measurement and boundaries.', module: 'PROPERTY', implementation: 'PORTAL_ONLY', envVars: ['TAMILNILAM_API_KEY'], docsUrl: 'https://eservices.tn.gov.in/eservicesnew', sandbox: 'Not publicly documented.' },
  { id: '9.3', category: 'PROPERTY_LAND', name: 'A-Register', provider: 'TamilNilam', purpose: 'A-Register land details.', module: 'PROPERTY', implementation: 'PORTAL_ONLY', envVars: ['TAMILNILAM_API_KEY'], docsUrl: 'https://eservices.tn.gov.in/eservicesnew', sandbox: 'Not publicly documented.' },
  { id: '9.4', category: 'PROPERTY_LAND', name: 'Property Ownership', provider: 'TamilNilam', purpose: 'Recorded landowner / Patta details.', module: 'PROPERTY', implementation: 'PORTAL_ONLY', envVars: ['TAMILNILAM_API_KEY'], docsUrl: 'https://eservices.tn.gov.in/eservicesnew', sandbox: 'Not publicly documented.' },
  { id: '9.5', category: 'PROPERTY_LAND', name: 'Patta Transfer History', provider: 'TamilNilam', purpose: 'Mutation history.', module: 'PROPERTY', implementation: 'PORTAL_ONLY', envVars: ['TAMILNILAM_API_KEY'], docsUrl: 'https://tamilnilam.tn.gov.in/citizen/', sandbox: 'Not publicly documented.' },
  { id: '9.6', category: 'PROPERTY_LAND', name: 'Encumbrance Certificate (EC)', provider: 'TNREGINET', purpose: 'Registered encumbrances.', module: 'PROPERTY', implementation: 'PORTAL_ONLY', envVars: ['TNREGINET_API_KEY'], docsUrl: 'https://tnreginet.gov.in/', sandbox: 'UAT portal https://uat.tnregn.in/portal; no API sandbox.' },
  { id: '9.7', category: 'PROPERTY_LAND', name: 'Registration Records', provider: 'TNREGINET', purpose: 'Registered documents and transactions.', module: 'PROPERTY', implementation: 'PORTAL_ONLY', envVars: ['TNREGINET_API_KEY'], docsUrl: 'https://tnreginet.gov.in/', sandbox: 'UAT portal; no API sandbox.' },
  { id: '9.8', category: 'PROPERTY_LAND', name: 'RERA Verification', provider: 'Profiden', purpose: 'Project / agent RERA registration status.', module: 'PROPERTY', implementation: 'INTEGRATION_POINT', envVars: ['PROFIDEN_API_KEY'], endpoint: 'POST /v1/rera-verification', docsUrl: 'https://console.profiden.com/docs/rera-verification', sandbox: 'Sandbox demo hits before billing.' },
  { id: '9.9', category: 'PROPERTY_LAND', name: 'Project Registration', provider: 'Profiden', purpose: 'RERA project registration validity.', module: 'PROPERTY', implementation: 'INTEGRATION_POINT', envVars: ['PROFIDEN_API_KEY'], endpoint: 'POST /v1/rera-verification', docsUrl: 'https://console.profiden.com/docs/rera-verification', sandbox: 'Sandbox demo hits before billing.' },
  { id: '9.10', category: 'PROPERTY_LAND', name: 'Property Approvals (CMDA / DTCP)', provider: 'LandLens', purpose: 'Planning permission, building and layout approvals.', module: 'PROPERTY', implementation: 'LIVE_CONNECTOR', connectorKey: 'landlens', envVars: E.landlens, endpoint: 'POST https://verified.realestate/api/v1/tools/ppa_approval', docsUrl: 'https://verified.realestate/landlens/mcp', sandbox: 'No separate sandbox.' },
  { id: '9.11', category: 'PROPERTY_LAND', name: 'Title Chain', provider: 'NIC Property Chain', purpose: 'Ownership and transaction history.', module: 'PROPERTY', implementation: 'PORTAL_ONLY', envVars: ['PROPERTYCHAIN_API_KEY'], docsUrl: 'https://propertychain.nic.in/', sandbox: 'Authorised stakeholder onboarding via NAPIX.' },
  { id: '9.12', category: 'PROPERTY_LAND', name: 'Parent Documents', provider: 'Landeed', purpose: 'Historical / parent property documents.', module: 'PROPERTY', implementation: 'INTEGRATION_POINT', envVars: ['LANDEED_API_KEY'], docsUrl: 'https://www.landeed.com/document-procurement-api', sandbox: 'Through developer sales.' },
  { id: '9.13', category: 'PROPERTY_LAND', name: 'Property Litigation', provider: 'eCourtsIndia', purpose: 'Litigation tied to a property / owner.', module: 'PROPERTY', implementation: 'LIVE_CONNECTOR', connectorKey: 'ecourts', supersedesSandbox: 'courts-sandbox', envVars: E.ecourts, endpoint: 'GET /api/partner/search', docsUrl: 'https://ecourtsindia.com/api/docs', sandbox: 'No sandbox; free credits on signup.' },
  { id: '9.14', category: 'PROPERTY_LAND', name: 'Property Valuation / Guideline Value', provider: 'LandLens', purpose: 'Government guideline value for stamp duty; refreshes project price intelligence.', module: 'PROPERTY', implementation: 'LIVE_CONNECTOR', connectorKey: 'landlens', envVars: E.landlens, endpoint: 'POST https://verified.realestate/api/v1/tools/guideline_value', docsUrl: 'https://verified.realestate/landlens/mcp', sandbox: 'No separate sandbox; guideline_value is free.' },
  { id: '9.15', category: 'PROPERTY_LAND', name: 'Access Verification', provider: 'LandLens', purpose: 'Road width, frontage, survey-to-location, approval search.', module: 'PROPERTY', implementation: 'LIVE_CONNECTOR', connectorKey: 'landlens', envVars: E.landlens, endpoint: 'POST https://verified.realestate/api/v1/tools/{road_width|survey_to_location|approval_search}', docsUrl: 'https://verified.realestate/landlens/mcp', sandbox: '60 calls/min, 3 000 calls/day.' },

  /* ---------------- 10. Public & Professional ---------------- */
  { id: '10.1', category: 'PUBLIC_PROFESSIONAL', name: 'Professional Profile Verification', provider: 'LinkedIn', purpose: 'Verified-on-LinkedIn identity / workplace status.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'INTEGRATION_POINT', envVars: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'], endpoint: 'GET https://api.linkedin.com/rest/verificationReport', docsUrl: 'https://learn.microsoft.com/en-us/linkedin/consumer/integrations/verified-on-linkedin/overview', sandbox: 'Development tier.', consent: 'OAuth 2.0 member consent - client-initiated only.' },
  { id: '10.2', category: 'PUBLIC_PROFESSIONAL', name: 'Public Web Search', provider: 'Brave Search', purpose: 'Web mentions for digital-footprint review.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'brave-web', supersedesSandbox: 'web-sandbox', envVars: E.brave, endpoint: 'GET https://api.search.brave.com/res/v1/web/search', docsUrl: 'https://api-dashboard.search.brave.com/documentation', sandbox: 'Developer API access.' },
  { id: '10.3', category: 'PUBLIC_PROFESSIONAL', name: 'Public Social Profiles', provider: 'Meta Graph API', purpose: 'Permitted profile information.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'INTEGRATION_POINT', envVars: ['META_APP_ID', 'META_APP_SECRET'], docsUrl: 'https://developers.facebook.com/docs/graph-api/', sandbox: 'Meta for Developers test tools.', consent: 'OAuth access token from the client.' },
  { id: '10.4', category: 'PUBLIC_PROFESSIONAL', name: 'Instagram Professional Profiles', provider: 'Instagram Platform', purpose: 'Business / creator account information.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'INTEGRATION_POINT', envVars: ['META_APP_ID', 'META_APP_SECRET'], docsUrl: 'https://developers.facebook.com/docs/instagram-platform/', sandbox: 'Meta for Developers test tools.', consent: 'OAuth user authorisation.' },
  { id: '10.5', category: 'PUBLIC_PROFESSIONAL', name: 'News / Media Search', provider: 'Brave News Search', purpose: 'News coverage routed through adverse-media classification.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'brave-news', supersedesSandbox: 'media-sandbox', envVars: E.brave, endpoint: 'GET https://api.search.brave.com/res/v1/news/search', docsUrl: 'https://api-dashboard.search.brave.com/documentation', sandbox: 'Developer API access.' },
  { id: '10.6', category: 'PUBLIC_PROFESSIONAL', name: 'Adverse Media Screening', provider: 'ComplyAdvantage', purpose: 'Adverse media alongside sanctions and PEP.', module: 'EXTERNAL_INTELLIGENCE', implementation: 'LIVE_CONNECTOR', connectorKey: 'complyadvantage', supersedesSandbox: 'sanctions-sandbox', envVars: E.complyadvantage, endpoint: 'POST https://api.complyadvantage.com/searches', docsUrl: 'https://docs.complyadvantage.com/', sandbox: 'Sandbox accounts.' },
];

export type Env = Record<string, string | undefined>;

/** True when every env var the entry needs is present and non-empty. */
export function isConfigured(entry: IntegrationEntry, env: Env = process.env): boolean {
  return entry.envVars.length > 0 && entry.envVars.every((k) => !!env[k]?.trim());
}

export function integrationStatus(entry: IntegrationEntry, env: Env = process.env): IntegrationStatus {
  if (isConfigured(entry, env)) return entry.implementation === 'PORTAL_ONLY' ? 'MANUAL' : 'LIVE';
  if (entry.implementation === 'PORTAL_ONLY') return 'MANUAL';
  if (entry.supersedesSandbox) return 'SANDBOX_FALLBACK';
  return 'NOT_CONFIGURED';
}

export const STATUS_LABEL: Record<IntegrationStatus, string> = {
  LIVE: 'Live',
  SANDBOX_FALLBACK: 'Sandbox fallback',
  NOT_CONFIGURED: 'Not configured',
  MANUAL: 'Manual / portal',
};

export interface CatalogSummary {
  total: number;
  live: number;
  sandboxFallback: number;
  notConfigured: number;
  manual: number;
  /** Distinct env var names still missing, sorted. */
  missingEnvVars: string[];
}

export function summarizeCatalog(env: Env = process.env, catalog: IntegrationEntry[] = INTEGRATION_CATALOG): CatalogSummary {
  const s: CatalogSummary = { total: catalog.length, live: 0, sandboxFallback: 0, notConfigured: 0, manual: 0, missingEnvVars: [] };
  const missing = new Set<string>();
  for (const e of catalog) {
    const st = integrationStatus(e, env);
    if (st === 'LIVE') s.live++;
    else if (st === 'SANDBOX_FALLBACK') s.sandboxFallback++;
    else if (st === 'MANUAL') s.manual++;
    else s.notConfigured++;
    if (st !== 'LIVE' && e.implementation !== 'PORTAL_ONLY') for (const k of e.envVars) if (!env[k]?.trim()) missing.add(k);
  }
  s.missingEnvVars = [...missing].sort();
  return s;
}

/** Entries grouped by category in catalogue order. */
export function groupCatalog(catalog: IntegrationEntry[] = INTEGRATION_CATALOG): Array<{ category: IntegrationCategory; label: string; entries: IntegrationEntry[] }> {
  const order = Object.keys(CATEGORY_LABEL) as IntegrationCategory[];
  return order.map((category) => ({ category, label: CATEGORY_LABEL[category], entries: catalog.filter((e) => e.category === category) })).filter((g) => g.entries.length);
}

/** All env var names the catalogue knows about (for .env.example generation and admin diagnostics). */
export function catalogEnvVars(catalog: IntegrationEntry[] = INTEGRATION_CATALOG): string[] {
  return [...new Set(catalog.flatMap((e) => e.envVars))].sort();
}
