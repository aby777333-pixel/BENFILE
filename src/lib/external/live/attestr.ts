/**
 * Attestr MCA live connector (catalogue 5.1 - 5.4).
 *
 * 1. Company-name autocomplete resolves each verified employer to MCA master
 *    records (CORPORATE_RECORD, Tier 1).
 * 2. For the best match the company master is fetched (directors included)
 *    and any director whose name matches the subject becomes a DIRECTORSHIP
 *    finding carrying the DIN, which the entity-resolution engine can confirm.
 *
 * Director personal data (DIN / PAN) is processed only under the CORPORATE
 * consent source and PAN is never persisted from this connector.
 */
import { createHash } from 'node:crypto';
import type { SubjectIdentity } from '@/lib/engines/entity-resolution';
import { compareNames } from '@/lib/engines/normalize';
import { asArray, asNumber, asRecord, asString, httpRequest, pick, setRateLimit } from '@/lib/integrations/http';
import type { ConnectorContext, ExternalConnector, RawFinding } from '../types';

const BASE_URL = 'https://api.attestr.com/api/v2/public/corpx/business';
setRateLimit('attestr', 60);

export interface AttestrOptions {
  authToken: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Fetch the company master (with directors) for the top employer match. Default true. */
  fetchDirectors?: boolean;
}

const rid = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

/** DD-MM-YYYY -> YYYY-MM-DD (Attestr date format). */
export function isoDate(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}

interface Company {
  reg: string;
  name: string;
  status: string | null;
  type: string | null;
  incorporated: string | null;
  active: boolean | null;
  city: string | null;
  state: string | null;
  address: string | null;
}

export function parseAutocomplete(payload: unknown): Company[] {
  return asArray(payload).map(asRecord).map((c) => {
    const addresses = asArray(c.addresses).map(asRecord);
    const reg = addresses.find((a) => /registered/i.test(asString(a.type) ?? '')) ?? addresses[0] ?? {};
    return {
      reg: pick(c, 'indexId', 'reg', 'cin') ?? rid(asString(c.businessName) ?? ''),
      name: asString(c.businessName) ?? 'Unnamed company',
      status: asString(c.status),
      type: asString(c.type),
      incorporated: isoDate(asString(c.incorporatedDate)),
      active: typeof c.active === 'boolean' ? c.active : null,
      city: asString(reg.city),
      state: asString(reg.state),
      address: asString(reg.fullAddress),
    };
  });
}

export function attestrConnector(o: AttestrOptions): ExternalConnector {
  const base = (o.baseUrl ?? BASE_URL).replace(/\/$/, '');
  const headers = { authorization: `Basic ${o.authToken}` };
  const post = (path: string, body: unknown) => httpRequest(`${base}${path}`, { provider: 'attestr', headers, body, fetchImpl: o.fetchImpl });

  return {
    key: 'attestr-mca',
    name: 'Attestr MCA Corporate Registry',
    sourceKey: 'MCA',
    sourceClass: 'OFFICIAL_GOVERNMENT',
    tier: 1,
    mode: 'LIVE',
    capabilities: ['searchCompanies', 'searchDirectorships'],
    requiresConsentFor: ['CORPORATE'],
    async searchCompanies(s: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]> {
      const out: RawFinding[] = [];
      for (const employer of s.employers.slice(0, 3)) {
        if (employer.trim().length < 3) continue;
        const res = await post('/autocomplete', { businessName: employer.slice(0, 100), limit: 5, sort: '-score' });
        for (const c of parseAutocomplete(res.data).slice(0, Math.min(5, ctx.maxResults))) {
          const nameMatch = compareNames(employer, c.name);
          out.push({
            recordId: `cin:${c.reg}`,
            resultType: 'CORPORATE_RECORD',
            title: c.name,
            excerpt: `MCA master data - status ${c.status ?? 'unknown'}${c.city ? `, registered office ${c.city}` : ''}. Candidate for the employer "${employer}" on the client's verified employment record (name ${nameMatch.status.toLowerCase().replace('_', ' ')}).`,
            url: null,
            publishedAt: null,
            sourceName: 'MCA21 via Attestr',
            candidate: { employer: c.name, city: c.city },
            data: { cin: c.reg, companyName: c.name, status: c.status, type: c.type, active: c.active, incorporationDate: c.incorporated, registeredOffice: c.address ?? ([c.city, c.state].filter(Boolean).join(', ') || null), employerQueried: employer, employerNameMatch: nameMatch.status, relationToClient: 'EMPLOYER' },
            officialRecordMatch: nameMatch.status === 'MATCH',
            category: 'CORPORATE',
          });
        }
      }
      return out;
    },
    async searchDirectorships(s: SubjectIdentity, ctx: ConnectorContext): Promise<RawFinding[]> {
      if (o.fetchDirectors === false || !s.fullName) return [];
      const employer = s.employers[0];
      if (!employer || employer.trim().length < 3) return [];
      const ac = await post('/autocomplete', { businessName: employer.slice(0, 100), limit: 1, sort: '-score' });
      const top = parseAutocomplete(ac.data)[0];
      if (!top) return [];
      const master = asRecord((await post('/master', { reg: top.reg })).data);
      if (master.valid === false) return [];
      const out: RawFinding[] = [];
      for (const d of asArray(master.directorsAndSignatories).map(asRecord)) {
        const name = [asString(d.firstName), asString(d.middleName), asString(d.lastName)].filter(Boolean).join(' ') || (asString(d.name) ?? '');
        if (!name) continue;
        const cmp = compareNames(s.fullName, name);
        if (cmp.status === 'MISMATCH') continue;
        const din = asString(d.din);
        out.push({
          recordId: `din:${din ?? rid(name, top.reg)}`,
          resultType: 'DIRECTORSHIP',
          title: `${name} - ${asString(d.designation) ?? asString(d.role) ?? 'Director'} of ${asString(master.businessName) ?? top.name}`,
          excerpt: `MCA director / signatory record on ${asString(master.businessName) ?? top.name} (${top.reg}). Appointed ${isoDate(asString(d.appointmentDate)) ?? 'date unknown'}${d.disqualified === true ? '; DISQUALIFIED flag present' : ''}. DIN-level match is only confirmed when the DIN is already on the client's verified profile.`,
          url: null,
          publishedAt: isoDate(asString(d.appointmentDate)),
          sourceName: 'MCA21 via Attestr',
          candidate: { name, din, employer: asString(master.businessName) ?? top.name, city: top.city },
          data: { din, company: asString(master.businessName) ?? top.name, cin: top.reg, designation: asString(d.designation), role: asString(d.role), appointmentDate: isoDate(asString(d.appointmentDate)), cessationDate: isoDate(asString(d.roleCessationDate)), disqualified: d.disqualified === true, currentSignatory: d.isCurrentSignatory === true, authorisedCapital: asNumber(master.authorizedCapital), paidUpCapital: asNumber(master.paidCapital), nameMatch: cmp.status },
          officialRecordMatch: !!din && !!s.din && din === s.din,
          category: 'CORPORATE',
        });
        if (out.length >= ctx.maxResults) break;
      }
      return out;
    },
  };
}
