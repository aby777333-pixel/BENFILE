/**
 * LandLens (Verified.RealEstate) client - catalogue 9.10, 9.14, 9.15.
 *
 * Tamil Nadu land intelligence: guideline value, road width, survey-to-location,
 * planning approvals. Every tool is POST /api/v1/tools/{name} with a bearer key
 * and a common envelope { ok, status, data, credits_charged, balance_after, request_id }.
 * Rate limit per credential: 60 / minute, 3 000 / day.
 */
import { asNumber, asRecord, asString, httpRequest, setRateLimit } from './http';

const BASE_URL = 'https://verified.realestate';
setRateLimit('landlens', 50);

export interface LandLensOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export interface LandLensResult<T = Record<string, unknown>> {
  ok: boolean;
  data: T;
  creditsCharged: number | null;
  balanceAfter: number | null;
  requestId: string | null;
}

export type LandLensTool = 'guideline_value' | 'guideline_history' | 'road_width' | 'survey_to_location' | 'ppa_approval' | 'approval_search' | 'zone_check' | 'water_body' | 'rera_project' | 'locality_value_context';

export async function callTool(o: LandLensOptions, tool: LandLensTool, input: Record<string, unknown>): Promise<LandLensResult> {
  const res = await httpRequest(`${(o.baseUrl ?? BASE_URL).replace(/\/$/, '')}/api/v1/tools/${tool}`, {
    provider: 'landlens',
    headers: { authorization: `Bearer ${o.apiKey}` },
    body: Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null && v !== undefined && v !== '')),
    fetchImpl: o.fetchImpl,
    timeoutMs: 20_000,
  });
  const env = asRecord(res.data);
  return { ok: env.ok !== false, data: asRecord(env.data), creditsCharged: asNumber(env.credits_charged), balanceAfter: asNumber(env.balance_after), requestId: asString(env.request_id) };
}

export interface GuidelineInput {
  lat?: number | null;
  lng?: number | null;
  surveyNumber?: string | null;
  subDivision?: string | null;
  villageName?: string | null;
  districtName?: string | null;
  roadName?: string | null;
  ruralUrban?: 'rural' | 'urban' | null;
}

export interface GuidelineValue {
  /** INR per square foot, derived when the response exposes any recognised unit. */
  perSqft: number | null;
  /** Unit the provider reported, e.g. "sqft", "sqm", "cent", "acre". */
  reportedUnit: string | null;
  reportedValue: number | null;
  classification: string | null;
  village: string | null;
  sro: string | null;
  effectiveFrom: string | null;
  raw: Record<string, unknown>;
  requestId: string | null;
}

const SQFT_PER = { sqft: 1, sqm: 10.7639, cent: 435.6, ground: 2400, acre: 43_560, hectare: 107_639 } as const;

/** Find a rate in the response and normalise it to INR per sq ft. The spec does not fix the field names, so this is deliberately tolerant. */
export function extractPerSqft(data: Record<string, unknown>): { perSqft: number | null; unit: string | null; value: number | null } {
  const stack: Array<Record<string, unknown>> = [data];
  const seen = new Set<unknown>();
  while (stack.length) {
    const o = stack.shift()!;
    if (seen.has(o)) continue;
    seen.add(o);
    for (const [k, v] of Object.entries(o)) {
      const key = k.toLowerCase();
      const n = asNumber(v);
      if (n !== null && n > 0 && /(guideline|rate|value|price)/.test(key)) {
        for (const [unit, f] of Object.entries(SQFT_PER)) {
          if (key.includes(unit) || (unit === 'sqft' && /sq_?ft|sqft|square_?feet/.test(key)) || (unit === 'sqm' && /sq_?m\b|sqm|square_?met/.test(key))) {
            return { perSqft: Math.round((n / f) * 100) / 100, unit, value: n };
          }
        }
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) stack.push(v as Record<string, unknown>);
      if (Array.isArray(v)) for (const item of v) if (item && typeof item === 'object') stack.push(item as Record<string, unknown>);
    }
  }
  // Second pass: explicit unit field next to a value field.
  const unit = asString(data.unit ?? data.rate_unit ?? data.per)?.toLowerCase() ?? null;
  const value = asNumber(data.guideline_value ?? data.value ?? data.rate);
  if (unit && value !== null) {
    const f = Object.entries(SQFT_PER).find(([u]) => unit.includes(u))?.[1];
    if (f) return { perSqft: Math.round((value / f) * 100) / 100, unit, value };
  }
  return { perSqft: null, unit, value };
}

export async function fetchGuidelineValue(o: LandLensOptions, input: GuidelineInput): Promise<GuidelineValue> {
  const r = await callTool(o, 'guideline_value', { lat: input.lat, lng: input.lng, survey_number: input.surveyNumber, sub_division: input.subDivision, village_name: input.villageName, district_name: input.districtName, road_name: input.roadName, rural_urban: input.ruralUrban });
  const ex = extractPerSqft(r.data);
  return {
    perSqft: ex.perSqft,
    reportedUnit: ex.unit,
    reportedValue: ex.value,
    classification: asString(r.data.igr_classification ?? r.data.classification),
    village: asString(r.data.village ?? r.data.village_name),
    sro: asString(r.data.sro),
    effectiveFrom: asString(r.data.effective_from ?? r.data.effectiveFrom ?? r.data.as_of),
    raw: r.data,
    requestId: r.requestId,
  };
}

export interface RoadWidthResult {
  roads: Array<{ name: string | null; widthStartM: number | null; widthEndM: number | null; frontageM: number | null }>;
  recorded: boolean;
  raw: Record<string, unknown>;
  requestId: string | null;
}

export async function fetchRoadWidth(o: LandLensOptions, input: { lat: number; lng: number; surveyNumber?: string | null; subDivision?: string | null; villageCode?: string | null }): Promise<RoadWidthResult> {
  const r = await callTool(o, 'road_width', { lat: input.lat, lng: input.lng, survey_number: input.surveyNumber, sub_division: input.subDivision, village_code: input.villageCode });
  const list = [r.data.roads, r.data.results, r.data.streets].find(Array.isArray) as unknown[] | undefined;
  const roads = (list ?? []).map((x) => asRecord(x)).map((x) => ({ name: asString(x.name ?? x.road_name ?? x.street), widthStartM: asNumber(x.width_start_m ?? x.start_width_m ?? x.width_start), widthEndM: asNumber(x.width_end_m ?? x.end_width_m ?? x.width_end), frontageM: asNumber(x.frontage_m ?? x.frontage) }));
  return { roads, recorded: roads.length > 0, raw: r.data, requestId: r.requestId };
}

export function landLensFromEnv(env: Record<string, string | undefined> = process.env): LandLensOptions | null {
  const apiKey = env.LANDLENS_API_KEY?.trim();
  return apiKey ? { apiKey, baseUrl: env.LANDLENS_BASE_URL } : null;
}
