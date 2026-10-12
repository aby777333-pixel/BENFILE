/**
 * OpenSanctions live connector (catalogue 6.3 sanctions screening, 6.5 monitoring basis).
 *
 * POST /match/{dataset} query-by-example against the consolidated sanctions,
 * PEP, crime and watch-list datasets. Results carry `topics` (sanction,
 * role.pep, crime, wanted, ...) which BENFILE splits into a SANCTIONS_SCREEN
 * finding and a PEP_SCREEN finding. Each query costs one credit; the free
 * community tier can be used for testing.
 */
import { createHash } from 'node:crypto';
import type { SubjectIdentity } from '@/lib/engines/entity-resolution';
import { asArray, asNumber, asRecord, asString, httpRequest, setRateLimit } from '@/lib/integrations/http';
import type { ConnectorContext, ExternalConnector, RawFinding } from '../types';

const BASE_URL = 'https://api.opensanctions.org';
setRateLimit('opensanctions', 60);

export interface OpenSanctionsOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Dataset / collection to match against. Default "default" (everything). */
  dataset?: string;
  /** Minimum score to report (0..1). Default 0.7. */
  threshold?: number;
}

const rid = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

export interface OsResult {
  id: string;
  caption: string;
  schema: string | null;
  datasets: string[];
  topics: string[];
  score: number | null;
  match: boolean;
  birthDates: string[];
  countries: string[];
  firstSeen: string | null;
  lastSeen: string | null;
}

export function parseMatches(payload: unknown, queryKey = 'q1'): OsResult[] {
  const resp = asRecord(asRecord(asRecord(payload).responses)[queryKey]);
  return asArray(resp.results).map(asRecord).map((r) => {
    const props = asRecord(r.properties);
    const strs = (v: unknown) => asArray(v).map((x) => asString(x)).filter((x): x is string => !!x);
    return {
      id: asString(r.id) ?? rid(JSON.stringify(r)),
      caption: asString(r.caption) ?? 'Unnamed entity',
      schema: asString(r.schema),
      datasets: strs(r.datasets),
      topics: strs(props.topics),
      score: asNumber(r.score),
      match: r.match === true,
      birthDates: strs(props.birthDate),
      countries: [...strs(props.country), ...strs(props.nationality)],
      firstSeen: asString(r.first_seen),
      lastSeen: asString(r.last_seen),
    };
  });
}

const SANCTION_TOPICS = ['sanction', 'sanction.linked', 'sanction.counter', 'export.control', 'debarment', 'wanted', 'crime', 'crime.fraud', 'crime.terror', 'crime.fin', 'crime.theft', 'crime.traffick', 'crime.war', 'reg.action', 'reg.warn'];
const isSanctionTopic = (t: string) => SANCTION_TOPICS.includes(t) || t.startsWith('crime') || t.startsWith('sanction');
const isPepTopic = (t: string) => t === 'role.pep' || t === 'role.rca' || t.startsWith('role.pep') || t === 'gov.head' || t === 'gov.national';

export function openSanctionsConnector(o: OpenSanctionsOptions): ExternalConnector {
  const base = (o.baseUrl ?? BASE_URL).replace(/\/$/, '');
  return {
    key: 'opensanctions',
    name: 'OpenSanctions Screening',
    sourceKey: 'SANCTIONS',
    sourceClass: 'OFFICIAL_GOVERNMENT',
    tier: 1,
    mode: 'LIVE',
    capabilities: ['searchSanctions'],
    requiresConsentFor: ['SCREENING'],
    async searchSanctions(s: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]> {
      const name = s.fullName?.trim();
      if (!name) return [];
      const properties: Record<string, string[]> = { name: [name], nationality: ['in'] };
      if (s.dob) properties.birthDate = [s.dob];
      const res = await httpRequest(`${base}/match/${o.dataset ?? 'default'}`, {
        provider: 'opensanctions',
        headers: { authorization: `ApiKey ${o.apiKey}` },
        query: { threshold: o.threshold ?? 0.7, limit: Math.min(ctx.maxResults, 20), algorithm: 'best' },
        body: { queries: { q1: { schema: 'Person', properties } } },
        fetchImpl: o.fetchImpl,
      });
      const results = parseMatches(res.data);
      const screenedAt = ctx.now.toISOString();
      const sanction = results.filter((r) => r.topics.some(isSanctionTopic));
      const pep = results.filter((r) => r.topics.some(isPepTopic));
      const summarise = (rs: OsResult[]) => rs.slice(0, 10).map((r) => ({ id: r.id, name: r.caption, schema: r.schema, datasets: r.datasets, topics: r.topics, score: r.score, match: r.match, birthDates: r.birthDates, countries: r.countries, url: `https://www.opensanctions.org/entities/${r.id}/` }));
      const strongest = (rs: OsResult[]) => rs.find((r) => r.match) ?? rs[0];
      const sTop = strongest(sanction);
      const pTop = strongest(pep);
      return [
        {
          recordId: `sanctions:${rid(name, screenedAt.slice(0, 10))}`,
          resultType: 'SANCTIONS_SCREEN',
          title: sanction.length ? `Sanctions / watchlist screen - ${sanction.length} potential match${sanction.length === 1 ? '' : 'es'}` : 'Sanctions / watchlist screen - no match',
          excerpt: sanction.length ? `Potential matches: ${sanction.slice(0, 3).map((r) => `${r.caption} (${r.datasets.slice(0, 2).join(', ') || 'list'}, score ${Math.round((r.score ?? 0) * 100)}%)`).join('; ')}. Name similarity is not identity - review the match reasons.` : `Screened "${name}" against the OpenSanctions consolidated sanctions, export-control, crime and watch lists at threshold ${o.threshold ?? 0.7}. No potential matches.`,
          url: sTop ? `https://www.opensanctions.org/entities/${sTop.id}/` : null,
          publishedAt: null,
          sourceName: 'OpenSanctions',
          candidate: { name: sTop?.caption ?? name, dob: sTop?.birthDates[0] ?? null },
          data: { hits: sanction.length, totalResults: results.length, threshold: o.threshold ?? 0.7, screenedAt, matches: summarise(sanction) },
          officialRecordMatch: sanction.length === 0,
          category: 'REGULATORY',
        },
        {
          recordId: `pep:${rid(name, screenedAt.slice(0, 10))}`,
          resultType: 'PEP_SCREEN',
          title: pep.length ? `Politically exposed person screen - ${pep.length} potential match${pep.length === 1 ? '' : 'es'}` : 'Politically exposed person screen - no match',
          excerpt: pep.length ? `Potential PEP / close-associate matches: ${pep.slice(0, 3).map((r) => `${r.caption} (${r.topics.filter(isPepTopic).join(', ')})`).join('; ')}.` : 'No PEP or relative / close-associate match for the client name and date of birth.',
          url: pTop ? `https://www.opensanctions.org/entities/${pTop.id}/` : null,
          publishedAt: null,
          sourceName: 'OpenSanctions',
          candidate: { name: pTop?.caption ?? name, dob: pTop?.birthDates[0] ?? s.dob },
          data: { hits: pep.length, screenedAt, matches: summarise(pep) },
          officialRecordMatch: pep.length === 0,
          category: 'REGULATORY',
        },
      ];
    },
  };
}
