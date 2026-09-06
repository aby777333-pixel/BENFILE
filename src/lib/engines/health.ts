/** Financial Health indicators, Financial Capacity gate and the executive summary lines. */
import type { CanonicalProfile, DataQualityRow, FinancialCapacity, HealthIndicator, IdentityCheck, RiskSignal, SummaryLine } from '@/lib/canonical/types';
import { overallFreshness } from './freshness';
import { maxSeverity } from './risk';
import { formatDate, formatINR, formatTenure, monthsBetween } from './normalize';

export function buildHealthIndicators(p: CanonicalProfile, checks: IdentityCheck[], signals: RiskSignal[], quality: DataQualityRow[], now = new Date()): HealthIndicator[] {
  const out: HealthIndicator[] = [];
  const inc = p.person.income.value;
  out.push({
    key: 'income',
    label: inc?.kind === 'DECLARED' ? 'Declared income' : 'Reported income',
    state: inc?.amount ? 'GOOD' : 'NOT_AVAILABLE',
    display: inc?.amount ? `${formatINR(inc.amount)} / ${inc.period === 'ANNUAL' ? 'yr' : 'mo'}` : 'Not available',
    assertion: p.person.income.provenance.assertion,
    detail: inc?.amount ? `${inc.kind === 'RETURNED' ? 'Income as returned by' : inc.kind === 'DECLARED' ? 'Declared by the client, recorded via' : 'Verified via'} ${p.person.income.provenance.sourceLabel}.` : 'No income figure was returned by any source.',
    evidence: inc?.amount ? [{ label: 'Income', sourceKey: p.person.income.provenance.sourceKey, path: p.person.income.provenance.evidencePath, value: formatINR(inc.amount) }] : [],
  });

  const c = p.credit;
  out.push({
    key: 'credit',
    label: 'Credit score',
    state: c?.score === null || c?.score === undefined ? 'NOT_AVAILABLE' : c.score >= 750 ? 'STRONG' : c.score >= 700 ? 'GOOD' : c.score >= 650 ? 'MODERATE' : 'WEAK',
    display: c?.score !== null && c?.score !== undefined ? `${c.score} - ${c.band.replace('_', ' ')}` : 'Not available',
    assertion: 'VERIFIED_FACT',
    detail: c?.score !== null && c?.score !== undefined ? `${c.bureau ?? 'Bureau'} score dated ${formatDate(c.scoreDate)}.` : 'No bureau score returned.',
    evidence: c ? [{ label: 'Credit score', sourceKey: 'CREDIT', path: c.provenance.evidencePath, value: String(c.score) }] : [],
  });

  const current = p.employment.records.find((r) => r.status === 'CURRENT');
  const tenure = current ? monthsBetween(current.joiningDate, null, now) : null;
  out.push({
    key: 'employment',
    label: 'Employment stability',
    state: !p.employment.records.length ? 'NOT_AVAILABLE' : current ? (tenure !== null && tenure >= 36 ? 'STRONG' : tenure !== null && tenure >= 12 ? 'GOOD' : 'MODERATE') : 'NEEDS_REVIEW',
    display: current ? `Employed - ${current.employer.name}` : p.employment.records.length ? 'No current EPFO employment' : 'Not available',
    assertion: 'VERIFIED_FACT',
    detail: current ? `EPFO shows active membership since ${formatDate(current.joiningDate)}.` : p.employment.records.length ? 'Latest EPFO record shows an exit. Absence of a current record is not negative on its own.' : 'No EPFO records returned.',
    evidence: current ? [{ label: 'Employer', sourceKey: 'UAN', path: current.provenance.evidencePath, value: current.employer.name }] : [],
  });
  out.push({
    key: 'tenure',
    label: 'Employment tenure',
    state: tenure === null ? 'NOT_AVAILABLE' : tenure >= 36 ? 'STRONG' : tenure >= 12 ? 'GOOD' : 'MODERATE',
    display: tenure === null ? 'Not available' : formatTenure(tenure),
    assertion: 'DERIVED',
    detail: tenure === null ? 'Requires a current joining date.' : `Derived from EPFO joining date ${formatDate(current?.joiningDate)} to today.`,
    evidence: current ? [{ label: 'Joining date', sourceKey: 'UAN', path: current.provenance.evidencePath, value: current.joiningDate }] : [],
  });
  const emp = current?.employer ?? p.employment.records[0]?.employer;
  const empAge = emp?.setupDate ? Math.floor((monthsBetween(emp.setupDate, null, now) ?? 0) / 12) : null;
  out.push({
    key: 'employer',
    label: 'Employer stability',
    state: !emp ? 'NOT_AVAILABLE' : empAge !== null && empAge >= 10 && (emp.employeeCount ?? 0) >= 500 ? 'STRONG' : empAge !== null && empAge >= 5 ? 'GOOD' : empAge !== null ? 'MODERATE' : 'NOT_AVAILABLE',
    display: emp ? [empAge !== null ? `${empAge} yrs old` : null, emp.employeeCount ? `${emp.employeeCount.toLocaleString('en-IN')} employees` : null].filter(Boolean).join(' - ') || 'Limited data' : 'Not available',
    assertion: 'DERIVED',
    detail: emp ? `Establishment ${emp.ownershipType ?? ''} set up ${formatDate(emp.setupDate)}; ${emp.pfFilings.length} recent PF filings on record.` : 'No employer intelligence.',
    evidence: emp ? [{ label: 'Establishment', sourceKey: 'UAN', path: emp.provenance.evidencePath, value: emp.establishmentId }] : [],
  });
  const bank = p.bankAccounts[0];
  out.push({
    key: 'banking',
    label: 'Banking verification',
    state: !bank ? 'NOT_AVAILABLE' : bank.verified === true ? 'STRONG' : 'GOOD',
    display: bank ? `${bank.bankName ?? 'Bank'} - ${bank.verified === true ? 'verified' : 'account on record'}` : 'Not available',
    assertion: 'VERIFIED_FACT',
    detail: bank ? `Account information linked via ${bank.provenance.sourceLabel}. ${bank.verified === true ? 'Penny-drop/ownership verified.' : 'Ownership not independently verified.'}` : 'No bank account returned.',
    evidence: bank ? [{ label: 'IFSC', sourceKey: bank.provenance.sourceKey, path: bank.provenance.evidencePath, value: bank.ifsc }] : [],
  });
  const grp = (prefix: string, label: string, key: string) => {
    const rel = checks.filter((x) => x.key.startsWith(prefix) && x.status !== 'NOT_AVAILABLE');
    const state: HealthIndicator['state'] = !rel.length ? 'NOT_AVAILABLE' : rel.some((x) => x.status === 'MISMATCH') ? 'NEEDS_REVIEW' : rel.every((x) => x.status === 'MATCH') ? 'STRONG' : 'GOOD';
    out.push({
      key,
      label,
      state,
      display: !rel.length ? 'Not available' : `${rel.filter((x) => x.status === 'MATCH').length}/${rel.length} match${rel.some((x) => x.status === 'PARTIAL_MATCH') ? ', partial present' : ''}`,
      assertion: 'DERIVED',
      detail: rel.map((x) => `${x.label}: ${x.status.replace('_', ' ')}`).join('; ') || 'No comparable records.',
      evidence: rel.map((x) => ({ label: x.label, sourceKey: x.leftSource, value: x.status })),
    });
  };
  grp('name.', 'Identity consistency', 'identity');
  grp('phone.', 'Contact consistency', 'contact');
  grp('address.', 'Address consistency', 'address');
  const live = signals.filter((s) => !['DISMISSED', 'RESOLVED'].includes(s.status));
  const sev = maxSeverity(live);
  out.push({
    key: 'risk',
    label: 'Risk alerts',
    state: sev === 'NONE' || sev === 'INFO' ? 'STRONG' : sev === 'LOW' ? 'GOOD' : sev === 'MEDIUM' ? 'MODERATE' : 'WEAK',
    display: live.length ? `${live.length} open - highest ${sev}` : 'No open alerts',
    assertion: 'DERIVED',
    detail: `${live.filter((s) => s.requiresReview).length} signal(s) flagged for human review.`,
    evidence: live.slice(0, 5).map((s) => ({ label: s.title, sourceKey: s.sourceKey, value: s.severity })),
  });
  const fresh = overallFreshness(quality);
  out.push({
    key: 'freshness',
    label: 'Data freshness',
    state: fresh === 'FRESH' ? 'STRONG' : fresh === 'RECENT' ? 'GOOD' : fresh === 'AGING' ? 'MODERATE' : fresh === 'STALE' ? 'WEAK' : 'NOT_AVAILABLE',
    display: fresh === 'UNKNOWN' ? 'Unknown' : fresh,
    assertion: 'DERIVED',
    detail: 'Worst freshness among the available sources.',
    evidence: quality.filter((q) => q.available).map((q) => ({ label: q.label, sourceKey: q.sourceKey, value: q.ageDays === null ? 'unknown' : `${q.ageDays} days` })),
  });
  return out;
}

export function buildCapacity(p: CanonicalProfile): FinancialCapacity {
  const inputs: FinancialCapacity['inputs'] = [
    { key: 'income', label: 'Verified income', available: !!p.person.income.value?.amount, assertion: p.person.income.provenance.assertion, value: p.person.income.value?.amount ? formatINR(p.person.income.value.amount) : null },
    { key: 'employment', label: 'Employment stability', available: p.employment.records.some((r) => r.status === 'CURRENT'), assertion: 'VERIFIED_FACT' },
    { key: 'obligations', label: 'Credit obligations / EMIs', available: p.credit?.summary.totalOutstanding !== null && p.credit?.summary.totalOutstanding !== undefined, assertion: 'VERIFIED_FACT' },
    { key: 'debt', label: 'Total debt', available: false },
    { key: 'banking', label: 'Bank balances / cash flow', available: false },
    { key: 'investments', label: 'Investments', available: false },
    { key: 'assets', label: 'Assets', available: false },
    { key: 'liabilities', label: 'Liabilities', available: false },
  ];
  const have = inputs.filter((i) => i.available).length;
  const required = ['income', 'obligations', 'banking'];
  const ok = required.every((k) => inputs.find((i) => i.key === k)?.available);
  return {
    status: ok ? 'AVAILABLE' : have >= 2 ? 'PARTIAL' : 'INSUFFICIENT',
    statement: ok
      ? 'Sufficient verified inputs exist to prepare a capacity view. Investment capacity is never inferred from income and credit score alone.'
      : 'Insufficient verified information to estimate financial capacity. Income and credit score alone are not used to infer investment capacity.',
    inputs,
  };
}

export function buildSummary(p: CanonicalProfile, checks: IdentityCheck[], signals: RiskSignal[], quality: DataQualityRow[], confidence: 'HIGH' | 'MEDIUM' | 'LOW', now = new Date()): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const nameChecks = checks.filter((c) => c.key.startsWith('name.') && c.status !== 'NOT_AVAILABLE');
  const idState = !nameChecks.length ? 'Not comparable' : nameChecks.some((c) => c.status === 'MISMATCH') ? 'Mismatch requiring review' : nameChecks.every((c) => c.status === 'MATCH') ? 'Strong match across available sources' : 'Consistent (minor formatting differences)';
  lines.push({ key: 'identity', label: 'Identity', value: idState, tone: idState.startsWith('Strong') ? 'good' : idState.startsWith('Mismatch') ? 'bad' : idState.startsWith('Not') ? 'muted' : 'neutral', assertion: 'DERIVED', evidence: nameChecks.map((c) => ({ label: c.label, sourceKey: c.leftSource, value: c.status })) });

  const current = p.employment.records.find((r) => r.status === 'CURRENT');
  lines.push({ key: 'employment', label: 'Employment', value: current ? 'Currently employed' : p.employment.records.length ? 'No current EPFO employment' : 'Not available', tone: current ? 'good' : p.employment.records.length ? 'warn' : 'muted', assertion: 'VERIFIED_FACT', evidence: current ? [{ label: 'Status', sourceKey: 'UAN', path: current.provenance.evidencePath, value: 'CURRENT' }] : [] });
  if (current) {
    lines.push({ key: 'employer', label: 'Employer', value: current.employer.name, tone: 'neutral', assertion: 'VERIFIED_FACT', evidence: [{ label: 'Employer', sourceKey: 'UAN', path: current.provenance.evidencePath, value: current.employer.name }] });
    lines.push({ key: 'since', label: 'Employment since', value: formatDate(current.joiningDate, { month: 'long', year: 'numeric' }), tone: 'neutral', assertion: 'VERIFIED_FACT', evidence: [{ label: 'Joining date', sourceKey: 'UAN', path: current.provenance.evidencePath, value: current.joiningDate }] });
  }
  const inc = p.person.income.value;
  lines.push({ key: 'income', label: 'Income', value: inc?.amount ? formatINR(inc.amount) : 'Not available', tone: inc?.amount ? 'neutral' : 'muted', assertion: p.person.income.provenance.assertion, evidence: inc?.amount ? [{ label: 'Income', sourceKey: p.person.income.provenance.sourceKey, path: p.person.income.provenance.evidencePath, value: String(inc.amount) }] : [] });
  lines.push({ key: 'credit', label: 'Credit score', value: p.credit?.score !== null && p.credit?.score !== undefined ? String(p.credit.score) : 'Not available', tone: p.credit?.score ? (p.credit.score >= 750 ? 'good' : p.credit.score >= 650 ? 'neutral' : 'warn') : 'muted', assertion: 'VERIFIED_FACT', evidence: p.credit ? [{ label: 'Score', sourceKey: 'CREDIT', path: p.credit.provenance.evidencePath, value: String(p.credit.score) }] : [] });
  lines.push({ key: 'banking', label: 'Banking', value: p.bankAccounts.length ? 'Account information available' : 'Not available', tone: p.bankAccounts.length ? 'neutral' : 'muted', assertion: 'VERIFIED_FACT', evidence: p.bankAccounts.map((b) => ({ label: 'Bank', sourceKey: b.provenance.sourceKey, path: b.provenance.evidencePath, value: b.bankName })) });
  const pan = p.identityDocuments.find((d) => d.docType === 'PAN');
  lines.push({ key: 'pan_aadhaar', label: 'PAN - Aadhaar', value: pan?.aadhaarLinked === true ? 'Linked' : pan?.aadhaarLinked === false ? 'Not linked' : 'Not available', tone: pan?.aadhaarLinked === true ? 'good' : pan?.aadhaarLinked === false ? 'warn' : 'muted', assertion: 'VERIFIED_FACT', evidence: pan ? [{ label: 'aadhaar_linked', sourceKey: 'PAN', path: pan.provenance.evidencePath, value: String(pan.aadhaarLinked) }] : [] });
  const epfo = p.employment.epfo;
  lines.push({ key: 'uan_aadhaar', label: 'UAN - Aadhaar', value: epfo?.aadhaarLinked === true ? 'Linked' : epfo?.aadhaarLinked === false ? 'Not linked' : 'Not available', tone: epfo?.aadhaarLinked === true ? 'good' : epfo?.aadhaarLinked === false ? 'warn' : 'muted', assertion: 'VERIFIED_FACT', evidence: epfo ? [{ label: 'aadhaar_linked', sourceKey: 'UAN', path: epfo.provenance.evidencePath, value: String(epfo.aadhaarLinked) }] : [] });
  const m = p.mobile;
  lines.push({ key: 'mobile', label: 'Mobile', value: m ? `${m.isValid === true ? 'Valid' : m.isValid === false ? 'Invalid' : 'Validity unknown'} / ${m.subscriberStatus ?? 'status unknown'}` : 'Not available', tone: m?.isValid === true ? 'good' : m?.isValid === false ? 'bad' : 'muted', assertion: 'VERIFIED_FACT', evidence: m ? [{ label: 'Mobile', sourceKey: 'MOBILE', path: m.provenance.evidencePath, value: m.subscriberStatus }] : [] });
  const live = signals.filter((s) => !['DISMISSED', 'RESOLVED'].includes(s.status));
  const review = live.filter((s) => s.requiresReview);
  const sev = maxSeverity(live);
  lines.push({ key: 'risk', label: 'Risk signal', value: !live.length ? 'No open signals' : `${sev === 'INFO' ? 'Informational' : sev.charAt(0) + sev.slice(1).toLowerCase() + '-risk'} alert${review.length ? ' requiring review' : ''} (${live.length})`, tone: sev === 'NONE' || sev === 'INFO' ? 'good' : sev === 'LOW' ? 'neutral' : sev === 'MEDIUM' ? 'warn' : 'bad', assertion: 'DERIVED', evidence: live.slice(0, 6).map((s) => ({ label: s.title, sourceKey: s.sourceKey, value: s.severity })) });
  lines.push({ key: 'confidence', label: 'Overall data confidence', value: confidence.charAt(0) + confidence.slice(1).toLowerCase(), tone: confidence === 'HIGH' ? 'good' : confidence === 'MEDIUM' ? 'neutral' : 'warn', assertion: 'DERIVED', evidence: quality.map((q) => ({ label: q.label, sourceKey: q.sourceKey, value: q.available ? q.freshness : 'not available' })) });
  return lines;
}
