/**
 * ComplyAdvantage live connector (catalogue 6.1 - 6.4, 10.6).
 *
 * One POST /searches call screens the subject against sanctions, PEP, warning
 * and adverse-media lists. BENFILE always stores a SANCTIONS_SCREEN and a
 * PEP_SCREEN finding (even on zero hits, so the audit trail shows the screen
 * ran) and one NEWS finding per adverse-media article, which the orchestrator
 * routes through media classification and human review.
 */
import { createHash } from 'node:crypto';
import type { SubjectIdentity } from '@/lib/engines/entity-resolution';
import { asArray, asNumber, asRecord, asString, httpRequest, pick, setRateLimit } from '@/lib/integrations/http';
import type { ConnectorContext, ExternalConnector, RawFinding } from '../types';

const SEARCH_URL = 'https://api.complyadvantage.com/searches';
setRateLimit('complyadvantage', 250);

export interface ComplyAdvantageOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  searchUrl?: string;
  /** 0..1 - how fuzzy the name match may be. Default 0.6. */
  fuzziness?: number;
}

const rid = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

interface Hit {
  id: string;
  name: string;
  types: string[];
  sources: string[];
  matchTypes: string[];
  score: number | null;
  dob: string | null;
  country: string | null;
  media: Array<{ title: string; url: string | null; snippet: string | null; date: string | null }>;
}

export function parseHits(payload: unknown): { ref: string | null; shareUrl: string | null; totalHits: number; matchStatus: string | null; riskLevel: string | null; hits: Hit[] } {
  const content = asRecord(asRecord(payload).content);
  const data = asRecord(content.data);
  const hits = asArray(data.hits).map((h) => {
    const hr = asRecord(h);
    const doc = asRecord(hr.doc);
    const fields = asArray(doc.fields).map(asRecord);
    const field = (n: string) => asString(fields.find((f) => asString(f.name)?.toLowerCase() === n)?.value);
    return {
      id: asString(doc.id) ?? rid(JSON.stringify(doc)),
      name: asString(doc.name) ?? 'Unnamed entity',
      types: asArray(doc.types).map((t) => asString(t)).filter((t): t is string => !!t),
      sources: asArray(doc.sources).map((t) => asString(t)).filter((t): t is string => !!t),
      matchTypes: asArray(hr.match_types).map((t) => asString(t)).filter((t): t is string => !!t),
      score: asNumber(hr.score),
      dob: field('date of birth'),
      country: field('country') ?? field('countries'),
      media: asArray(doc.media).map(asRecord).map((m) => ({ title: asString(m.title) ?? 'Untitled article', url: asString(m.url), snippet: asString(m.snippet), date: asString(m.date) })),
    };
  });
  return {
    ref: asString(data.ref),
    shareUrl: asString(data.share_url) ?? asString(content.share_url),
    totalHits: asNumber(data.total_hits) ?? hits.length,
    matchStatus: asString(data.match_status),
    riskLevel: asString(data.risk_level),
    hits,
  };
}

const isSanction = (t: string) => t === 'sanction' || t === 'warning' || t === 'fitness-probity';
const isPep = (t: string) => t.startsWith('pep');
const isMedia = (t: string) => t.startsWith('adverse-media');

export function complyAdvantageConnector(o: ComplyAdvantageOptions): ExternalConnector {
  return {
    key: 'complyadvantage',
    name: 'ComplyAdvantage AML Screening',
    sourceKey: 'SANCTIONS',
    sourceClass: 'OFFICIAL_GOVERNMENT',
    tier: 1,
    mode: 'LIVE',
    capabilities: ['searchSanctions'],
    requiresConsentFor: ['SCREENING'],
    async searchSanctions(s: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]> {
      const name = s.fullName?.trim();
      if (!name) return [];
      const birthYear = s.dob && /^\d{4}/.test(s.dob) ? Number(s.dob.slice(0, 4)) : undefined;
      const body: Record<string, unknown> = {
        search_term: name,
        client_ref: `benfile:${rid(name, s.dob ?? '', ctx.now.toISOString().slice(0, 10))}`,
        fuzziness: o.fuzziness ?? 0.6,
        filters: { types: ['sanction', 'warning', 'fitness-probity', 'pep', 'adverse-media'], ...(birthYear ? { birth_year: birthYear } : {}) },
        share_url: 1,
      };
      const res = await httpRequest(o.searchUrl ?? SEARCH_URL, { provider: 'complyadvantage', headers: { authorization: `Token ${o.apiKey}` }, body, fetchImpl: o.fetchImpl });
      const parsed = parseHits(res.data);
      const screenedAt = ctx.now.toISOString();
      const sanctionHits = parsed.hits.filter((h) => h.types.some(isSanction));
      const pepHits = parsed.hits.filter((h) => h.types.some(isPep));
      const summarise = (hs: Hit[]) => hs.slice(0, 10).map((h) => ({ id: h.id, name: h.name, types: h.types, sources: h.sources, matchTypes: h.matchTypes, score: h.score, dob: h.dob, country: h.country }));
      const findings: RawFinding[] = [
        {
          recordId: `sanctions:${rid(name, screenedAt.slice(0, 10))}`,
          resultType: 'SANCTIONS_SCREEN',
          title: sanctionHits.length ? `Sanctions / watchlist screen - ${sanctionHits.length} potential match${sanctionHits.length === 1 ? '' : 'es'}` : 'Sanctions / watchlist screen - no match',
          excerpt: sanctionHits.length ? `Potential matches: ${sanctionHits.slice(0, 3).map((h) => `${h.name} (${h.sources.slice(0, 2).join(', ') || 'list'})`).join('; ')}. Name similarity is not identity - review the match reasons.` : `Screened "${name}" against sanctions, warning and fitness-probity lists. No potential matches at fuzziness ${o.fuzziness ?? 0.6}.`,
          url: parsed.shareUrl,
          publishedAt: null,
          sourceName: 'ComplyAdvantage',
          candidate: { name: sanctionHits[0]?.name ?? name, dob: sanctionHits[0]?.dob ?? null },
          data: { hits: sanctionHits.length, totalHits: parsed.totalHits, matchStatus: parsed.matchStatus, riskLevel: parsed.riskLevel, searchRef: parsed.ref, screenedAt, matches: summarise(sanctionHits) },
          officialRecordMatch: sanctionHits.length === 0,
          category: 'REGULATORY',
        },
        {
          recordId: `pep:${rid(name, screenedAt.slice(0, 10))}`,
          resultType: 'PEP_SCREEN',
          title: pepHits.length ? `Politically exposed person screen - ${pepHits.length} potential match${pepHits.length === 1 ? '' : 'es'}` : 'Politically exposed person screen - no match',
          excerpt: pepHits.length ? `Potential PEP matches: ${pepHits.slice(0, 3).map((h) => `${h.name} (${h.types.filter(isPep).join(', ')})`).join('; ')}.` : 'No PEP or relative / close-associate match for the client name and birth year.',
          url: parsed.shareUrl,
          publishedAt: null,
          sourceName: 'ComplyAdvantage',
          candidate: { name: pepHits[0]?.name ?? name, dob: pepHits[0]?.dob ?? s.dob },
          data: { hits: pepHits.length, searchRef: parsed.ref, screenedAt, matches: summarise(pepHits) },
          officialRecordMatch: pepHits.length === 0,
          category: 'REGULATORY',
        },
      ];
      let mediaCount = 0;
      for (const h of parsed.hits.filter((x) => x.types.some(isMedia))) {
        for (const m of h.media) {
          if (mediaCount >= ctx.maxResults) break;
          mediaCount++;
          findings.push({
            recordId: `news:${rid(m.url ?? m.title, h.id)}`,
            resultType: 'NEWS',
            title: m.title,
            excerpt: m.snippet,
            url: m.url,
            publishedAt: m.date,
            sourceName: m.url ? new URL(m.url).hostname : 'ComplyAdvantage adverse media',
            candidate: { name: h.name, dob: h.dob },
            data: { entity: h.name, adverseMediaTypes: h.types.filter(isMedia), matchTypes: h.matchTypes, score: h.score, searchRef: parsed.ref },
            category: 'MEDIA',
          });
        }
      }
      return findings;
    },
  };
}
