/**
 * Dilisense live connector (catalogue 6.1 AML, 6.2 PEP, 6.4 adverse media).
 *
 * GET /v1/checkIndividual screens a person across sanctions, PEP and criminal
 * watch lists (free developer tier: 100 requests / month; then ~EUR 0.10 per
 * call). Records are grouped by `source_type` into SANCTIONS_SCREEN and
 * PEP_SCREEN findings. The adverse-media product is a separate endpoint whose
 * contract must be confirmed at onboarding; it is parsed tolerantly and only
 * called when `mediaEndpoint` is configured.
 */
import { createHash } from 'node:crypto';
import type { SubjectIdentity } from '@/lib/engines/entity-resolution';
import { asArray, asNumber, asRecord, asString, httpRequest, pick, setRateLimit } from '@/lib/integrations/http';
import type { ConnectorContext, ExternalConnector, RawFinding } from '../types';

const BASE_URL = 'https://api.dilisense.com/v1';
setRateLimit('dilisense', 60);

export interface DilisenseOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /**
   * Adverse-media endpoint path. The Adverse Media Screening API is a separate Dilisense product
   * (GET /media/checkIndividual); leave unset unless it is subscribed, otherwise the call returns 402/403
   * and the orchestrator records the media capability as skipped while sanctions/PEP still run.
   */
  mediaEndpoint?: string;
  fuzzy?: boolean;
}

export const DILISENSE_MEDIA_ENDPOINT = '/media/checkIndividual';

const rid = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

/** Dilisense expects dd/mm/yyyy (partial forms such as 00/00/1976 allowed). Accepts ISO or already-formatted input. */
export function dilisenseDob(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v;
  const year = /^(\d{4})/.exec(v);
  return year ? `00/00/${year[1]}` : undefined;
}

export interface MediaArticle {
  category: string;
  headline: string;
  url: string | null;
  snippet: string | null;
  timestamp: string | null;
  language: string | null;
}

/** Parse /media/checkIndividual: { total_hits, news_exposures: { <category>: { category, hits, articles[] } } }. */
export function parseMediaExposures(payload: unknown): { totalHits: number; byCategory: Record<string, number>; articles: MediaArticle[] } {
  const root = asRecord(payload);
  const exposures = asRecord(root.news_exposures);
  const byCategory: Record<string, number> = {};
  const articles: MediaArticle[] = [];
  const stripHtml = (s: string | null) => (s ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null);
  for (const [key, val] of Object.entries(exposures)) {
    const cat = asRecord(val);
    const category = asString(cat.category) ?? key;
    byCategory[category] = asNumber(cat.hits) ?? asArray(cat.articles).length;
    for (const a of asArray(cat.articles).map(asRecord)) {
      const headline = pick(a, 'headline', 'title');
      if (!headline) continue;
      const body = stripHtml(pick(a, 'body', 'snippet'));
      articles.push({ category, headline, url: pick(a, 'source_link', 'url'), snippet: body ? body.slice(0, 400) : null, timestamp: pick(a, 'timestamp', 'date'), language: pick(a, 'language') });
    }
  }
  // Flat /media/search shape, for completeness.
  for (const a of asArray(root.articles).map(asRecord)) {
    const headline = pick(a, 'headline', 'title');
    if (!headline) continue;
    const body = stripHtml(pick(a, 'body', 'snippet'));
    articles.push({ category: pick(a, 'category') ?? 'adverse_media', headline, url: pick(a, 'source_link', 'url'), snippet: body ? body.slice(0, 400) : null, timestamp: pick(a, 'timestamp', 'date'), language: pick(a, 'language') });
  }
  return { totalHits: asNumber(root.total_hits) ?? articles.length, byCategory, articles };
}

export interface DilisenseRecord {
  sourceType: string;
  sourceId: string | null;
  name: string;
  entityType: string | null;
  pepType: string | null;
  aliases: string[];
  dobs: string[];
  citizenship: string[];
  sanctionDetails: string[];
  raw: Record<string, unknown>;
}

export function parseRecords(payload: unknown): { totalHits: number; records: DilisenseRecord[] } {
  const root = asRecord(payload);
  const list = [root.found_records, root.records, root.results].map(asArray).find((a) => a.length) ?? [];
  const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => asString(x)).filter((x): x is string => !!x) : asString(v) ? [asString(v)!] : []);
  const records = list.map(asRecord).map((r) => ({
    sourceType: (pick(r, 'source_type', 'sourceType', 'type') ?? 'OTHER').toUpperCase(),
    sourceId: pick(r, 'source_id', 'sourceId', 'id'),
    name: pick(r, 'name', 'full_name') ?? 'Unnamed entity',
    entityType: pick(r, 'entity_type', 'entityType'),
    pepType: pick(r, 'pep_type', 'pepType'),
    aliases: strs(r.alias_names ?? r.aliases),
    dobs: strs(r.date_of_birth ?? r.dob),
    citizenship: strs(r.citizenship ?? r.nationality),
    sanctionDetails: strs(r.sanction_details ?? r.sanctions),
    raw: r,
  }));
  return { totalHits: asNumber(root.total_hits) ?? records.length, records };
}

export function dilisenseConnector(o: DilisenseOptions): ExternalConnector {
  const base = (o.baseUrl ?? BASE_URL).replace(/\/$/, '');
  const headers = { 'x-api-key': o.apiKey };
  return {
    key: 'dilisense',
    name: 'Dilisense AML / PEP Screening',
    sourceKey: 'SANCTIONS',
    sourceClass: 'OFFICIAL_GOVERNMENT',
    tier: 1,
    mode: 'LIVE',
    capabilities: ['searchSanctions', 'searchMedia'],
    requiresConsentFor: ['SCREENING'],
    async searchSanctions(s: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]> {
      const name = s.fullName?.trim();
      if (!name) return [];
      const res = await httpRequest(`${base}/checkIndividual`, {
        provider: 'dilisense',
        headers,
        query: { names: name, dob: dilisenseDob(s.dob), fuzzy_search: o.fuzzy === false ? undefined : 1 },
        fetchImpl: o.fetchImpl,
      });
      const { totalHits, records } = parseRecords(res.data);
      const screenedAt = ctx.now.toISOString();
      const sanction = records.filter((r) => r.sourceType !== 'PEP');
      const pep = records.filter((r) => r.sourceType === 'PEP' || !!r.pepType);
      const summarise = (rs: DilisenseRecord[]) => rs.slice(0, 10).map((r) => ({ sourceType: r.sourceType, sourceId: r.sourceId, name: r.name, entityType: r.entityType, pepType: r.pepType, aliases: r.aliases.slice(0, 5), dobs: r.dobs, citizenship: r.citizenship, sanctionDetails: r.sanctionDetails.slice(0, 3) }));
      return [
        {
          recordId: `sanctions:${rid(name, screenedAt.slice(0, 10))}`,
          resultType: 'SANCTIONS_SCREEN',
          title: sanction.length ? `Sanctions / criminal watchlist screen - ${sanction.length} potential match${sanction.length === 1 ? '' : 'es'}` : 'Sanctions / criminal watchlist screen - no match',
          excerpt: sanction.length ? `Potential matches: ${sanction.slice(0, 3).map((r) => `${r.name} (${r.sourceType}${r.sourceId ? `, ${r.sourceId}` : ''})`).join('; ')}. Name similarity is not identity - review the match reasons.` : `Screened "${name}" against Dilisense sanctions, criminal and watch lists (${totalHits} hits). No potential matches.`,
          url: null,
          publishedAt: null,
          sourceName: 'Dilisense',
          candidate: { name: sanction[0]?.name ?? name, dob: sanction[0]?.dobs[0] ?? null },
          data: { hits: sanction.length, totalHits, screenedAt, matches: summarise(sanction) },
          officialRecordMatch: sanction.length === 0,
          category: 'REGULATORY',
        },
        {
          recordId: `pep:${rid(name, screenedAt.slice(0, 10))}`,
          resultType: 'PEP_SCREEN',
          title: pep.length ? `Politically exposed person screen - ${pep.length} potential match${pep.length === 1 ? '' : 'es'}` : 'Politically exposed person screen - no match',
          excerpt: pep.length ? `Potential PEP matches: ${pep.slice(0, 3).map((r) => `${r.name}${r.pepType ? ` (${r.pepType})` : ''}`).join('; ')}.` : 'No PEP match for the client name and date of birth.',
          url: null,
          publishedAt: null,
          sourceName: 'Dilisense',
          candidate: { name: pep[0]?.name ?? name, dob: pep[0]?.dobs[0] ?? s.dob },
          data: { hits: pep.length, screenedAt, matches: summarise(pep) },
          officialRecordMatch: pep.length === 0,
          category: 'REGULATORY',
        },
      ];
    },
    async searchMedia(s: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]> {
      if (!o.mediaEndpoint || !s.fullName) return [];
      const res = await httpRequest(`${base}${o.mediaEndpoint.startsWith('/') ? '' : '/'}${o.mediaEndpoint}`, { provider: 'dilisense', headers, query: { names: s.fullName, fetch_articles: true }, fetchImpl: o.fetchImpl });
      const { totalHits, byCategory, articles } = parseMediaExposures(res.data);
      const out: RawFinding[] = articles.slice(0, ctx.maxResults).map((a) => ({
        recordId: `news:${rid(a.url ?? a.headline, s.fullName!)}`,
        resultType: 'NEWS' as const,
        title: a.headline,
        excerpt: a.snippet,
        url: a.url,
        publishedAt: a.timestamp,
        sourceName: a.url ? new URL(a.url).hostname : 'Dilisense adverse media',
        // Dilisense matches on the name within the article; nothing else is corroborated, so entity resolution scores it on name only.
        candidate: { name: s.fullName },
        data: { adverseMediaCategory: a.category, language: a.language, totalHits, hitsByCategory: byCategory },
        category: 'MEDIA',
      }));
      if (!out.length && totalHits === 0) {
        out.push({
          recordId: `news-screen:${rid(s.fullName, ctx.now.toISOString().slice(0, 10))}`,
          resultType: 'NEWS',
          title: 'Adverse-media screen - no exposure found',
          excerpt: `Screened "${s.fullName}" across Dilisense adverse-media categories (political, regulatory, terrorism, financial crime, organised crime, violent crime). No articles matched.`,
          url: null,
          publishedAt: null,
          sourceName: 'Dilisense adverse media',
          candidate: { name: s.fullName },
          data: { totalHits: 0, hitsByCategory: byCategory, screenedAt: ctx.now.toISOString() },
          category: 'MEDIA',
        });
      }
      return out;
    },
  };
}
