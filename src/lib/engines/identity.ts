/**
 * Identity Consistency Engine - rules-based reconciliation across sources.
 * Original values are preserved in the canonical profile / raw payload; this
 * engine only reports comparisons. Minor formatting differences are never fraud.
 */
import type { CanonicalProfile, IdentityCheck, MatchStatus } from '@/lib/canonical/types';
import { maskByKind, normalizePhone, normalizeEmail, normalizeIdentifier } from '@/lib/security/masking';
import { compareNames, normalizeAddress, normalizeCity, normalizeCountry, normalizePin, normalizeState, stringSimilarity } from './normalize';

function nameCheck(key: string, label: string, leftSource: string, rightSource: string, left: string | null, right: string | null): IdentityCheck {
  const r = compareNames(left, right);
  return { key, label, leftSource, rightSource, leftValue: left, rightValue: right, sensitive: false, status: r.status, score: r.score, explanation: r.explanation };
}

export function runIdentityChecks(p: CanonicalProfile): IdentityCheck[] {
  const checks: IdentityCheck[] = [];
  const personName = p.person.fullName.value;
  const pan = p.identityDocuments.find((d) => d.docType === 'PAN');
  const aadhaar = p.identityDocuments.find((d) => d.docType === 'AADHAAR');
  const current = p.employment.records.find((r) => r.status === 'CURRENT') ?? p.employment.records[0];
  const epfoName = current?.employeeNameOnRecord ?? null;
  const bank = p.bankAccounts[0];

  // Name reconciliation
  checks.push(nameCheck('name.person_vs_pan', 'Name: profile vs PAN', 'PROFILE', 'PAN', personName, pan?.nameOnDocument ?? null));
  checks.push(nameCheck('name.pan_vs_epfo', 'Name: PAN vs EPFO record', 'PAN', 'UAN', pan?.nameOnDocument ?? null, epfoName));
  checks.push(nameCheck('name.person_vs_bank', 'Name: profile vs bank account', 'PROFILE', 'BANK', personName, bank?.accountHolderName ?? null));

  // Provider-asserted matches (facts, not our computation)
  const epfo = p.employment.epfo;
  checks.push({
    key: 'epfo.employee_name_match',
    label: 'EPFO employee-name match (provider flag)',
    leftSource: 'UAN',
    rightSource: 'PROVIDER',
    leftValue: epfoName,
    rightValue: epfo?.employeeNameMatch === null || epfo?.employeeNameMatch === undefined ? null : epfo.employeeNameMatch ? 'MATCH' : 'NO MATCH',
    sensitive: false,
    status: epfo?.employeeNameMatch === true ? 'MATCH' : epfo?.employeeNameMatch === false ? 'MISMATCH' : 'NOT_AVAILABLE',
    score: epfo?.employeeNameMatch === true ? 1 : epfo?.employeeNameMatch === false ? 0 : null,
    explanation: 'Flag returned by the verification provider; BENFILE did not compute it.',
  });

  // PAN in credit record vs PAN document
  const creditPan = p.credit?.identifiers?.pan ?? null;
  const panStatus: MatchStatus = !pan?.number || !creditPan ? 'NOT_AVAILABLE' : normalizeIdentifier(pan.number) === normalizeIdentifier(creditPan) ? 'MATCH' : 'MISMATCH';
  checks.push({
    key: 'pan.document_vs_credit',
    label: 'PAN: document vs credit record',
    leftSource: 'PAN',
    rightSource: 'CREDIT',
    leftValue: maskByKind('PAN', pan?.number),
    rightValue: maskByKind('PAN', creditPan),
    sensitive: true,
    status: panStatus,
    score: panStatus === 'MATCH' ? 1 : panStatus === 'MISMATCH' ? 0 : null,
    explanation: panStatus === 'NOT_AVAILABLE' ? 'PAN is not present on both records.' : panStatus === 'MATCH' ? 'Identical PAN on both records.' : 'PAN differs between the document and the credit record.',
  });

  // Linkages
  checks.push({
    key: 'link.pan_aadhaar',
    label: 'PAN - Aadhaar linkage',
    leftSource: 'PAN',
    rightSource: 'AADHAAR',
    leftValue: maskByKind('PAN', pan?.number),
    rightValue: aadhaar?.maskedNumber ? maskByKind('AADHAAR', aadhaar.maskedNumber) : null,
    sensitive: true,
    status: pan?.aadhaarLinked === true || aadhaar?.aadhaarLinked === true ? 'MATCH' : pan?.aadhaarLinked === false ? 'MISMATCH' : 'NOT_AVAILABLE',
    score: null,
    explanation: pan?.aadhaarLinked === true ? 'Provider reports PAN is linked to Aadhaar.' : pan?.aadhaarLinked === false ? 'Provider reports PAN is NOT linked to Aadhaar.' : 'Linkage status not returned.',
  });
  checks.push({
    key: 'link.uan_aadhaar',
    label: 'UAN - Aadhaar linkage',
    leftSource: 'UAN',
    rightSource: 'AADHAAR',
    leftValue: maskByKind('UAN', epfo?.uan),
    rightValue: aadhaar?.maskedNumber ? maskByKind('AADHAAR', aadhaar.maskedNumber) : null,
    sensitive: true,
    status: epfo?.aadhaarLinked === true ? 'MATCH' : epfo?.aadhaarLinked === false ? 'MISMATCH' : 'NOT_AVAILABLE',
    score: null,
    explanation: epfo?.aadhaarLinked === true ? 'Provider reports UAN is Aadhaar-seeded.' : epfo?.aadhaarLinked === false ? 'Provider reports UAN is NOT Aadhaar-seeded.' : 'Linkage status not returned.',
  });

  // Phones: mobile-intel number vs contact numbers
  const mobileNum = p.mobile?.number ? normalizePhone(p.mobile.number) : '';
  const phoneSources = p.contacts.phones.map((ph) => ({ n: normalizePhone(ph.number), src: ph.provenance.sourceKey, raw: ph.number }));
  const phoneHit = mobileNum ? phoneSources.find((x) => x.n === mobileNum) : undefined;
  checks.push({
    key: 'phone.mobile_vs_contacts',
    label: 'Phone: mobile intelligence vs contact records',
    leftSource: 'MOBILE',
    rightSource: phoneHit?.src ?? 'CONTACTS',
    leftValue: maskByKind('PHONE', p.mobile?.number),
    rightValue: phoneHit ? maskByKind('PHONE', phoneHit.raw) : null,
    sensitive: true,
    status: !mobileNum || !phoneSources.length ? 'NOT_AVAILABLE' : phoneHit ? 'MATCH' : 'MISMATCH',
    score: null,
    explanation: phoneHit ? `Mobile-intelligence number matches the ${phoneHit.src}-linked number.` : mobileNum && phoneSources.length ? 'Mobile-intelligence number does not appear among contact numbers.' : 'Insufficient phone data.',
  });

  // Phone overlap across sources (PAN vs UAN)
  const bySrc = new Map<string, Set<string>>();
  for (const x of phoneSources) bySrc.set(x.src, (bySrc.get(x.src) ?? new Set()).add(x.n));
  const srcKeys = [...bySrc.keys()];
  if (srcKeys.length >= 2) {
    const [a, b] = srcKeys;
    const overlap = [...bySrc.get(a)!].some((n) => bySrc.get(b)!.has(n));
    checks.push({
      key: 'phone.cross_source',
      label: `Phone: ${a} vs ${b}`,
      leftSource: a,
      rightSource: b,
      leftValue: [...bySrc.get(a)!].map((n) => maskByKind('PHONE', n)).join(', '),
      rightValue: [...bySrc.get(b)!].map((n) => maskByKind('PHONE', n)).join(', '),
      sensitive: true,
      status: overlap ? 'MATCH' : 'PARTIAL_MATCH',
      score: null,
      explanation: overlap ? 'At least one number is shared between the sources.' : 'Different numbers are linked to different sources. This is common (work vs personal) and is not treated as an inconsistency on its own.',
    });
  }

  // Emails cross-source
  const emails = p.contacts.emails.map((e) => ({ e: normalizeEmail(e.email), src: e.provenance.sourceKey, raw: e.email }));
  if (emails.length >= 2) {
    const domains = new Set(emails.map((x) => x.e.split('@')[1]));
    const sameLocal = new Set(emails.map((x) => x.e.split('@')[0].replace(/[._]/g, ''))).size === 1;
    checks.push({
      key: 'email.cross_source',
      label: `Email: ${emails[0].src} vs ${emails[1].src}`,
      leftSource: emails[0].src,
      rightSource: emails[1].src,
      leftValue: maskByKind('EMAIL', emails[0].raw),
      rightValue: maskByKind('EMAIL', emails[1].raw),
      sensitive: true,
      status: emails[0].e === emails[1].e ? 'MATCH' : sameLocal || domains.size > 1 ? 'PARTIAL_MATCH' : 'MISMATCH',
      score: null,
      explanation: emails[0].e === emails[1].e ? 'Same address on both sources.' : 'Different addresses (e.g. personal vs work). Name tokens in the local part are compatible.',
    });
  }

  // Address consistency (city / state / PIN)
  if (p.addresses.length >= 2) {
    const [a, b] = p.addresses;
    const cityMatch = normalizeCity(a.city) && normalizeCity(a.city) === normalizeCity(b.city);
    const stateMatch = normalizeState(a.state) && normalizeState(a.state) === normalizeState(b.state);
    const countryMatch = normalizeCountry(a.country) === normalizeCountry(b.country);
    const pinMatch = normalizePin(a.pinCode) && normalizePin(a.pinCode) === normalizePin(b.pinCode);
    const textSim = stringSimilarity(normalizeAddress(a.fullAddress), normalizeAddress(b.fullAddress));
    const status: MatchStatus = pinMatch && cityMatch ? 'MATCH' : cityMatch || stateMatch ? 'PARTIAL_MATCH' : 'MISMATCH';
    checks.push({
      key: 'address.cross_source',
      label: `Address: ${a.provenance.sourceKey} vs ${b.provenance.sourceKey}`,
      leftSource: a.provenance.sourceKey,
      rightSource: b.provenance.sourceKey,
      leftValue: [a.city, a.state, a.pinCode].filter(Boolean).join(', '),
      rightValue: [b.city, b.state, b.pinCode].filter(Boolean).join(', '),
      sensitive: false,
      status,
      score: Math.round(textSim * 100) / 100,
      explanation:
        status === 'MATCH'
          ? 'Same city and PIN across sources.'
          : status === 'PARTIAL_MATCH'
            ? `Same ${cityMatch ? 'city' : 'state'} but different locality/PIN (${a.addressType ?? 'address'} vs ${b.addressType ?? 'address'}). Multiple addresses are normal; not a fraud indicator.`
            : `Addresses are in different ${countryMatch ? 'states/cities' : 'countries'}. Worth confirming with the client.`,
    });
  }

  // DOB consistency vs age
  if (p.person.dateOfBirth.value && p.person.age.value !== null && p.person.age.provenance.assertion !== 'DERIVED') {
    const dob = new Date(p.person.dateOfBirth.value);
    const now = new Date();
    const calc = now.getFullYear() - dob.getFullYear() - (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
    const diff = Math.abs(calc - p.person.age.value);
    checks.push({
      key: 'dob.vs_age',
      label: 'Date of birth vs stated age',
      leftSource: p.person.dateOfBirth.provenance.sourceKey,
      rightSource: p.person.age.provenance.sourceKey,
      leftValue: p.person.dateOfBirth.value,
      rightValue: String(p.person.age.value),
      sensitive: false,
      status: diff === 0 ? 'MATCH' : diff === 1 ? 'PARTIAL_MATCH' : 'MISMATCH',
      score: null,
      explanation: diff === 0 ? 'Age is consistent with date of birth.' : diff === 1 ? 'Age differs by one year (likely the record predates the last birthday).' : 'Stated age is inconsistent with date of birth.',
    });
  }

  return checks;
}
