/**
 * Brave Search live connectors (catalogue 10.2 web search, 10.5 news search).
 *
 * Web mentions are Tier 6 public web; news is Tier 4 and flows through the
 * adverse-media classifier in the orchestrator. Queries are built from the
 * subject's name plus one corroborating attribute (employer or city) so that
 * common names do not flood the review queue. Nothing sensitive (PAN, phone,
 * e-mail, DOB) is ever sent to a search engine.
 */
import { createHash } from 'node:crypto';
import type { SubjectIdentity } from '@/lib/engines/entity-resolution';
import { asArray, asRecord, asString, httpRequest, pick, setRateLimit } from '@/lib/integrations/http';
import type { ConnectorContext, ExternalConnector, RawFinding } from '../types';

const WEB_URL = 'https://api.search.brave.com/res/v1/web/search';
const NEWS_URL = 'https://api.search.brave.com/res/v1/news/search';
setRateLimit('brave', 50);

export interface BraveOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  webUrl?: string;
  newsUrl?: string;
}

const rid = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

/** Quoted full name plus the strongest public corroborator we hold. */
export function buildQuery(s: SubjectIdentity): string | null {
  const name = s.fullName?.trim();
  if (!name) return null;
  const extra = s.employers[0] ?? s.cities[0] ?? s.occupation ?? '';
  return extra ? `"${name}" "${extra}"` : `"${name}"`;
}

/** ISO date from Brave's page_age / age fields when parseable. */
function publishedAt(r: Record<string, unknown>): string | null {
  const raw = pick(r, 'page_age', 'age', 'date');
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function hostOf(r: Record<string, unknown>, url: string | null): string {
  const meta = asRecord(r.meta_url);
  const profile = asRecord(r.profile);
  return asString(profile.name) ?? asString(meta.hostname) ?? (url ? new URL(url).hostname : 'web');
}

function toFinding(r: Record<string, unknown>, s: SubjectIdentity, kind: 'WEB_MENTION' | 'NEWS'): RawFinding | null {
  const url = pick(r, 'url');
  const title = pick(r, 'title');
  if (!url || !title) return null;
  const excerpt = pick(r, 'description', 'snippet');
  const host = hostOf(r, url);
  return {
    recordId: `${kind === 'NEWS' ? 'news' : 'web'}:${rid(url)}`,
    resultType: kind,
    title,
    excerpt,
    url,
    publishedAt: publishedAt(r),
    sourceName: host,
    candidate: { name: s.fullName, employer: s.employers[0] ?? null, city: s.cities[0] ?? null, website: host },
    data: { host, language: asString(r.language), familyFriendly: r.family_friendly ?? null, query: buildQuery(s) },
    category: kind === 'NEWS' ? 'MEDIA' : 'WEB',
  };
}

export function braveWebConnector(o: BraveOptions): ExternalConnector {
  return {
    key: 'brave-web',
    name: 'Brave Web Search',
    sourceKey: 'WEB',
    sourceClass: 'PUBLIC_WEB',
    tier: 6,
    mode: 'LIVE',
    capabilities: ['searchPerson'],
    requiresConsentFor: ['WEB'],
    async searchPerson(s: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]> {
      const q = buildQuery(s);
      if (!q) return [];
      const res = await httpRequest(o.webUrl ?? WEB_URL, {
        provider: 'brave',
        headers: { 'x-subscription-token': o.apiKey },
        query: { q, count: Math.min(ctx.maxResults, 20), country: 'IN', search_lang: 'en', safesearch: 'moderate', text_decorations: false },
        fetchImpl: o.fetchImpl,
      });
      const results = asArray(asRecord(asRecord(res.data).web).results);
      return results.map((r) => toFinding(asRecord(r), s, 'WEB_MENTION')).filter((f): f is RawFinding => !!f);
    },
  };
}

export function braveNewsConnector(o: BraveOptions): ExternalConnector {
  return {
    key: 'brave-news',
    name: 'Brave News Search',
    sourceKey: 'NEWS',
    sourceClass: 'NEWS_MEDIA',
    tier: 4,
    mode: 'LIVE',
    capabilities: ['searchMedia'],
    requiresConsentFor: ['MEDIA'],
    async searchMedia(s: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]> {
      const q = buildQuery(s);
      if (!q) return [];
      const res = await httpRequest(o.newsUrl ?? NEWS_URL, {
        provider: 'brave',
        headers: { 'x-subscription-token': o.apiKey },
        query: { q, count: Math.min(ctx.maxResults, 20), country: 'IN', search_lang: 'en', freshness: 'py' },
        fetchImpl: o.fetchImpl,
      });
      const results = asArray(asRecord(res.data).results);
      return results.map((r) => toFinding(asRecord(r), s, 'NEWS')).filter((f): f is RawFinding => !!f);
    },
  };
}
