/**
 * SANDBOX connectors.
 *
 * No licensed government, registry, bureau, court or media API credentials are
 * configured yet, so these connectors return deterministic, clearly-labelled
 * illustrative records shaped like the real sources. They exercise the full
 * pipeline (entity resolution, review workflow, relationship graph, adverse-media
 * classification) and are swapped for LIVE connectors by implementing the same
 * interface. They never fetch anything from the internet.
 */
import { createHash } from 'node:crypto';
import type { SubjectIdentity } from '@/lib/engines/entity-resolution';
import { normalizeName } from '@/lib/engines/normalize';
import type { ConnectorContext, ExternalConnector, RawFinding } from './types';

const slug = (s: string) => normalizeName(s).toLowerCase().replace(/\s+/g, '-');
const rid = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
const iso = (d: Date, minusDays: number) => new Date(d.getTime() - minusDays * 86_400_000).toISOString();
const first = (s: SubjectIdentity) => (s.fullName ?? 'Client').split(' ')[0];
const last = (s: SubjectIdentity) => {
  const t = (s.fullName ?? 'Client').split(' ');
  return t[t.length - 1];
};
const employer = (s: SubjectIdentity) => s.employers[0] ?? null;
const city = (s: SubjectIdentity) => s.cities[0] ?? 'Bengaluru';
const otherCity = (s: SubjectIdentity) => (normalizeName(city(s)) === 'MUMBAI' ? 'Pune' : 'Mumbai');

export const mcaSandbox: ExternalConnector = {
  key: 'mca-sandbox',
  name: 'MCA Corporate Registry (sandbox)',
  sourceKey: 'MCA',
  sourceClass: 'OFFICIAL_GOVERNMENT',
  tier: 1,
  mode: 'SANDBOX',
  capabilities: ['searchCompanies', 'searchDirectorships'],
  requiresConsentFor: ['CORPORATE'],
  async searchCompanies(s, ctx) {
    const emp = employer(s);
    if (!emp) return [];
    const cin = `U72200KA2009PTC${rid(emp).slice(0, 6).toUpperCase()}`;
    return [
      {
        recordId: `cin:${cin}`,
        resultType: 'CORPORATE_RECORD',
        title: emp,
        excerpt: `Company master data - status Active. Registered office ${city(s)}. Employer named on the client's EPFO record.`,
        url: null,
        publishedAt: null,
        sourceName: 'MCA21 company master data (sandbox)',
        candidate: { employer: emp, city: city(s) },
        data: { cin, companyName: emp, status: 'Active', class: 'Private', category: 'Company limited by shares', incorporationDate: '2009-11-02', registeredOffice: `${city(s)}, Karnataka`, authorisedCapital: 50_000_000, paidUpCapital: 12_500_000, industry: 'Computer programming, consultancy and related activities', lastAgmDate: iso(ctx.now, 320).slice(0, 10), filingStatus: 'Up to date', relationToClient: 'EMPLOYER' },
        officialRecordMatch: true,
        category: 'CORPORATE',
      },
    ];
  },
  async searchDirectorships(s) {
    const name = `${first(s)} ${last(s)}`;
    const llp = `${last(s)} Family Ventures LLP`;
    const din = `0${rid(name).replace(/\D/g, '').padEnd(7, '4').slice(0, 7)}`;
    return [
      {
        recordId: `din:${din}`,
        resultType: 'DIRECTORSHIP',
        title: `Designated Partner - ${llp}`,
        excerpt: `A person named ${name.toUpperCase()} holds DIN ${din} and is a designated partner of ${llp} (${city(s)}). Name and city match; no DIN on the client's verified record to confirm.`,
        url: null,
        publishedAt: null,
        sourceName: 'MCA21 director master data (sandbox)',
        candidate: { name, city: city(s) },
        data: { din, personName: name.toUpperCase(), company: llp, llpin: `AAB-${rid(llp).slice(0, 4).toUpperCase()}`, designation: 'Designated Partner', appointmentDate: '2021-08-16', cessationDate: null, companyStatus: 'Active', registeredOffice: `${city(s)}, Karnataka` },
        category: 'CORPORATE',
      },
    ];
  },
};

export const gstSandbox: ExternalConnector = {
  key: 'gst-sandbox',
  name: 'GST Registration (sandbox)',
  sourceKey: 'GST',
  sourceClass: 'OFFICIAL_GOVERNMENT',
  tier: 1,
  mode: 'SANDBOX',
  capabilities: ['verifyIdentity', 'searchCompanies'],
  requiresConsentFor: ['CORPORATE'],
  async verifyIdentity(s) {
    return [
      {
        recordId: `gst-screen:${rid(s.fullName ?? '')}`,
        resultType: 'GOVERNMENT_RECORD',
        title: 'No GSTIN registered against the client PAN',
        excerpt: 'GST taxpayer search returned no registration linked to the verified PAN. Absence of a GSTIN is normal for salaried individuals and is not a negative indicator.',
        url: null,
        publishedAt: null,
        sourceName: 'GSTN taxpayer search (sandbox)',
        candidate: { name: s.fullName, pan: s.pan ?? null },
        data: { registrations: 0, searchedBy: 'PAN' },
        officialRecordMatch: !!s.pan,
        category: 'REGULATORY',
      },
    ];
  },
};

export const sanctionsSandbox: ExternalConnector = {
  key: 'sanctions-sandbox',
  name: 'Sanctions & PEP Screening (sandbox)',
  sourceKey: 'SANCTIONS',
  sourceClass: 'OFFICIAL_GOVERNMENT',
  tier: 1,
  mode: 'SANDBOX',
  capabilities: ['searchSanctions'],
  requiresConsentFor: ['SCREENING'],
  async searchSanctions(s, ctx) {
    const name = s.fullName ?? 'Client';
    return [
      {
        recordId: `sanctions:${rid(name, ctx.now.toISOString().slice(0, 10))}`,
        resultType: 'SANCTIONS_SCREEN',
        title: 'Sanctions / watchlist screen - no match',
        excerpt: `Screened "${name}" and validated name variations against UN, OFAC, EU, UK HMT, MHA banned organisations and RBI caution lists. 0 potential matches at the configured threshold.`,
        url: null,
        publishedAt: null,
        sourceName: 'Consolidated sanctions lists (sandbox)',
        candidate: { name },
        data: { lists: ['UN', 'OFAC SDN', 'EU', 'UK HMT', 'MHA', 'RBI'], hits: 0, threshold: 0.85, screenedAt: ctx.now.toISOString() },
        officialRecordMatch: true,
        category: 'REGULATORY',
      },
      {
        recordId: `pep:${rid(name)}`,
        resultType: 'PEP_SCREEN',
        title: 'Politically exposed person screen - no match',
        excerpt: 'No PEP or relative/close-associate match found for the client name and date of birth.',
        url: null,
        publishedAt: null,
        sourceName: 'PEP database (sandbox)',
        candidate: { name, dob: s.dob },
        data: { hits: 0 },
        officialRecordMatch: true,
        category: 'REGULATORY',
      },
    ];
  },
};

export const courtsSandbox: ExternalConnector = {
  key: 'courts-sandbox',
  name: 'Court & Tribunal Records (sandbox)',
  sourceKey: 'ECOURTS',
  sourceClass: 'PUBLIC_RECORD',
  tier: 3,
  mode: 'SANDBOX',
  capabilities: ['searchLegalRecords'],
  requiresConsentFor: ['LEGAL'],
  async searchLegalRecords(s) {
    const name = `${first(s)} ${last(s)}`;
    const oc = otherCity(s);
    return [
      {
        recordId: `case:CC/${rid(name, oc).slice(0, 4)}/2023`,
        resultType: 'LEGAL_RECORD',
        title: `CC/${rid(name, oc).slice(0, 4).toUpperCase()}/2023 - Complaint under s.138 NI Act`,
        excerpt: `A respondent named ${name} appears in a cheque-dishonour complaint before the Metropolitan Magistrate, ${oc}. City differs from the client's verified addresses and no other identifier matches. Presence of a name in litigation is not evidence of wrongdoing.`,
        url: null,
        publishedAt: '2023-04-18',
        sourceName: 'eCourts case status (sandbox)',
        candidate: { name, city: oc },
        data: { caseNumber: `CC/${rid(name, oc).slice(0, 4).toUpperCase()}/2023`, court: `Metropolitan Magistrate Court, ${oc}`, caseType: 'Criminal complaint (s.138 Negotiable Instruments Act)', petitioner: 'Sunrise Traders', respondent: name, filingDate: '2023-04-18', status: 'Pending', lastOrderDate: '2026-02-11', orderLink: null },
        entityRole: 'RESPONDENT',
        category: 'LEGAL',
      },
    ];
  },
};

export const mediaSandbox: ExternalConnector = {
  key: 'media-sandbox',
  name: 'News & Adverse Media (sandbox)',
  sourceKey: 'NEWS',
  sourceClass: 'NEWS_MEDIA',
  tier: 4,
  mode: 'SANDBOX',
  capabilities: ['searchMedia'],
  requiresConsentFor: ['MEDIA'],
  async searchMedia(s, ctx) {
    const emp = employer(s);
    const name = `${first(s)} ${last(s)}`;
    const oc = otherCity(s);
    const out: RawFinding[] = [];
    if (emp) {
      out.push({
        recordId: `news:${rid(emp, 'expansion')}`,
        resultType: 'NEWS',
        title: `${emp} expands ${city(s)} campus, plans 400 new engineering hires`,
        excerpt: `${emp} said on Tuesday it will add 400 jobs at its ${city(s)} development centre over the next year as client demand grows...`,
        url: `https://news.example/business/${slug(emp)}-expands-${slug(city(s))}`,
        publishedAt: iso(ctx.now, 41),
        sourceName: 'Business Standard (sandbox)',
        candidate: { employer: emp, city: city(s) },
        data: { publication: 'Business Standard', entity: emp, entityType: 'EMPLOYER' },
        category: 'BUSINESS',
      });
    }
    out.push({
      recordId: `news:${rid(name, 'founder')}`,
      resultType: 'NEWS',
      title: `${oc} startup founder ${name} accused of fraud by former co-founder`,
      excerpt: `A civil dispute between the co-founders of a ${oc}-based logistics startup has escalated, with one party alleging misappropriation of funds. No court has ruled on the allegations...`,
      url: `https://news.example/startups/${slug(name)}-cofounder-dispute`,
      publishedAt: iso(ctx.now, 210),
      sourceName: 'Regional business daily (sandbox)',
      candidate: { name, city: oc, occupation: 'Founder' },
      data: { publication: 'Regional business daily', entity: name, entityType: 'PERSON', allegation: true, adjudicated: false },
      category: 'POTENTIAL_ADVERSE',
    });
    return out;
  },
};

export const professionalSandbox: ExternalConnector = {
  key: 'professional-sandbox',
  name: 'Professional Profiles (sandbox)',
  sourceKey: 'PROFESSIONAL',
  sourceClass: 'PROFESSIONAL_PROFILE',
  tier: 5,
  mode: 'SANDBOX',
  capabilities: ['searchProfessionalProfiles', 'searchEmployment'],
  requiresConsentFor: ['PROFESSIONAL'],
  async searchProfessionalProfiles(s, ctx) {
    const emp = employer(s);
    const name = `${first(s)} ${last(s)}`;
    const prev = s.employers[1] ?? null;
    const timeline = [
      ...(prev ? [{ from: '2015-07', to: '2018-04', organisation: prev, title: 'Software Engineer' }] : []),
      ...(emp ? [{ from: '2018-05', to: null, organisation: emp, title: `Senior ${s.occupation ?? 'Engineer'}` }] : []),
    ];
    return [
      {
        recordId: `pro:linkedin:${slug(name)}`,
        resultType: 'PROFESSIONAL_PROFILE',
        title: `${name} - ${emp ? `Senior ${s.occupation ?? 'Engineer'} at ${emp}` : s.occupation ?? 'Professional'} - ${city(s)}`,
        excerpt: `Public professional profile. Headline lists ${emp ?? 'an employer'} in ${city(s)}; experience section dates align with the EPFO joining date.`,
        url: `https://www.linkedin.com/in/${slug(name)}-${rid(name).slice(0, 4)}`,
        publishedAt: null,
        sourceName: 'LinkedIn public profile (sandbox)',
        candidate: { name, employer: emp, occupation: s.occupation, city: city(s), website: `https://${slug(name)}.dev` },
        data: { platform: 'LinkedIn', headline: `Senior ${s.occupation ?? 'Engineer'} at ${emp ?? '-'}`, location: city(s), timeline, education: [{ institution: 'Visvesvaraya Technological University', degree: 'B.E. Computer Science', year: 2013 }], certifications: ['AWS Solutions Architect - Associate'] },
        category: 'PROFESSIONAL',
      },
      {
        recordId: `pro:github:${slug(name)}`,
        resultType: 'PROFESSIONAL_PROFILE',
        title: `GitHub - ${slug(name).replace(/-/g, '')}`,
        excerpt: `Public GitHub account. Bio: "${s.occupation ?? 'Engineer'} @ ${emp ? emp.split(' ')[0] : '-'} - ${city(s)}". 38 public repositories; links to ${slug(name)}.dev.`,
        url: `https://github.com/${slug(name).replace(/-/g, '')}`,
        publishedAt: null,
        sourceName: 'GitHub public profile (sandbox)',
        candidate: { name, employer: emp, city: city(s), website: `https://${slug(name)}.dev`, crossLinkedProfile: true },
        data: { platform: 'GitHub', publicRepos: 38, memberSince: '2014-02', bio: `${s.occupation ?? 'Engineer'} @ ${emp ? emp.split(' ')[0] : '-'} - ${city(s)}` },
        category: 'PROFESSIONAL',
      },
      {
        recordId: `pro:speaker:${slug(name)}:${ctx.now.getFullYear() - 1}`,
        resultType: 'WEB_MENTION',
        title: `Speaker: ${name} - "Observability at scale" - DevConf ${city(s)} ${ctx.now.getFullYear() - 1}`,
        excerpt: `Conference speaker page listing ${name}, ${emp ?? ''}.`,
        url: `https://devconf.example/${ctx.now.getFullYear() - 1}/speakers/${slug(name)}`,
        publishedAt: iso(ctx.now, 400),
        sourceName: 'Conference website (sandbox)',
        candidate: { name, employer: emp, city: city(s) },
        data: { event: `DevConf ${city(s)}`, talk: 'Observability at scale' },
        category: 'PROFESSIONAL',
      },
    ];
  },
};

export const socialSandbox: ExternalConnector = {
  key: 'social-sandbox',
  name: 'Public Social Profiles (sandbox)',
  sourceKey: 'SOCIAL',
  sourceClass: 'USER_GENERATED',
  tier: 7,
  mode: 'SANDBOX',
  capabilities: ['searchPublicSocialProfiles'],
  requiresConsentFor: ['SOCIAL'],
  async searchPublicSocialProfiles(s) {
    const emp = employer(s);
    const name = `${first(s)} ${last(s)}`;
    const handle = `${first(s).toLowerCase()}${last(s).toLowerCase()}_dev`;
    return [
      {
        recordId: `social:x:${handle}`,
        resultType: 'SOCIAL_PROFILE',
        title: `@${handle} on X`,
        excerpt: `Public profile. Bio: "${s.occupation ?? 'Engineer'} @${emp ? emp.split(' ')[0] : ''} - ${city(s)} - opinions my own". Links to ${slug(name)}.dev. Only public bio and profile metadata were collected.`,
        url: `https://x.com/${handle}`,
        publishedAt: null,
        sourceName: 'X public profile (sandbox)',
        candidate: { name, employer: emp, city: city(s), website: `https://${slug(name)}.dev`, crossLinkedProfile: true },
        data: { platform: 'X', handle, bio: `${s.occupation ?? 'Engineer'} @${emp ? emp.split(' ')[0] : ''} - ${city(s)}`, joined: '2012-09', collected: ['bio', 'display name', 'link'] },
        category: 'SOCIAL',
      },
      {
        recordId: `social:instagram:${first(s).toLowerCase()}.${last(s).toLowerCase()}`,
        resultType: 'SOCIAL_PROFILE',
        title: `${first(s).toLowerCase()}.${last(s).toLowerCase()} on Instagram`,
        excerpt: 'Public account with the same display name. No employer, city or link in the public bio; nothing corroborates the identity. Content was not collected.',
        url: `https://www.instagram.com/${first(s).toLowerCase()}.${last(s).toLowerCase()}/`,
        publishedAt: null,
        sourceName: 'Instagram public profile (sandbox)',
        candidate: { name },
        data: { platform: 'Instagram', bio: null, collected: ['display name'] },
        category: 'SOCIAL',
      },
    ];
  },
};

export const webSandbox: ExternalConnector = {
  key: 'web-sandbox',
  name: 'Public Web Search (sandbox)',
  sourceKey: 'WEB',
  sourceClass: 'PUBLIC_WEB',
  tier: 6,
  mode: 'SANDBOX',
  capabilities: ['searchPerson', 'searchAssets'],
  requiresConsentFor: ['WEB'],
  async searchPerson(s) {
    const name = `${first(s)} ${last(s)}`;
    const emp = employer(s);
    return [
      {
        recordId: `web:site:${slug(name)}.dev`,
        resultType: 'WEB_MENTION',
        title: `${slug(name)}.dev - personal website`,
        excerpt: `"Hi, I'm ${first(s)}. I build distributed systems at ${emp ?? 'a technology company'} in ${city(s)}." WHOIS: registrant redacted (privacy service).`,
        url: `https://${slug(name)}.dev`,
        publishedAt: null,
        sourceName: 'Personal website (sandbox)',
        candidate: { name, employer: emp, city: city(s), website: `https://${slug(name)}.dev` },
        data: { domain: `${slug(name)}.dev`, registrar: 'Namecheap', created: '2019-03-11', whoisPrivacy: true },
        category: 'PROFESSIONAL',
      },
    ];
  },
  async searchAssets(s) {
    const name = `${first(s)} ${last(s)}`;
    return [
      {
        recordId: `asset:rera:${rid(name, 'rera')}`,
        resultType: 'PUBLIC_ASSET',
        title: `RERA allottee listing - "${name}" - Prestige Lakeside Habitat, Phase 2`,
        excerpt: 'A project allottee list published under RERA includes this name. Allottee lists identify buyers by name only; ownership cannot be confirmed without the sale deed or registration index. Labelled POSSIBLE ASSOCIATION.',
        url: null,
        publishedAt: '2024-09-30',
        sourceName: 'Karnataka RERA project disclosures (sandbox)',
        candidate: { name, city: city(s) },
        data: { assetType: 'Residential unit (under construction)', project: 'Prestige Lakeside Habitat, Phase 2', unit: 'Tower C - 1104', label: 'POSSIBLE_ASSOCIATION', valueEstimated: null },
        category: 'ASSET',
      },
    ];
  },
};

export const SANDBOX_CONNECTORS: ExternalConnector[] = [mcaSandbox, gstSandbox, sanctionsSandbox, courtsSandbox, mediaSandbox, professionalSandbox, socialSandbox, webSandbox];
