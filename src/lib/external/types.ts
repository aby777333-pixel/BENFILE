/**
 * External Intelligence connector contract.
 *
 * Every connector is modular and normalises into RawFinding[]; the orchestrator
 * runs entity resolution, de-duplication, evidence ranking and stores findings
 * as PENDING for human review. The UI never talks to a connector directly.
 */
import type { SourceClass, SourceTier } from '@/lib/canonical/types';
import type { CandidateAttributes, SubjectIdentity } from '@/lib/engines/entity-resolution';

export type ConnectorCapability =
  | 'searchPerson'
  | 'verifyIdentity'
  | 'searchCompanies'
  | 'searchDirectorships'
  | 'searchEmployment'
  | 'searchLegalRecords'
  | 'searchMedia'
  | 'searchProfessionalProfiles'
  | 'searchPublicSocialProfiles'
  | 'searchSanctions'
  | 'searchAssets'
  | 'refreshProfile';

export type ResultType =
  | 'GOVERNMENT_RECORD'
  | 'CORPORATE_RECORD'
  | 'DIRECTORSHIP'
  | 'PROFESSIONAL_PROFILE'
  | 'SOCIAL_PROFILE'
  | 'NEWS'
  | 'LEGAL_RECORD'
  | 'REGULATORY_RECORD'
  | 'PUBLIC_ASSET'
  | 'WEB_MENTION'
  | 'SANCTIONS_SCREEN'
  | 'PEP_SCREEN';

export type EntityRole = 'PLAINTIFF' | 'DEFENDANT' | 'PETITIONER' | 'RESPONDENT' | 'WITNESS' | 'DIRECTOR_OF_INVOLVED_COMPANY' | 'OTHER_PARTY' | 'UNKNOWN';

export interface RawFinding {
  recordId: string;
  resultType: ResultType;
  title: string;
  excerpt: string | null;
  url: string | null;
  publishedAt: string | null;
  sourceName: string;
  /** Attributes the entity-resolution engine compares against the subject. */
  candidate: CandidateAttributes;
  /** Structured record (company master data, case fields, profile fields, career timeline...). */
  data: Record<string, unknown>;
  entityRole?: EntityRole;
  category?: string;
  /** Provided by Tier 1 connectors when an official identifier positively resolved. */
  officialRecordMatch?: boolean;
}

export interface ConnectorContext {
  purpose: string;
  consentSources: string[];
  /** Hard limit on results per connector call - connectors must respect provider rate limits. */
  maxResults: number;
  now: Date;
}

export interface ExternalConnector {
  key: string;
  name: string;
  sourceKey: string;
  sourceClass: SourceClass;
  tier: SourceTier;
  /** SANDBOX connectors return deterministic illustrative data and are labelled as such everywhere. */
  mode: 'LIVE' | 'SANDBOX';
  capabilities: ConnectorCapability[];
  /** Consent source keys this connector requires (e.g. 'CORPORATE', 'MEDIA'). */
  requiresConsentFor: string[];
  searchPerson?(subject: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]>;
  verifyIdentity?(subject: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]>;
  searchCompanies?(subject: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]>;
  searchDirectorships?(subject: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]>;
  searchEmployment?(subject: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]>;
  searchLegalRecords?(subject: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]>;
  searchMedia?(subject: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]>;
  searchProfessionalProfiles?(subject: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]>;
  searchPublicSocialProfiles?(subject: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]>;
  searchSanctions?(subject: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]>;
  searchAssets?(subject: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]>;
  refreshProfile?(subject: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]>;
}

export const RESULT_TYPE_LABEL: Record<ResultType, string> = {
  GOVERNMENT_RECORD: 'Government record',
  CORPORATE_RECORD: 'Corporate record',
  DIRECTORSHIP: 'Directorship',
  PROFESSIONAL_PROFILE: 'Professional profile',
  SOCIAL_PROFILE: 'Public social profile',
  NEWS: 'News / media',
  LEGAL_RECORD: 'Legal record',
  REGULATORY_RECORD: 'Regulatory record',
  PUBLIC_ASSET: 'Public asset',
  WEB_MENTION: 'Web mention',
  SANCTIONS_SCREEN: 'Sanctions screen',
  PEP_SCREEN: 'PEP screen',
};
