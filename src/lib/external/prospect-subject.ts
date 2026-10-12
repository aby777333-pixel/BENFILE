/**
 * Subject identity for a prospect who has accepted Part A but has no verification run yet.
 *
 * Sources, in order of precedence: analyst-entered matching details on the External tab,
 * the details the person gave when accepting Part A in the portal (consent.acceptance.details),
 * then the client record (display name, city). Only non-identifier attributes are used -
 * PAN, phone and e-mail enter the system through the verification ingest, never here.
 */
import type { SubjectIdentity } from '@/lib/engines/entity-resolution';

export interface ProspectDetails {
  employer?: string | null;
  dob?: string | null;
  city?: string | null;
  /** Public profile URLs the person nominated (LinkedIn, Instagram, personal site). */
  profiles?: string[];
  occupation?: string | null;
}

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Normalise a free-text list of URLs / handles into https URLs; drops anything that is not a URL. */
export function parseProfileUrls(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[\s,]+/) : [];
  const out: string[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    const withScheme = /^https?:\/\//i.test(s) ? s : /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s) ? `https://${s}` : null;
    if (!withScheme) continue;
    try {
      const u = new URL(withScheme);
      if (!['http:', 'https:'].includes(u.protocol)) continue;
      out.push(u.toString().replace(/\/$/, ''));
    } catch {
      /* skip */
    }
  }
  return [...new Set(out)];
}

/** Read the details stored with the latest Part A / Part B acceptance. */
export function detailsFromConsents(consents: Array<{ status: string; acceptance?: Record<string, unknown> | null }>): ProspectDetails {
  for (const c of consents) {
    if (c.status !== 'GRANTED') continue;
    const d = (c.acceptance?.details ?? null) as Record<string, unknown> | null;
    if (d && typeof d === 'object') return { employer: clean(d.employer), dob: clean(d.dob), city: clean(d.city), occupation: clean(d.occupation), profiles: parseProfileUrls(d.profiles) };
  }
  return {};
}

export function subjectFromProspect(client: { display_name: string; city?: string | null; occupation?: string | null }, consentDetails: ProspectDetails = {}, formDetails: ProspectDetails = {}): SubjectIdentity {
  const employer = clean(formDetails.employer) ?? clean(consentDetails.employer);
  const city = clean(formDetails.city) ?? clean(consentDetails.city) ?? clean(client.city);
  const dob = clean(formDetails.dob) ?? clean(consentDetails.dob);
  const websites = [...new Set([...(formDetails.profiles ?? []), ...(consentDetails.profiles ?? [])])];
  return {
    fullName: clean(client.display_name),
    employers: employer ? [employer] : [],
    occupation: clean(formDetails.occupation) ?? clean(consentDetails.occupation) ?? clean(client.occupation),
    cities: city ? [city] : [],
    emails: [],
    phones: [],
    emailHashes: [],
    phoneHashes: [],
    dob: dob && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : null,
    pan: null,
    din: null,
    uan: null,
    websites,
  };
}

/** Merge analyst-entered details into a subject built from a verification run (adds, never overrides verified facts). */
export function mergeSubjectDetails(subject: SubjectIdentity, details: ProspectDetails): SubjectIdentity {
  const employer = clean(details.employer);
  const city = clean(details.city);
  return {
    ...subject,
    employers: employer && !subject.employers.includes(employer) ? [...subject.employers, employer] : subject.employers,
    cities: city && !subject.cities.includes(city) ? [...subject.cities, city] : subject.cities,
    dob: subject.dob ?? (clean(details.dob) && /^\d{4}-\d{2}-\d{2}$/.test(details.dob!) ? details.dob! : null),
    websites: [...new Set([...(subject.websites ?? []), ...(details.profiles ?? [])])],
  };
}
