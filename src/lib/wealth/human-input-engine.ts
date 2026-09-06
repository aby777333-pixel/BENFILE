/**
 * Human input analysis: turns opinions, hearsay and client statements into verifiable claims,
 * verification plans and follow-up questions. Never into facts or scores.
 */
import type { CanonicalProfile } from '@/lib/canonical/types';
import { buildSubject, runExternalSearch, type ResolvedFinding } from '@/lib/external/orchestrator';
import { compareNames } from '@/lib/engines/normalize';

export type ClaimKind = 'COMPANY_OWNERSHIP' | 'DIRECTORSHIP' | 'PROPERTY_OWNERSHIP' | 'LAND_HOLDING' | 'BUSINESS_SALE' | 'LIQUIDITY_EVENT' | 'INHERITANCE' | 'EMPLOYMENT' | 'LOAN' | 'INVESTMENT' | 'LEGAL_MATTER' | 'PREFERENCE' | 'OTHER';

export interface ExtractedClaim {
  kind: ClaimKind;
  statement: string;
  entities: string[];
  verifiable: boolean;
  verificationPlan: string[];
  followUpQuestions: string[];
  cautions: string[];
}

const RULES: Array<{ kind: ClaimKind; re: RegExp; plan: string[]; questions: string[]; cautions: string[] }> = [
  { kind: 'DIRECTORSHIP', re: /\b(director|designated partner|board)\b/i, plan: ['Search MCA director master data by name and DIN', 'Compare company registered office with client addresses'], questions: ['Do you currently hold any directorships or partnerships?'], cautions: ['Name collisions are common; require DIN or corroborating attributes'] },
  { kind: 'COMPANY_OWNERSHIP', re: /\b(owns?|owner of|promoter|founder|shareholder|his company|her company|their company)\b/i, plan: ['Search MCA company master data and shareholding where public', 'Check GST registration against PAN'], questions: ['Which business entities do you own or hold shares in?'], cautions: ['Proprietorships are not registry-visible; absence of a record is not contradiction'] },
  { kind: 'LAND_HOLDING', re: /\b(acres?|cents?|ground|land|plots?|survey)\b/i, plan: ['Request sale deed / patta / EC for the stated survey numbers', 'Check RERA allottee lists where the project is named'], questions: ['Could you share the survey numbers or documents for the land?'], cautions: ['Never add to the asset register until a document or official record is on file'] },
  { kind: 'PROPERTY_OWNERSHIP', re: /\b(flat|villa|apartment|house|bungalow|property|properties)\b/i, plan: ['Request sale deed and EC', 'Check property-tax receipt in the client name'], questions: ['Which properties do you own, and are any jointly held or mortgaged?'], cautions: ['Photographs or visits do not establish ownership'] },
  { kind: 'BUSINESS_SALE', re: /\b(sold (his|her|their|the) (company|business|stake)|exit(ed)?|buy-?out)\b/i, plan: ['Check MCA for cessation / transfer of shareholding', 'Look for public announcements from established media'], questions: ['Have you recently sold a business or stake, and how are the proceeds currently held?'], cautions: ['Do not assume proceeds remain liquid'] },
  { kind: 'LIQUIDITY_EVENT', re: /\b(cash|liquid|proceeds|windfall|bonus|received .*(crore|lakh))\b/i, plan: ['Ask the client directly; request bank statement if relevant to a transaction'], questions: ['Do you already have plans for these funds?'], cautions: ['Never assume availability for investment'] },
  { kind: 'INHERITANCE', re: /\b(inherit|ancestral|father'?s|mother'?s|family property|will|probate|succession)\b/i, plan: ['Request succession certificate / probate / partition deed', 'Record as family-linked until entitlement evidence exists'], questions: ['Is there inherited property or a pending succession you would like recorded?'], cautions: ['A relative\'s wealth is not the client\'s wealth'] },
  { kind: 'LOAN', re: /\b(loan|mortgage|emi|borrow|debt|default)\b/i, plan: ['Compare with bureau report and liability register'], questions: ['Are there loans or guarantees we should be aware of?'], cautions: ['Bureau is authoritative; hearsay is not'] },
  { kind: 'INVESTMENT', re: /\b(mutual fund|sip|stocks?|shares?|portfolio|pms|aif|invest)\b/i, plan: ['Request statements or account-aggregator consent'], questions: ['Would you be willing to share statements or connect accounts?'], cautions: [] },
  { kind: 'LEGAL_MATTER', re: /\b(court|case|litigation|dispute|fir|arrest|police|nclt|insolven)\b/i, plan: ['Search public court records with role and identity confidence', 'Label as pending review; never as wrongdoing'], questions: [], cautions: ['Presence in litigation is not evidence of wrongdoing'] },
  { kind: 'EMPLOYMENT', re: /\b(works? (at|for)|employed|job|salary|resign|quit)\b/i, plan: ['Compare with EPFO record; re-verify if stale'], questions: ['Has your employment changed since our last verification?'], cautions: [] },
  { kind: 'PREFERENCE', re: /\b(prefers?|likes?|dislikes?|wants?|reluctant|interested|keen|not keen)\b/i, plan: ['Convert into an explicit client question; record the answer as client-declared'], questions: ['(Ask the client directly and record their answer)'], cautions: ['Does not affect suitability until the client declares it'] },
];

export function extractClaims(text: string): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  const entities = [...new Set((text.match(/\b([A-Z][A-Za-z&.]+(?:\s+[A-Z][A-Za-z&.]+){0,4}\s+(?:Pvt\.?\s*Ltd|Private Limited|Ltd|LLP|Limited|Technologies|Ventures|Industries|Enterprises|Corp|Inc))\b/g) ?? []).map((s) => s.trim()))];
  for (const r of RULES) if (r.re.test(text)) out.push({ kind: r.kind, statement: text.length > 200 ? `${text.slice(0, 197)}...` : text, entities, verifiable: r.kind !== 'PREFERENCE' && r.kind !== 'OTHER', verificationPlan: r.plan, followUpQuestions: r.questions, cautions: r.cautions });
  if (!out.length) out.push({ kind: 'OTHER', statement: text, entities, verifiable: false, verificationPlan: ['No automated verification path; treat as context only'], followUpQuestions: [], cautions: [] });
  return out;
}

export interface ClaimVerification {
  status: 'VERIFIED' | 'NOT_VERIFIED' | 'POSSIBLE_MATCH' | 'CONTRADICTED';
  summary: string;
  findings: Array<{ title: string; source: string; matchStatus: string; matchScore: number; url: string | null; recordId: string }>;
  checkedConnectors: string[];
}

/** Verifies corporate/legal claims through the (consented) external connectors. Other claims return NOT_VERIFIED with a plan. */
export async function verifyClaim(claim: ExtractedClaim, profile: CanonicalProfile, consentSources: string[], extra: { emailHashes?: string[]; phoneHashes?: string[] } = {}): Promise<ClaimVerification> {
  const corporate = ['COMPANY_OWNERSHIP', 'DIRECTORSHIP', 'BUSINESS_SALE'].includes(claim.kind);
  const legal = claim.kind === 'LEGAL_MATTER';
  if (!corporate && !legal) return { status: 'NOT_VERIFIED', summary: `No automated source can confirm a ${claim.kind.replace(/_/g, ' ').toLowerCase()} claim. Follow the verification plan: ${claim.verificationPlan.join('; ')}.`, findings: [], checkedConnectors: [] };
  const subject = buildSubject(profile, extra);
  const keys = corporate ? ['mca-sandbox', 'gst-sandbox'] : ['courts-sandbox'];
  const r = await runExternalSearch(subject, { purpose: 'Verify human-entered claim', consentSources, connectorKeys: keys });
  const relevant = r.findings.filter((f: ResolvedFinding) => (corporate ? ['CORPORATE_RECORD', 'DIRECTORSHIP'].includes(f.resultType) : f.resultType === 'LEGAL_RECORD'));
  const findings = relevant.map((f) => ({ title: f.title, source: f.sourceName, matchStatus: f.match.status, matchScore: f.match.score, url: f.url, recordId: f.recordId }));
  if (!r.connectorsRun.length) return { status: 'NOT_VERIFIED', summary: `Consent does not authorise the connectors needed (${keys.join(', ')}).`, findings: [], checkedConnectors: [] };
  const entityHit = relevant.find((f) => claim.entities.some((e) => compareNames(e, f.title).status !== 'MISMATCH' || String(f.data.company ?? f.data.companyName ?? '').toUpperCase().includes(e.toUpperCase().split(' ')[0])));
  const confirmed = relevant.find((f) => f.match.status === 'CONFIRMED');
  const possible = relevant.find((f) => ['HIGH_CONFIDENCE', 'POSSIBLE_MATCH'].includes(f.match.status));
  if (entityHit && (entityHit.match.status === 'CONFIRMED' || entityHit.match.status === 'HIGH_CONFIDENCE')) return { status: 'VERIFIED', summary: `Official record supports the claim: ${entityHit.title} (${entityHit.match.status.replace(/_/g, ' ').toLowerCase()}, ${entityHit.match.score}%).`, findings, checkedConnectors: r.connectorsRun };
  if (claim.entities.length && relevant.length && !entityHit && confirmed) return { status: 'CONTRADICTED', summary: `Registry records for this client show ${confirmed.title}, not ${claim.entities.join(' / ')}. The claim may concern a different person or an unregistered entity.`, findings, checkedConnectors: r.connectorsRun };
  if (possible) return { status: 'POSSIBLE_MATCH', summary: `A similar record exists (${possible.title}, ${possible.match.score}%) but identity cannot be confirmed without DIN/PAN corroboration.`, findings, checkedConnectors: r.connectorsRun };
  return { status: 'NOT_VERIFIED', summary: 'No reliable supporting record found in the authorised sources. Absence of a record is not contradiction for unregistered businesses.', findings, checkedConnectors: r.connectorsRun };
}
