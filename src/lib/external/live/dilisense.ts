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
  /** Optional adverse-media endpoint path (e.g. "/media/checkIndividual"). Off when unset. */
  mediaEndpoint?: string;
  fuzzy?: boolean;
}

const rid = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

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
        query: { names: name, dob: s.dob ?? undefined, fuzzy_search: o.fuzzy === false ? 0 : 1 },
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
      const res = await httpRequest(`${base}${o.mediaEndpoint.startsWith('/') ? '' : '/'}${o.mediaEndpoint}`, { provider: 'dilisense', headers, query: { names: s.fullName, dob: s.dob ?? undefined }, fetchImpl: o.fetchImpl });
      const root = asRecord(res.data);
      const list = [root.found_records, root.articles, root.results, root.media].map(asArray).find((a) => a.length) ?? [];
      return list
        .map(asRecord)
        .slice(0, ctx.maxResults)
        .map((a) => {
          const url = pick(a, 'url', 'link', 'source_url');
          const title = pick(a, 'title', 'headline') ?? 'Adverse media article';
          return {
            recordId: `news:${rid(url ?? title, s.fullName!)}`,
            resultType: 'NEWS' as const,
            title,
            excerpt: pick(a, 'snippet', 'summary', 'description'),
            url,
            publishedAt: pick(a, 'date', 'published_at', 'publishedAt'),
            sourceName: pick(a, 'source', 'publisher') ?? (url ? new URL(url).hostname : 'Dilisense adverse media'),
            candidate: { name: pick(a, 'name') ?? s.fullName, dob: s.dob },
            data: { categories: asArray(a.categories ?? a.topics).map((x) => asString(x)).filter(Boolean), sourceType: pick(a, 'source_type') },
            category: 'MEDIA',
          };
        });
    },
  };
}
