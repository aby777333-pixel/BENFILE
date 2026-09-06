/**
 * Entity resolution / identity-match confidence for external findings.
 * Names collide; a match is only as strong as the corroborating attributes.
 * Never merges on name alone; never uses sensitive personal characteristics.
 */
import { compareNames, normalizeCity, normalizeName } from './normalize';
import { hashIdentifier, normalizeEmail, normalizePhone } from '@/lib/security/masking';

export type MatchStatus = 'CONFIRMED' | 'HIGH_CONFIDENCE' | 'POSSIBLE_MATCH' | 'LOW_CONFIDENCE' | 'NOT_A_MATCH';

export interface SubjectIdentity {
  fullName: string | null;
  employers: string[];
  occupation: string | null;
  cities: string[];
  emails: string[];
  phones: string[];
  /** SHA-256 hashes (see hashIdentifier) - lets matching work without the full values in memory. */
  emailHashes?: string[];
  phoneHashes?: string[];
  dob: string | null;
  pan?: string | null;
  din?: string | null;
  uan?: string | null;
  websites?: string[];
}

export interface CandidateAttributes {
  name?: string | null;
  employer?: string | null;
  occupation?: string | null;
  city?: string | null;
  email?: string | null;
  phone?: string | null;
  dob?: string | null;
  pan?: string | null;
  din?: string | null;
  uan?: string | null;
  website?: string | null;
  crossLinkedProfile?: boolean;
  /** Set only when a government record ID has been positively resolved (Tier 1). */
  officialRecordMatch?: boolean;
}

export interface MatchResult {
  score: number; // 0..100
  status: MatchStatus;
  reasons: string[];
  /** Attributes that were evaluated but not matched. */
  gaps: string[];
}

export interface MatchWeights {
  version: string;
  identifierExact: number; // PAN/DIN/UAN exact
  nameExact: number;
  namePartial: number;
  employer: number;
  occupation: number;
  city: number;
  email: number;
  phone: number;
  dob: number;
  website: number;
  crossLink: number;
}

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  version: 'match-1.0',
  identifierExact: 60,
  nameExact: 25,
  namePartial: 12,
  employer: 20,
  occupation: 8,
  city: 8,
  email: 25,
  phone: 25,
  dob: 20,
  website: 10,
  crossLink: 10,
};

export function resolveEntity(subject: SubjectIdentity, cand: CandidateAttributes, w: MatchWeights = DEFAULT_MATCH_WEIGHTS): MatchResult {
  let score = 0;
  const reasons: string[] = [];
  const gaps: string[] = [];

  if (cand.officialRecordMatch) {
    score += w.identifierExact;
    reasons.push('Official record identifier resolved (Tier 1 source)');
  }
  const idPairs: Array<[string, string | null | undefined, string | null | undefined]> = [
    ['PAN', subject.pan, cand.pan],
    ['DIN', subject.din, cand.din],
    ['UAN', subject.uan, cand.uan],
  ];
  for (const [label, a, b] of idPairs) {
    if (a && b) {
      if (a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase()) {
        score += w.identifierExact;
        reasons.push(`${label} exact match`);
      } else {
        score -= 40;
        reasons.push(`${label} differs`);
      }
    }
  }

  const nm = compareNames(subject.fullName, cand.name ?? null);
  if (nm.status === 'MATCH') {
    score += w.nameExact;
    reasons.push('Name exact match');
  } else if (nm.status === 'PARTIAL_MATCH') {
    score += w.namePartial;
    reasons.push('Name partial match');
  } else if (nm.status === 'MISMATCH') {
    score -= 30;
    reasons.push('Name does not match');
  } else gaps.push('name');

  if (cand.employer) {
    const hit = subject.employers.some((e) => compareNames(e, cand.employer).status !== 'MISMATCH' && normalizeName(e).split(' ')[0] === normalizeName(cand.employer).split(' ')[0]);
    if (hit) {
      score += w.employer;
      reasons.push('Employer exact match');
    } else gaps.push('employer');
  } else gaps.push('employer');

  if (cand.occupation && subject.occupation) {
    if (normalizeName(cand.occupation) === normalizeName(subject.occupation) || normalizeName(cand.occupation).includes(normalizeName(subject.occupation).split(' ')[0])) {
      score += w.occupation;
      reasons.push('Occupation match');
    } else gaps.push('occupation');
  }
  if (cand.city) {
    if (subject.cities.some((c) => normalizeCity(c) === normalizeCity(cand.city))) {
      score += w.city;
      reasons.push('City match');
    } else gaps.push('city');
  }
  if (cand.email) {
    const h = hashIdentifier('EMAIL', cand.email);
    if (subject.emails.some((e) => normalizeEmail(e) === normalizeEmail(cand.email)) || (h && subject.emailHashes?.includes(h))) {
      score += w.email;
      reasons.push('Public email match');
    } else gaps.push('email');
  }
  if (cand.phone) {
    const h = hashIdentifier('PHONE', cand.phone);
    if (subject.phones.some((p) => normalizePhone(p) === normalizePhone(cand.phone)) || (h && subject.phoneHashes?.includes(h))) {
      score += w.phone;
      reasons.push('Phone match');
    } else gaps.push('phone');
  }
  if (cand.dob && subject.dob) {
    if (cand.dob.slice(0, 10) === subject.dob.slice(0, 10)) {
      score += w.dob;
      reasons.push('Date of birth match');
    } else {
      score -= 30;
      reasons.push('Date of birth differs');
    }
  }
  if (cand.website && subject.websites?.some((s) => s.replace(/^https?:\/\/(www\.)?/, '').toLowerCase() === cand.website!.replace(/^https?:\/\/(www\.)?/, '').toLowerCase())) {
    score += w.website;
    reasons.push('Company website cross-reference');
  }
  if (cand.crossLinkedProfile) {
    score += w.crossLink;
    reasons.push('Cross-linked from a confirmed profile');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const positive = reasons.filter((r) => /match|resolved|cross/i.test(r) && !/does not|differs/.test(r));
  const corroborating = positive.filter((r) => !r.startsWith('Name')).length;
  const nameOnly = corroborating === 0;
  const status: MatchStatus =
    reasons.some((r) => /^(PAN|DIN|UAN) exact match$|^Official record identifier resolved/.test(r)) && nm.status !== 'MISMATCH'
      ? 'CONFIRMED'
      : ((score >= 60 && corroborating >= 2) || (score >= 45 && corroborating >= 3)) && nm.status !== 'MISMATCH'
        ? 'HIGH_CONFIDENCE'
        : score >= 45 || (score >= 30 && corroborating >= 1)
          ? 'POSSIBLE_MATCH'
          : score >= 20 || nm.status === 'MATCH' || nm.status === 'PARTIAL_MATCH'
            ? 'LOW_CONFIDENCE'
            : 'NOT_A_MATCH';
  // A name-only hit can never exceed POSSIBLE_MATCH: names collide.
  const capped = nameOnly && status === 'HIGH_CONFIDENCE' ? 'POSSIBLE_MATCH' : status;
  return { score, status: capped, reasons, gaps };
}

/** Uncertain identities must be human-reviewed before they attach to the permanent profile. */
export function requiresHumanReview(status: MatchStatus): boolean {
  return status !== 'CONFIRMED';
}
