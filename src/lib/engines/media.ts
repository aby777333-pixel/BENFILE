/**
 * News & adverse-media classification.
 * Negative language is never auto-classified as wrongdoing; findings are
 * "Potential Adverse Media - Human Review Required" unless a Tier 1-3 source
 * states an authoritative outcome.
 */
export type MediaCategory =
  | 'BUSINESS'
  | 'CORPORATE'
  | 'FINANCIAL'
  | 'PROFESSIONAL'
  | 'LEGAL'
  | 'REGULATORY'
  | 'AWARDS'
  | 'INTERVIEWS'
  | 'PUBLICATIONS'
  | 'NEUTRAL'
  | 'POTENTIAL_ADVERSE';

export type AdverseTopic =
  | 'FRAUD_ALLEGATION'
  | 'INSOLVENCY'
  | 'BANKRUPTCY'
  | 'REGULATORY_ACTION'
  | 'FINANCIAL_MISCONDUCT'
  | 'CORPORATE_DISPUTE'
  | 'MAJOR_LITIGATION'
  | 'SANCTIONS'
  | 'ENFORCEMENT_ACTION'
  | 'DIRECTOR_DISQUALIFICATION';

const ADVERSE_PATTERNS: Array<[AdverseTopic, RegExp]> = [
  ['FRAUD_ALLEGATION', /\b(fraud|scam|cheat(?:ing|ed)?|forg(?:ery|ed)|embezzl|misappropriat|ponzi)\b/i],
  ['INSOLVENCY', /\b(insolven|ibc|nclt|resolution professional|corporate insolvency)\b/i],
  ['BANKRUPTCY', /\b(bankrupt|liquidat)\b/i],
  ['REGULATORY_ACTION', /\b(sebi|rbi|irdai|pfrda|show[- ]cause|penalt|debarred|barred|order against)\b/i],
  ['FINANCIAL_MISCONDUCT', /\b(money laundering|pmla|hawala|tax evasion|benami|round[- ]tripping)\b/i],
  ['CORPORATE_DISPUTE', /\b(dispute|oppression|mismanagement|arbitration|shareholder (?:fight|battle))\b/i],
  ['MAJOR_LITIGATION', /\b(lawsuit|sued|litigation|petition|high court|supreme court|writ)\b/i],
  ['SANCTIONS', /\b(sanction(?:ed|s)?|ofac|watchlist|un list)\b/i],
  ['ENFORCEMENT_ACTION', /\b(enforcement directorate|\bed\b raid|cbi|arrest(?:ed)?|charge[- ]?sheet|fir\b|raid(?:ed)?)\b/i],
  ['DIRECTOR_DISQUALIFICATION', /\b(disqualified director|director disqualification|struck[- ]off)\b/i],
];

const CATEGORY_PATTERNS: Array<[MediaCategory, RegExp]> = [
  ['AWARDS', /\b(award|honou?red|recogni[sz]ed|felicitat|winner|top \d+)\b/i],
  ['INTERVIEWS', /\b(interview|in conversation|speaks to|q&a|fireside)\b/i],
  ['PUBLICATIONS', /\b(paper|journal|published|whitepaper|author(?:ed)?|book)\b/i],
  ['REGULATORY', /\b(sebi|rbi|irdai|regulator|compliance|circular)\b/i],
  ['LEGAL', /\b(court|tribunal|petition|judg(?:e)?ment|order|verdict)\b/i],
  ['FINANCIAL', /\b(funding|raised|valuation|revenue|profit|ipo|investor|series [a-d])\b/i],
  ['CORPORATE', /\b(appointed|resign|board|director|merger|acquisition|acquire|incorporat)\b/i],
  ['PROFESSIONAL', /\b(joins|promot|hired|appoint|ceo|cto|cfo|head of|vp)\b/i],
  ['BUSINESS', /\b(launch\w*|expan\w*|partner\w*|contract\w*|deal|client\w*|market\w*|campus|jobs|hiring)\b/i],
];

export interface MediaClassification {
  category: MediaCategory;
  adverseTopics: AdverseTopic[];
  /** Always true for adverse items unless an authoritative source states an outcome. */
  humanReviewRequired: boolean;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
  label: string;
}

export function classifyMedia(text: string, sourceTier: number): MediaClassification {
  const adverseTopics = ADVERSE_PATTERNS.filter(([, re]) => re.test(text)).map(([t]) => t);
  if (adverseTopics.length) {
    const authoritative = sourceTier <= 3 && /\b(convicted|found guilty|order(?:ed)? (?:to|against)|penalty imposed|debarred|disqualified)\b/i.test(text);
    const severe = adverseTopics.some((t) => ['SANCTIONS', 'ENFORCEMENT_ACTION', 'FRAUD_ALLEGATION', 'DIRECTOR_DISQUALIFICATION'].includes(t));
    return {
      category: 'POTENTIAL_ADVERSE',
      adverseTopics,
      humanReviewRequired: true,
      severity: authoritative ? (severe ? 'HIGH' : 'MEDIUM') : severe ? 'MEDIUM' : 'LOW',
      label: authoritative ? 'Adverse media (authoritative source) - Human review required' : 'Potential adverse media - Human review required',
    };
  }
  const cat = CATEGORY_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? 'NEUTRAL';
  return { category: cat, adverseTopics: [], humanReviewRequired: false, severity: 'INFO', label: cat === 'NEUTRAL' ? 'Neutral media coverage' : cat.charAt(0) + cat.slice(1).toLowerCase() };
}
