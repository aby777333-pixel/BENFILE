import { beforeEach, describe, expect, it, vi } from 'vitest';
import sample from '../fixtures/india-composite-sample.json';
import { indiaKycCompositeAdapter } from '@/lib/providers/india-kyc-composite';
import { buildSubject } from '@/lib/external/orchestrator';
import { HttpError, httpRequest, resetRateLimits, setRateLimit } from '@/lib/integrations/http';
import { INTEGRATION_CATALOG, catalogEnvVars, integrationStatus, isConfigured, summarizeCatalog } from '@/lib/integrations/catalog';
import { composeRegistry, configuredFactories, LIVE_CONNECTOR_FACTORIES } from '@/lib/external/live';
import { SANDBOX_CONNECTORS } from '@/lib/external/sandbox-connectors';
import { braveNewsConnector, braveWebConnector, buildQuery } from '@/lib/external/live/brave';
import { complyAdvantageConnector, parseHits } from '@/lib/external/live/complyadvantage';
import { eCourtsConnector, parseCases } from '@/lib/external/live/ecourts';
import { attestrConnector, isoDate, parseAutocomplete } from '@/lib/external/live/attestr';
import { extractPerSqft, fetchGuidelineValue } from '@/lib/integrations/landlens';
import { openSanctionsConnector, parseMatches } from '@/lib/external/live/opensanctions';
import { dilisenseConnector, parseRecords } from '@/lib/external/live/dilisense';
import { PRICING, pricingFor } from '@/lib/integrations/pricing';

const NOW = new Date('2026-10-12T00:00:00Z');
const profile = indiaKycCompositeAdapter.normalize(sample).profile;
const subject = buildSubject(profile);
const ctx = { purpose: 'KYC', consentSources: ['ALL'], maxResults: 10, now: NOW };

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const r = handler(url, init ?? {});
    const body = r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  });
  return { fetchImpl: fn as unknown as typeof fetch, calls };
}

beforeEach(() => resetRateLimits());

describe('http client', () => {
  it('retries 5xx with backoff and succeeds', async () => {
    let n = 0;
    const { fetchImpl, calls } = fakeFetch(() => (++n < 3 ? { status: 503, body: { error: 'busy' } } : { body: { ok: true } }));
    const r = await httpRequest<{ ok: boolean }>('https://example.test/x', { provider: 'test', fetchImpl, retries: 2 });
    expect(r.data.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(calls).toHaveLength(3);
  });
  it('does not retry 4xx and scrubs the secret from the error', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 401, body: 'bad key SECRET-TOKEN-123 rejected' }));
    await expect(httpRequest('https://example.test/x', { provider: 'test', fetchImpl, headers: { authorization: 'SECRET-TOKEN-123' } })).rejects.toThrow(/401.*\[redacted\]/);
    expect(calls).toHaveLength(1);
  });
  it('throws HttpError with status', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 404, body: { message: 'nope' } }));
    const err = await httpRequest('https://example.test/x', { provider: 'test', fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
  });
  it('serialises query parameters and JSON bodies', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: {} }));
    await httpRequest('https://example.test/s', { provider: 'test', fetchImpl, query: { q: 'a b', count: 5, skip: null }, body: { x: 1 } });
    expect(calls[0].url).toBe('https://example.test/s?q=a+b&count=5');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe('{"x":1}');
  });
  it('enforces the per-provider rate limit', async () => {
    setRateLimit('tiny', 1);
    const { fetchImpl } = fakeFetch(() => ({ body: {} }));
    await httpRequest('https://example.test/1', { provider: 'tiny', fetchImpl });
    await expect(httpRequest('https://example.test/2', { provider: 'tiny', fetchImpl, timeoutMs: 10 })).rejects.toThrow(/Rate limit/);
  });
});

describe('integration catalogue', () => {
  it('covers every section of the API document with unique ids', () => {
    const ids = INTEGRATION_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cat of ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.', '10.']) expect(ids.some((i) => i.startsWith(cat))).toBe(true);
    expect(INTEGRATION_CATALOG.length).toBeGreaterThanOrEqual(70);
  });
  it('derives status from env var presence only', () => {
    const ca = INTEGRATION_CATALOG.find((e) => e.id === '6.1')!;
    expect(integrationStatus(ca, {})).toBe('SANDBOX_FALLBACK');
    expect(integrationStatus(ca, { DILISENSE_API_KEY: 'x' })).toBe('LIVE');
    expect(isConfigured(ca, { DILISENSE_API_KEY: '  ' })).toBe(false);
    const patta = INTEGRATION_CATALOG.find((e) => e.id === '9.1')!;
    expect(integrationStatus(patta, {})).toBe('MANUAL');
    const s = summarizeCatalog({ BRAVE_SEARCH_API_KEY: 'k' });
    expect(s.live).toBe(2);
    expect(s.missingEnvVars).not.toContain('BRAVE_SEARCH_API_KEY');
    expect(s.missingEnvVars).toContain('COMPLYADVANTAGE_API_KEY');
  });
  it('every live connector in the catalogue has a factory with the same env vars', () => {
    for (const e of INTEGRATION_CATALOG.filter((x) => x.implementation === 'LIVE_CONNECTOR' && x.connectorKey !== 'landlens')) {
      const f = LIVE_CONNECTOR_FACTORIES.find((x) => x.key === e.connectorKey);
      expect(f, e.id).toBeDefined();
      expect(f!.envVars).toEqual(e.envVars);
      if (e.supersedesSandbox) expect(f!.supersedes).toContain(e.supersedesSandbox);
    }
    expect(catalogEnvVars()).toContain('LANDLENS_API_KEY');
  });
  it('has a pricing assessment for every catalogue entry', () => {
    for (const e of INTEGRATION_CATALOG) expect(PRICING[e.id], e.id).toBeDefined();
    expect(pricingFor('9.14').tier).toBe('FREE');
    expect(pricingFor('3.1').tier).toBe('CONTRACT');
    expect(pricingFor('9.1').tier).toBe('UNPUBLISHED');
    expect(pricingFor('6.3').selfServe).toBe(true);
    expect(pricingFor('nope').tier).toBe('UNPUBLISHED');
  });
});

describe('OpenSanctions connector', () => {
  const payload = {
    responses: {
      q1: {
        status: 200,
        total: { value: 2, relation: 'eq' },
        results: [
          { id: 'Q-SANC', caption: 'RAHUL SHARMA', schema: 'Person', datasets: ['us_ofac_sdn'], score: 0.92, match: true, properties: { topics: ['sanction'], birthDate: ['1985-02-02'], nationality: ['in'] } },
          { id: 'Q-PEP', caption: 'Rahul Sharma', schema: 'Person', datasets: ['in_pep'], score: 0.71, match: false, properties: { topics: ['role.pep'], country: ['in'] } },
        ],
      },
    },
  };
  it('parses match results', () => {
    const r = parseMatches(payload);
    expect(r).toHaveLength(2);
    expect(r[0].topics).toEqual(['sanction']);
    expect(r[0].birthDates).toEqual(['1985-02-02']);
    expect(parseMatches({})).toEqual([]);
  });
  it('splits topics into sanctions and PEP findings and sends a query-by-example body', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: payload }));
    const f = await openSanctionsConnector({ apiKey: 'os', fetchImpl }).searchSanctions!(subject, ctx);
    const sanctions = f.find((x) => x.resultType === 'SANCTIONS_SCREEN')!;
    const pep = f.find((x) => x.resultType === 'PEP_SCREEN')!;
    expect(sanctions.data.hits).toBe(1);
    expect(sanctions.url).toBe('https://www.opensanctions.org/entities/Q-SANC/');
    expect(sanctions.officialRecordMatch).toBe(false);
    expect(pep.data.hits).toBe(1);
    expect(calls[0].url).toMatch(/\/match\/default\?threshold=0\.7/);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('ApiKey os');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.queries.q1.schema).toBe('Person');
    expect(body.queries.q1.properties.name).toEqual([subject.fullName]);
  });
  it('is clean on no results', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: { responses: { q1: { results: [] } } } }));
    const f = await openSanctionsConnector({ apiKey: 'os', fetchImpl }).searchSanctions!(subject, ctx);
    expect(f.every((x) => x.data.hits === 0 && x.officialRecordMatch)).toBe(true);
  });
});

describe('Dilisense connector', () => {
  const payload = { total_hits: 2, found_records: [{ source_type: 'SANCTION', source_id: 'OFAC', name: 'RAHUL SHARMA', alias_names: ['R. Sharma'], date_of_birth: ['02/02/1985'], sanction_details: ['SDN list'] }, { source_type: 'PEP', pep_type: 'MEMBER OF PARLIAMENT', name: 'Rahul Sharma', citizenship: ['India'] }] };
  it('parses records tolerantly', () => {
    const r = parseRecords(payload);
    expect(r.totalHits).toBe(2);
    expect(r.records[0].sourceType).toBe('SANCTION');
    expect(r.records[1].pepType).toBe('MEMBER OF PARLIAMENT');
    expect(parseRecords({ results: [{ name: 'x' }] }).records[0].sourceType).toBe('OTHER');
  });
  it('calls checkIndividual with the x-api-key header and groups by source type', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: payload }));
    const f = await dilisenseConnector({ apiKey: 'dk', fetchImpl }).searchSanctions!(subject, ctx);
    expect(calls[0].url).toContain('/v1/checkIndividual?names=');
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe('dk');
    expect(f.find((x) => x.resultType === 'SANCTIONS_SCREEN')!.data.hits).toBe(1);
    expect(f.find((x) => x.resultType === 'PEP_SCREEN')!.data.hits).toBe(1);
  });
  it('skips adverse media unless an endpoint is configured', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { found_records: [{ title: 'Probe', url: 'https://m.example.com/a', date: '2026-01-01' }] } }));
    expect(await dilisenseConnector({ apiKey: 'dk', fetchImpl }).searchMedia!(subject, ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
    const f = await dilisenseConnector({ apiKey: 'dk', fetchImpl, mediaEndpoint: '/media/checkIndividual' }).searchMedia!(subject, ctx);
    expect(f).toHaveLength(1);
    expect(f[0].resultType).toBe('NEWS');
    expect(calls[0].url).toContain('/v1/media/checkIndividual?names=');
  });
});

describe('live registry composition', () => {
  it('keeps every sandbox when nothing is configured', () => {
    expect(configuredFactories({})).toEqual([]);
    expect(composeRegistry(SANDBOX_CONNECTORS, {}).map((c) => c.key)).toEqual(SANDBOX_CONNECTORS.map((c) => c.key));
  });
  it('replaces superseded sandboxes with live connectors', () => {
    const keys = composeRegistry(SANDBOX_CONNECTORS, { COMPLYADVANTAGE_API_KEY: 'k', BRAVE_SEARCH_API_KEY: 'b', OPENSANCTIONS_API_KEY: 'o' }).map((c) => c.key);
    expect(keys).toContain('complyadvantage');
    expect(keys).toContain('opensanctions');
    expect(keys).not.toContain('dilisense');
    expect(keys).toContain('brave-web');
    expect(keys).toContain('brave-news');
    expect(keys).not.toContain('sanctions-sandbox');
    expect(keys).not.toContain('web-sandbox');
    expect(keys).not.toContain('media-sandbox');
    expect(keys).toContain('mca-sandbox');
    expect(keys).toContain('courts-sandbox');
  });
});

describe('Brave connectors', () => {
  it('builds a quoted query with one corroborator and never includes identifiers', () => {
    const q = buildQuery(subject)!;
    expect(q.startsWith(`"${subject.fullName}"`)).toBe(true);
    expect(q).not.toMatch(/@|\d{10}/);
    expect(buildQuery({ ...subject, fullName: null })).toBeNull();
  });
  it('maps web results to WEB_MENTION findings', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { web: { results: [{ title: 'Profile page', url: 'https://example.org/p', description: 'About the person', page_age: '2026-01-05T00:00:00Z', profile: { name: 'Example' } }, { title: 'no url' }] } } }));
    const f = await braveWebConnector({ apiKey: 'k', fetchImpl }).searchPerson!(subject, ctx);
    expect(f).toHaveLength(1);
    expect(f[0].resultType).toBe('WEB_MENTION');
    expect(f[0].sourceName).toBe('Example');
    expect(f[0].publishedAt).toMatch(/^2026-01-05/);
    expect(calls[0].url).toContain('api.search.brave.com/res/v1/web/search?q=');
    expect((calls[0].init.headers as Record<string, string>)['x-subscription-token']).toBe('k');
  });
  it('maps news results to NEWS findings', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: { results: [{ title: 'Company raises funds', url: 'https://news.example.com/a', description: 'Funding round', age: '2026-03-01', meta_url: { hostname: 'news.example.com' } }] } }));
    const f = await braveNewsConnector({ apiKey: 'k', fetchImpl }).searchMedia!(subject, ctx);
    expect(f[0].resultType).toBe('NEWS');
    expect(f[0].sourceName).toBe('news.example.com');
    expect(f[0].category).toBe('MEDIA');
  });
});

describe('ComplyAdvantage connector', () => {
  const payload = {
    content: {
      data: {
        ref: '1234-abcd',
        total_hits: 2,
        match_status: 'potential_match',
        risk_level: 'medium',
        share_url: 'https://app.complyadvantage.com/public/search/x',
        hits: [
          { doc: { id: 'S1', name: 'RAHUL SHARMA', types: ['sanction'], sources: ['ofac-sdn-list'], fields: [{ name: 'Date of Birth', value: '1985-02-02' }] }, match_types: ['name_exact'], score: 1.2 },
          { doc: { id: 'M1', name: 'Rahul Sharma', types: ['adverse-media', 'adverse-media-v2-fraud-linked'], sources: [], media: [{ title: 'Fraud probe names executive', url: 'https://paper.example.com/story', snippet: 'An executive was named', date: '2025-11-01' }] }, match_types: ['name_fuzzy'], score: 0.8 },
        ],
      },
    },
  };
  it('parses hits defensively', () => {
    const p = parseHits(payload);
    expect(p.hits).toHaveLength(2);
    expect(p.hits[0].dob).toBe('1985-02-02');
    expect(p.hits[1].media[0].url).toContain('paper.example.com');
    expect(parseHits({}).hits).toEqual([]);
  });
  it('produces sanctions, PEP and adverse-media findings with hit counts', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: payload }));
    const f = await complyAdvantageConnector({ apiKey: 'k', fetchImpl }).searchSanctions!(subject, ctx);
    const sanctions = f.find((x) => x.resultType === 'SANCTIONS_SCREEN')!;
    const pep = f.find((x) => x.resultType === 'PEP_SCREEN')!;
    const news = f.filter((x) => x.resultType === 'NEWS');
    expect(sanctions.data.hits).toBe(1);
    expect(sanctions.officialRecordMatch).toBe(false);
    expect(sanctions.title).toMatch(/1 potential match$/);
    expect(pep.data.hits).toBe(0);
    expect(pep.officialRecordMatch).toBe(true);
    expect(news).toHaveLength(1);
    expect(news[0].url).toContain('paper.example.com');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.search_term).toBe(subject.fullName);
    expect(body.filters.types).toContain('pep');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Token k');
  });
  it('reports a clean screen on zero hits', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: { content: { data: { hits: [], total_hits: 0 } } } }));
    const f = await complyAdvantageConnector({ apiKey: 'k', fetchImpl }).searchSanctions!(subject, ctx);
    expect(f).toHaveLength(2);
    expect(f.every((x) => x.data.hits === 0 && x.officialRecordMatch)).toBe(true);
  });
});

describe('eCourtsIndia connector', () => {
  it('parses several response shapes and assigns party roles', async () => {
    const name = subject.fullName!;
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { data: { results: [{ cnr: 'TNCH010012342023', case_number: 'CC/1234/2023', petitioner: 'Sunrise Traders', respondent: name, court_name: 'Metropolitan Magistrate, Chennai', case_status: 'Pending', filing_date: '2023-04-18', district: 'Chennai' }, { title: 'State vs Someone Else', petitioner: 'State', respondent: 'Someone Else' }] } } }));
    const f = await eCourtsConnector({ apiToken: 't', fetchImpl }).searchLegalRecords!(subject, ctx);
    expect(f).toHaveLength(2);
    expect(f[0].entityRole).toBe('RESPONDENT');
    expect(f[0].recordId).toBe('case:TNCH010012342023');
    expect(f[0].candidate.city).toBe('Chennai');
    expect(f[1].entityRole).toBe('UNKNOWN');
    expect(calls[0].url).toContain('/api/partner/search?party_name=');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer t');
    expect(parseCases([{ cnr: 'X' }])[0].cnr).toBe('X');
  });
  it('honours a custom search parameter name', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: [] }));
    await eCourtsConnector({ apiToken: 't', fetchImpl, searchParam: 'litigant' }).searchLegalRecords!(subject, ctx);
    expect(calls[0].url).toContain('?litigant=');
  });
});

describe('Attestr MCA connector', () => {
  const employer = subject.employers[0];
  const auto = [{ indexId: 'U72200KA2009PTC054321', businessName: employer, status: 'Active', type: 'Private Limited Company', incorporatedDate: '02-11-2009', active: true, addresses: [{ type: 'Registered Address', city: 'Bengaluru', state: 'Karnataka', fullAddress: '1 MG Road' }] }];
  const master = { valid: true, reg: 'U72200KA2009PTC054321', businessName: employer, authorizedCapital: 50000000, paidCapital: 12500000, directorsAndSignatories: [{ din: '01234567', firstName: subject.fullName!.split(' ')[0], lastName: subject.fullName!.split(' ').slice(-1)[0], designation: 'Director', appointmentDate: '15-06-2018', disqualified: false }, { din: '09999999', firstName: 'Totally', lastName: 'Different', designation: 'Director', appointmentDate: '01-01-2010' }] };
  it('converts DD-MM-YYYY and parses autocomplete rows', () => {
    expect(isoDate('02-11-2009')).toBe('2009-11-02');
    expect(parseAutocomplete(auto)[0].city).toBe('Bengaluru');
  });
  it('resolves employers to CORPORATE_RECORD findings', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: auto }));
    const f = await attestrConnector({ authToken: 'abc', fetchImpl }).searchCompanies!(subject, ctx);
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].resultType).toBe('CORPORATE_RECORD');
    expect(f[0].data.cin).toBe('U72200KA2009PTC054321');
    expect(f[0].officialRecordMatch).toBe(true);
    expect(calls[0].url).toContain('/autocomplete');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Basic abc');
  });
  it('emits a DIRECTORSHIP only for directors whose name matches the subject', async () => {
    const { fetchImpl, calls } = fakeFetch((url) => ({ body: url.endsWith('/master') ? master : auto }));
    const f = await attestrConnector({ authToken: 'abc', fetchImpl }).searchDirectorships!(subject, ctx);
    expect(f).toHaveLength(1);
    expect(f[0].resultType).toBe('DIRECTORSHIP');
    expect(f[0].candidate.din).toBe('01234567');
    expect(f[0].data.appointmentDate).toBe('2018-06-15');
    expect(f[0].officialRecordMatch).toBe(false);
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['autocomplete', 'master']);
    expect(f[0].data).not.toHaveProperty('pan');
    expect(f[0].candidate).not.toHaveProperty('pan');
  });
  it('skips director lookup when disabled', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: auto }));
    const f = await attestrConnector({ authToken: 'abc', fetchImpl, fetchDirectors: false }).searchDirectorships!(subject, ctx);
    expect(f).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('LandLens client', () => {
  it('normalises rates to INR per sq ft from several field spellings', () => {
    expect(extractPerSqft({ guideline_value_per_sqft: 1850 }).perSqft).toBe(1850);
    expect(extractPerSqft({ rate_per_sqm: 10763.9 }).perSqft).toBeCloseTo(1000, 0);
    expect(extractPerSqft({ parcel: { guideline_rate_per_cent: 435600 } }).perSqft).toBe(1000);
    expect(extractPerSqft({ value: 2400, unit: 'per sqft' }).perSqft).toBe(2400);
    expect(extractPerSqft({ village: 'X' }).perSqft).toBeNull();
  });
  it('calls the guideline_value tool with a bearer key and reads the envelope', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { ok: true, status: 200, data: { guideline_value_per_sqft: 1850, igr_classification: 'Residential', village: 'Siruseri', sro: 'Tambaram' }, credits_charged: 0, balance_after: 100, request_id: 'req_1' } }));
    const r = await fetchGuidelineValue({ apiKey: 'llk_test', fetchImpl }, { lat: 12.8, lng: 80.2, surveyNumber: '226', subDivision: '11C', villageName: 'Siruseri', districtName: null });
    expect(r.perSqft).toBe(1850);
    expect(r.classification).toBe('Residential');
    expect(r.requestId).toBe('req_1');
    expect(calls[0].url).toBe('https://verified.realestate/api/v1/tools/guideline_value');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer llk_test');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ lat: 12.8, lng: 80.2, survey_number: '226', sub_division: '11C', village_name: 'Siruseri' });
  });
});
