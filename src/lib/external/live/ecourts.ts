/**
 * eCourtsIndia live connector (catalogue 7.1 - 7.3, 9.13).
 *
 * Partner case search by litigant name. The partner docs sit behind a login,
 * so the query-parameter name and the result array are configurable and the
 * parser accepts the common field spellings. Confirm `ECOURTS_SEARCH_PARAM`
 * against the partner documentation during onboarding.
 *
 * Presence of a name in litigation is never evidence of wrongdoing: every
 * legal record is MEDIUM severity and always requires human review.
 */
import { createHash } from 'node:crypto';
import type { SubjectIdentity } from '@/lib/engines/entity-resolution';
import { compareNames } from '@/lib/engines/normalize';
import { asArray, asRecord, asString, httpRequest, pick, setRateLimit } from '@/lib/integrations/http';
import type { ConnectorContext, EntityRole, ExternalConnector, RawFinding } from '../types';

const BASE_URL = 'https://webapi.ecourtsindia.com';
setRateLimit('ecourts', 30);

export interface ECourtsOptions {
  apiToken: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Query parameter carrying the litigant name. Default "party_name". */
  searchParam?: string;
}

const rid = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

export interface CourtCase {
  cnr: string | null;
  caseNumber: string | null;
  title: string;
  petitioner: string | null;
  respondent: string | null;
  court: string | null;
  caseType: string | null;
  status: string | null;
  filingDate: string | null;
  nextHearing: string | null;
  lastOrderDate: string | null;
  url: string | null;
  district: string | null;
}

export function parseCases(payload: unknown): CourtCase[] {
  const root = asRecord(payload);
  const list = [root.results, root.data, root.cases, asRecord(root.data).results, asRecord(root.data).cases, payload].map(asArray).find((a) => a.length) ?? [];
  return list.map(asRecord).map((c) => {
    const petitioner = pick(c, 'petitioner', 'petitioner_name', 'petitionerName', 'plaintiff', 'applicant');
    const respondent = pick(c, 'respondent', 'respondent_name', 'respondentName', 'defendant');
    const caseNumber = pick(c, 'case_number', 'caseNumber', 'case_no', 'reg_no', 'registration_number');
    return {
      cnr: pick(c, 'cnr', 'cnr_number', 'cnrNumber'),
      caseNumber,
      title: pick(c, 'title', 'case_title', 'caseTitle') ?? (petitioner && respondent ? `${petitioner} vs ${respondent}` : (caseNumber ?? 'Court record')),
      petitioner,
      respondent,
      court: pick(c, 'court', 'court_name', 'courtName', 'establishment'),
      caseType: pick(c, 'case_type', 'caseType', 'type'),
      status: pick(c, 'status', 'case_status', 'caseStatus', 'stage'),
      filingDate: pick(c, 'filing_date', 'filingDate', 'date_of_filing', 'registration_date'),
      nextHearing: pick(c, 'next_hearing', 'next_hearing_date', 'nextHearingDate', 'next_date'),
      lastOrderDate: pick(c, 'last_order_date', 'lastOrderDate', 'decision_date'),
      url: pick(c, 'url', 'link'),
      district: pick(c, 'district', 'district_name'),
    };
  });
}

function roleFor(name: string, c: CourtCase): { role: EntityRole; matchedName: string | null } {
  const strong = (v: string | null) => !!v && compareNames(name, v).status !== 'MISMATCH';
  if (strong(c.petitioner)) return { role: 'PETITIONER', matchedName: c.petitioner };
  if (strong(c.respondent)) return { role: 'RESPONDENT', matchedName: c.respondent };
  return { role: 'UNKNOWN', matchedName: null };
}

export function eCourtsConnector(o: ECourtsOptions): ExternalConnector {
  const base = (o.baseUrl ?? BASE_URL).replace(/\/$/, '');
  return {
    key: 'ecourts',
    name: 'eCourtsIndia Court & Tribunal Records',
    sourceKey: 'ECOURTS',
    sourceClass: 'PUBLIC_RECORD',
    tier: 3,
    mode: 'LIVE',
    capabilities: ['searchLegalRecords'],
    requiresConsentFor: ['LEGAL'],
    async searchLegalRecords(s: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]> {
      const name = s.fullName?.trim();
      if (!name) return [];
      const res = await httpRequest(`${base}/api/partner/search`, {
        provider: 'ecourts',
        headers: { authorization: `Bearer ${o.apiToken}` },
        query: { [o.searchParam ?? 'party_name']: name, limit: Math.min(ctx.maxResults, 50), page: 1 },
        fetchImpl: o.fetchImpl,
      });
      return parseCases(res.data).map((c) => {
        const { role, matchedName } = roleFor(name, c);
        const id = c.cnr ?? c.caseNumber ?? rid(c.title, c.court ?? '');
        return {
          recordId: `case:${id}`,
          resultType: 'LEGAL_RECORD' as const,
          title: `${c.caseNumber ?? c.cnr ?? 'Case'} - ${c.title}`,
          excerpt: `${c.caseType ?? 'Court matter'} before ${c.court ?? 'an Indian court'}${c.status ? `, status ${c.status}` : ''}. A party named ${matchedName ?? name} appears as ${role.toLowerCase()}. Presence of a name in litigation is not evidence of wrongdoing; identity must be confirmed before this attaches to the profile.`,
          url: c.url,
          publishedAt: c.filingDate,
          sourceName: 'eCourtsIndia partner API',
          candidate: { name: matchedName ?? name, city: c.district },
          data: { cnr: c.cnr, caseNumber: c.caseNumber, court: c.court, caseType: c.caseType, petitioner: c.petitioner, respondent: c.respondent, filingDate: c.filingDate, status: c.status, nextHearing: c.nextHearing, lastOrderDate: c.lastOrderDate, orderLink: c.url },
          entityRole: role,
          category: 'LEGAL',
        };
      });
    },
  };
}
