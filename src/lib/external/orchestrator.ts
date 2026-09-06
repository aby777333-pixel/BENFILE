/**
 * External Intelligence Orchestrator.
 *
 * Client Search Requested -> consent / lawful purpose -> normalise identity ->
 * connectors (government, corporate, professional, web, social, media) ->
 * entity resolution -> de-duplication -> evidence ranking -> stored PENDING for
 * human review -> Client 360 updated only after review.
 */
import type { CanonicalProfile } from '@/lib/canonical/types';
import { requiresHumanReview, resolveEntity, type MatchResult, type SubjectIdentity } from '@/lib/engines/entity-resolution';
import { classifyMedia } from '@/lib/engines/media';
import { SANDBOX_CONNECTORS } from './sandbox-connectors';
import type { ConnectorCapability, ConnectorContext, ExternalConnector, RawFinding } from './types';

export interface ResolvedFinding extends RawFinding {
  connectorKey: string;
  connectorName: string;
  sourceKey: string;
  sourceClass: ExternalConnector['sourceClass'];
  tier: ExternalConnector['tier'];
  mode: ExternalConnector['mode'];
  match: MatchResult;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
  categoryLabel: string;
  humanReviewRequired: boolean;
  retrievedAt: string;
}

export interface OrchestrationResult {
  subject: SubjectIdentity;
  connectorsRun: string[];
  connectorsSkipped: Array<{ key: string; reason: string }>;
  findings: ResolvedFinding[];
  summary: Record<string, number>;
}

const registry: ExternalConnector[] = [...SANDBOX_CONNECTORS];
export function listConnectors(): ExternalConnector[] {
  return registry;
}
export function registerConnector(c: ExternalConnector) {
  if (!registry.some((x) => x.key === c.key)) registry.push(c);
}

/** Builds the matching subject from the canonical profile (masked profile is fine; hashes are passed separately). */
export function buildSubject(p: CanonicalProfile, extra: { emailHashes?: string[]; phoneHashes?: string[]; pan?: string | null } = {}): SubjectIdentity {
  const employers = [...p.employment.records].sort((a, b) => (a.status === 'CURRENT' ? -1 : 1) - (b.status === 'CURRENT' ? -1 : 1)).map((r) => r.employer.name);
  return {
    fullName: p.person.fullName.value,
    employers: [...new Set(employers)],
    occupation: p.person.occupation.value,
    cities: [...new Set(p.addresses.map((a) => a.city).filter((c): c is string => !!c))],
    emails: [],
    phones: [],
    emailHashes: extra.emailHashes ?? [],
    phoneHashes: extra.phoneHashes ?? [],
    dob: p.person.dateOfBirth.value,
    pan: extra.pan ?? null,
    din: null,
    uan: null,
    websites: [],
  };
}

const CAP_ORDER: ConnectorCapability[] = ['verifyIdentity', 'searchCompanies', 'searchDirectorships', 'searchSanctions', 'searchLegalRecords', 'searchEmployment', 'searchProfessionalProfiles', 'searchPerson', 'searchAssets', 'searchPublicSocialProfiles', 'searchMedia'];

export async function runExternalSearch(
  subject: SubjectIdentity,
  opts: { purpose: string; consentSources: string[]; connectorKeys?: string[]; now?: Date; maxResults?: number },
): Promise<OrchestrationResult> {
  const now = opts.now ?? new Date();
  const ctx: ConnectorContext = { purpose: opts.purpose, consentSources: opts.consentSources, maxResults: opts.maxResults ?? 25, now };
  const wanted = opts.connectorKeys?.length ? registry.filter((c) => opts.connectorKeys!.includes(c.key)) : registry;
  const connectorsRun: string[] = [];
  const connectorsSkipped: OrchestrationResult['connectorsSkipped'] = [];
  const raw: Array<{ c: ExternalConnector; f: RawFinding }> = [];

  for (const c of wanted) {
    const missing = c.requiresConsentFor.filter((s) => !opts.consentSources.includes(s) && !opts.consentSources.includes('ALL'));
    if (missing.length) {
      connectorsSkipped.push({ key: c.key, reason: `Consent does not authorise: ${missing.join(', ')}` });
      continue;
    }
    connectorsRun.push(c.key);
    for (const cap of CAP_ORDER) {
      const fn = c[cap];
      if (typeof fn !== 'function') continue;
      try {
        const items = await (fn as (s: SubjectIdentity, ctx: ConnectorContext) => Promise<RawFinding[]>).call(c, subject, ctx);
        for (const f of items.slice(0, ctx.maxResults)) raw.push({ c, f });
      } catch (e) {
        connectorsSkipped.push({ key: c.key, reason: `${cap} failed: ${(e as Error).message}` });
      }
    }
  }

  // De-duplicate by connector + recordId, then by URL.
  const seen = new Set<string>();
  const findings: ResolvedFinding[] = [];
  for (const { c, f } of raw) {
    const k = `${c.key}:${f.recordId}`;
    const uk = f.url ? `url:${f.url}` : k;
    if (seen.has(k) || seen.has(uk)) continue;
    seen.add(k);
    seen.add(uk);
    const match = resolveEntity(subject, { ...f.candidate, officialRecordMatch: f.officialRecordMatch });
    const text = `${f.title} ${f.excerpt ?? ''}`;
    const media = f.resultType === 'NEWS' || f.resultType === 'WEB_MENTION' ? classifyMedia(text, c.tier) : null;
    const legal = f.resultType === 'LEGAL_RECORD';
    const severity: ResolvedFinding['severity'] = media ? media.severity : legal ? 'MEDIUM' : f.resultType === 'SANCTIONS_SCREEN' || f.resultType === 'PEP_SCREEN' ? ((f.data.hits as number) > 0 ? 'HIGH' : 'INFO') : 'INFO';
    findings.push({
      ...f,
      connectorKey: c.key,
      connectorName: c.name,
      sourceKey: c.sourceKey,
      sourceClass: c.sourceClass,
      tier: c.tier,
      mode: c.mode,
      match,
      severity,
      category: media ? media.category : (f.category ?? f.resultType),
      categoryLabel: media ? media.label : legal ? 'Legal record - role and identity require review' : (f.category ?? f.resultType),
      humanReviewRequired: media?.humanReviewRequired || legal || requiresHumanReview(match.status),
      retrievedAt: now.toISOString(),
    });
  }

  // Evidence ranking: trust tier first, then match score, then severity.
  const sevRank = { HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
  findings.sort((a, b) => a.tier - b.tier || b.match.score - a.match.score || sevRank[b.severity] - sevRank[a.severity]);

  const summary: Record<string, number> = {};
  for (const f of findings) summary[f.resultType] = (summary[f.resultType] ?? 0) + 1;
  summary.total = findings.length;
  summary.reviewRequired = findings.filter((f) => f.humanReviewRequired).length;
  summary.adverse = findings.filter((f) => f.category === 'POTENTIAL_ADVERSE').length;
  return { subject, connectorsRun, connectorsSkipped, findings, summary };
}
