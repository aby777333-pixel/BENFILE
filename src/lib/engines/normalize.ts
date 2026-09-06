/** Normalisation + similarity helpers shared by the engines. */

const HONORIFICS = new Set(['MR', 'MRS', 'MS', 'DR', 'SHRI', 'SMT', 'KUMARI', 'SRI', 'MISS', 'MASTER']);

export function normalizeName(v: string | null | undefined): string {
  if (!v) return '';
  return v
    .toUpperCase()
    .replace(/[.,'"\-_/()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !HONORIFICS.has(t))
    .join(' ');
}

export function nameTokens(v: string | null | undefined): string[] {
  return normalizeName(v).split(' ').filter(Boolean);
}

/** Levenshtein-based similarity 0..1. */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

export type NameMatch = { status: 'MATCH' | 'PARTIAL_MATCH' | 'MISMATCH' | 'NOT_AVAILABLE'; score: number | null; explanation: string };

/**
 * Person-name comparison tolerant of initials, missing middle names and ordering.
 *   "ROHAN KUMAR MEHTA" vs "Rohan K Mehta"   -> PARTIAL_MATCH (initial for middle name)
 *   "ROHAN KUMAR MEHTA" vs "rohan kumar mehta" -> MATCH
 *   "ROHAN MEHTA" vs "PRIYA NAIR"            -> MISMATCH
 */
export function compareNames(a: string | null | undefined, b: string | null | undefined): NameMatch {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return { status: 'NOT_AVAILABLE', score: null, explanation: 'One or both names are not available.' };
  if (ta.join(' ') === tb.join(' ')) return { status: 'MATCH', score: 1, explanation: 'Exact match after normalising case, whitespace and punctuation.' };

  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  let matched = 0;
  let initials = 0;
  const used = new Set<number>();
  for (const t of short) {
    let found = -1;
    for (let i = 0; i < long.length; i++) {
      if (used.has(i)) continue;
      const l = long[i];
      if (l === t || stringSimilarity(l, t) >= 0.85) {
        found = i;
        break;
      }
      if ((t.length === 1 && l.startsWith(t)) || (l.length === 1 && t.startsWith(l))) {
        found = i;
        initials++;
        break;
      }
    }
    if (found >= 0) {
      used.add(found);
      matched++;
    }
  }
  const first = ta[0] === tb[0] || stringSimilarity(ta[0], tb[0]) >= 0.85;
  const last = ta[ta.length - 1] === tb[tb.length - 1] || stringSimilarity(ta[ta.length - 1], tb[tb.length - 1]) >= 0.85;
  const score = Math.round(((matched / long.length) * 0.6 + (first ? 0.2 : 0) + (last ? 0.2 : 0)) * 100) / 100;

  if (matched === long.length && initials === 0) return { status: 'MATCH', score: 1, explanation: 'All name tokens match (order-insensitive).' };
  if (first && last && (matched >= short.length || initials > 0))
    return { status: 'PARTIAL_MATCH', score, explanation: initials > 0 ? 'First and last name match; a middle name appears as an initial or is omitted on one record.' : 'First and last name match; middle-name tokens differ or are missing on one record.' };
  if (first && last) return { status: 'PARTIAL_MATCH', score, explanation: 'First and last name match; other tokens differ.' };
  if (score >= 0.5) return { status: 'PARTIAL_MATCH', score, explanation: 'Some name tokens match; formatting or ordering differs. Not treated as fraud.' };
  return { status: 'MISMATCH', score, explanation: 'Names do not share first and last name tokens.' };
}

const CITY_ALIASES: Record<string, string> = {
  BANGALORE: 'BENGALURU',
  BOMBAY: 'MUMBAI',
  MADRAS: 'CHENNAI',
  CALCUTTA: 'KOLKATA',
  POONA: 'PUNE',
  GURGAON: 'GURUGRAM',
  TRIVANDRUM: 'THIRUVANANTHAPURAM',
  COCHIN: 'KOCHI',
  BARODA: 'VADODARA',
  MYSORE: 'MYSURU',
};

export function normalizeCity(v: string | null | undefined): string {
  const n = normalizeName(v);
  return CITY_ALIASES[n] ?? n;
}

export function normalizeState(v: string | null | undefined): string {
  return normalizeName(v);
}

export function normalizeCountry(v: string | null | undefined): string {
  const n = normalizeName(v);
  if (['IN', 'IND', 'INDIA', 'BHARAT'].includes(n)) return 'INDIA';
  return n;
}

export function normalizePin(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

export function normalizeAddress(v: string | null | undefined): string {
  return (v ?? '')
    .toUpperCase()
    .replace(/[#,.\-/()]/g, ' ')
    .replace(/\b(FLAT|APT|APARTMENT|NO|NUMBER|HOUSE|H\s?NO|PLOT|ROAD|RD|STREET|ST|CROSS|MAIN|BLOCK|SECTOR|SEC|NEAR|OPP|OPPOSITE|LAYOUT|NAGAR|COLONY)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function daysBetween(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

export function monthsBetween(startIso: string | null | undefined, endIso?: string | null, now = new Date()): number | null {
  if (!startIso) return null;
  const s = new Date(startIso);
  if (Number.isNaN(s.getTime())) return null;
  const e = endIso ? new Date(endIso) : now;
  if (Number.isNaN(e.getTime())) return null;
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
}

export function formatTenure(months: number | null): string {
  if (months === null) return 'Not available';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  return m ? `${y} yr ${m} mo` : `${y} yr`;
}

export function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return 'Not available';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }): string {
  if (!iso) return 'Not available';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', opts).format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  return formatDate(iso, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
