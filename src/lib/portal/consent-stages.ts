/**
 * Two-stage client consent (mirrors docs: "BENFILE Client Consent & Screening Authorisation").
 *
 *   PRELIMINARY - Part A: limited screening a prospect can accept on their phone before a first
 *                 meeting. Public records, screening lists, PAN name match, phone / e-mail
 *                 ownership and profiles the person nominates. Never Aadhaar, credit, bank,
 *                 employment or investment data. Valid 30 days.
 *   FULL        - Part B: KYC, financial and intelligence consent at onboarding. Valid 365 days.
 *
 * Shared by the client portal (what the person ticks), the server RPC (what is enforced) and
 * the staff UI (what is displayed). Pure data - no I/O.
 */
export type ConsentStage = 'PRELIMINARY' | 'FULL';

export const CONSENT_TERMS_VERSION = '2026-10-12';

export interface ConsentSourceOption {
  key: string;
  label: string;
  description: string;
  /** Pre-ticked when the person opens the stage. */
  default: boolean;
}

export interface ConsentStageDefinition {
  stage: ConsentStage;
  part: 'A' | 'B';
  title: string;
  purpose: string;
  purposeCode: string;
  validityDays: number;
  summary: string;
  notDone: string[];
  sources: ConsentSourceOption[];
  agreementText: string;
}

const A_SOURCES: ConsentSourceOption[] = [
  { key: 'IDENTITY', label: 'PAN validity and name match', description: 'Checks that the PAN you give is valid and matches your name. Stored masked.', default: true },
  { key: 'CONTACT', label: 'E-mail ownership', description: 'A one-time code to confirm the e-mail is yours.', default: true },
  { key: 'MOBILE', label: 'Mobile ownership and account signals', description: 'A one-time code to confirm the number is yours and a check of accounts linked to it.', default: true },
  { key: 'SCREENING', label: 'Sanctions, PEP and adverse-media lists', description: 'Public and licensed watch lists. A name match alone is never treated as a fact about you.', default: true },
  { key: 'CORPORATE', label: 'Public company records', description: 'Companies, LLPs and directorships in your name or your employer’s (MCA).', default: true },
  { key: 'LEGAL', label: 'Public court and tribunal records', description: 'Cases in your name on eCourts. Reviewed by a person before anything is recorded.', default: true },
  { key: 'MEDIA', label: 'News search', description: 'Your name together with your employer or city.', default: true },
  { key: 'WEB', label: 'Public web search', description: 'Your name together with your employer or city.', default: false },
  { key: 'PROFESSIONAL', label: 'Professional profile I nominate', description: 'A public LinkedIn profile you name. No login, no connection requests.', default: false },
  { key: 'SOCIAL', label: 'Social profiles I nominate', description: 'Public Facebook or Instagram profiles you name. No login, no private content.', default: false },
];

const B_SOURCES: ConsentSourceOption[] = [
  { key: 'IDENTITY', label: 'Identity (Aadhaar OTP eKYC, PAN, passport)', description: 'Only masked Aadhaar is stored. You complete the Aadhaar OTP yourself.', default: true },
  { key: 'DOCUMENTS', label: 'Documents I upload or share', description: 'PAN, Aadhaar, passport, address and income proofs, DigiLocker.', default: true },
  { key: 'ADDRESS', label: 'Address verification', description: 'Geographic validation of your current and permanent address.', default: true },
  { key: 'CONTACT', label: 'E-mail verification', description: 'One-time code.', default: true },
  { key: 'MOBILE', label: 'Mobile verification', description: 'One-time code and mobile-linked account signals.', default: true },
  { key: 'BANKING', label: 'Bank account and statements', description: 'Account ownership (penny drop) and, with a separate Account Aggregator approval, balances and transactions for the period you approve.', default: true },
  { key: 'CREDIT', label: 'Credit score and report', description: 'One bureau enquiry per consent period, with a separate bureau consent.', default: false },
  { key: 'EMPLOYMENT', label: 'Employment (EPFO / UAN)', description: 'Employer, tenure and employment history.', default: true },
  { key: 'SCREENING', label: 'Sanctions, PEP and adverse media', description: 'Refreshed on the agreed schedule until this consent expires.', default: true },
  { key: 'CORPORATE', label: 'Company and GST records', description: 'Companies, LLPs, directorships and GST registrations linked to you.', default: true },
  { key: 'LEGAL', label: 'Court records and property records', description: 'Court cases in your name; land records for property you declare.', default: true },
  { key: 'MEDIA', label: 'News search', description: 'Your name with your employer or city.', default: true },
  { key: 'WEB', label: 'Public web search', description: 'Your name with your employer or city.', default: false },
  { key: 'PROFESSIONAL', label: 'Professional profile I nominate', description: 'Through LinkedIn’s own consent flow.', default: false },
  { key: 'SOCIAL', label: 'Social profiles I nominate', description: 'Through Meta’s own consent flow.', default: false },
  { key: 'RISK', label: 'Risk signals and profile score', description: 'Computed from the data above. Not a credit score; no decision is made by automation alone.', default: true },
];

export const CONSENT_STAGES: Record<ConsentStage, ConsentStageDefinition> = {
  PRELIMINARY: {
    stage: 'PRELIMINARY',
    part: 'A',
    title: 'Part A - Preliminary screening',
    purpose: 'Preliminary screening before an initial consultation',
    purposeCode: 'PRELIMINARY_SCREENING',
    validityDays: 30,
    summary: 'A limited one-time check of your identity and public record before we discuss any product or property. It is voluntary; declining only means we will not proceed to a detailed discussion.',
    notDone: ['No Aadhaar lookup and no storage of your Aadhaar number', 'No credit bureau enquiry', 'No bank, Account Aggregator, EPFO, investment or property data', 'No contact with your employer, family or associates', 'No search of profiles you have not nominated'],
    sources: A_SOURCES,
    agreementText: 'I agree to the preliminary screening described in Part A. The screening is done once, within 30 days, and results are reviewed by a person before anything is recorded about me.',
  },
  FULL: {
    stage: 'FULL',
    part: 'B',
    title: 'Part B - Full verification and financial consent',
    purpose: 'KYC onboarding and ongoing due diligence',
    purposeCode: 'KYC_ONBOARDING',
    validityDays: 365,
    summary: 'Consent for the firm to collect, verify and analyse the categories you tick, for identity verification, anti-money-laundering obligations, suitability assessment and keeping a record of advice. Each category is independent; only the ticked ones are checked.',
    notDone: ['Your data is never sold or used for advertising', 'Aadhaar is authenticated by you via OTP; only the masked number is kept', 'Account Aggregator and credit bureau pulls need a separate approval each time', 'No product or property is declined solely on an automated score'],
    sources: B_SOURCES,
    agreementText: 'I have read the consent in a language I understand, the details I provide are mine and accurate, I give this consent freely, and I know how to withdraw it. I understand the firm relies on this data to meet legal obligations.',
  },
};

export const STAGE_LABEL: Record<string, string> = { PRELIMINARY_SCREENING: 'Part A - preliminary', KYC_ONBOARDING: 'Part B - full' };

/** Sources a stage may ever authorise (used by the server RPC to clamp what the client sends). */
export function allowedSources(stage: ConsentStage): string[] {
  return CONSENT_STAGES[stage].sources.map((s) => s.key);
}

export function defaultSources(stage: ConsentStage): string[] {
  return CONSENT_STAGES[stage].sources.filter((s) => s.default).map((s) => s.key);
}

/** Keep only sources the stage permits, in catalogue order. */
export function clampSources(stage: ConsentStage, requested: string[]): string[] {
  const allowed = allowedSources(stage);
  const set = new Set(requested.map((s) => s.toUpperCase()));
  return allowed.filter((s) => set.has(s));
}

export interface StageStatus {
  stage: ConsentStage;
  granted: boolean;
  expiresAt: string | null;
  expired: boolean;
}

/** Work out which stages are currently in force from the consent rows the portal sees. */
export function stageStatuses(consents: Array<{ purposeCode?: string | null; status: string; expiresAt?: string | null }>, now = new Date()): Record<ConsentStage, StageStatus> {
  const out = {} as Record<ConsentStage, StageStatus>;
  for (const stage of ['PRELIMINARY', 'FULL'] as ConsentStage[]) {
    const code = CONSENT_STAGES[stage].purposeCode;
    const rows = consents.filter((c) => c.purposeCode === code && c.status === 'GRANTED');
    const latest = rows.sort((a, b) => (b.expiresAt ?? '').localeCompare(a.expiresAt ?? ''))[0];
    const expired = !!latest?.expiresAt && new Date(latest.expiresAt) < now;
    out[stage] = { stage, granted: !!latest && !expired, expiresAt: latest?.expiresAt ?? null, expired };
  }
  return out;
}
