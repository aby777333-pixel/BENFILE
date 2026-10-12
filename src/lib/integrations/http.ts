/**
 * Hardened HTTP client for licensed third-party APIs.
 *
 * - Timeout + bounded retries with exponential backoff (429 / 5xx / network only).
 * - Per-provider token-bucket rate limiting so BENFILE never exceeds a licence.
 * - Secrets are never logged; error messages are scrubbed of header values.
 * - Response bodies are parsed as JSON and returned as `unknown` - connectors
 *   validate what they need and never trust provider shapes blindly.
 * - `fetch` is injectable so connectors are unit-testable without the network.
 */
import { log } from '@/lib/security/logger';

export interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  /** Milliseconds before the request is aborted. Default 12 000. */
  timeoutMs?: number;
  /** Retries after the first attempt. Default 2. */
  retries?: number;
  /** Logical provider key for rate limiting and logs. */
  provider: string;
  fetchImpl?: typeof fetch;
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
  headers: Headers;
  attempts: number;
  durationMs: number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly provider: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/* ---------------- Rate limiting ---------------- */

interface Bucket {
  tokens: number;
  updatedAt: number;
  perMinute: number;
}
const buckets = new Map<string, Bucket>();
const limits = new Map<string, number>();

/** Declare a provider's limit (calls per minute). Connectors call this once at module load. */
export function setRateLimit(provider: string, perMinute: number) {
  limits.set(provider, perMinute);
}

function take(provider: string, now: number): number {
  const perMinute = limits.get(provider) ?? 60;
  let b = buckets.get(provider);
  if (!b) {
    b = { tokens: perMinute, updatedAt: now, perMinute };
    buckets.set(provider, b);
  }
  const refill = ((now - b.updatedAt) / 60_000) * perMinute;
  b.tokens = Math.min(perMinute, b.tokens + refill);
  b.updatedAt = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return 0;
  }
  return Math.ceil(((1 - b.tokens) / perMinute) * 60_000);
}

/** Test hook. */
export function resetRateLimits() {
  buckets.clear();
}

/* ---------------- Secrets hygiene ---------------- */

const SECRET_HEADER_RE = /^(authorization|x-api-key|x-subscription-token|x-client-secret|service-key|authkey|api-key)$/i;

function scrub(text: string, headers: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(headers)) {
    if (SECRET_HEADER_RE.test(k) && v.length > 6) out = out.split(v).join('[redacted]');
  }
  return out.length > 400 ? `${out.slice(0, 400)}...` : out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildUrl(url: string, query?: HttpOptions['query']): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined || v === '') continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/**
 * Perform a request. Throws HttpError for non-2xx after retries are exhausted,
 * or a plain Error for timeouts / network failures.
 */
export async function httpRequest<T = unknown>(url: string, opts: HttpOptions): Promise<HttpResponse<T>> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available in this runtime');
  const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const body = opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  if (body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
  const target = buildUrl(url, opts.query);
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const maxAttempts = (opts.retries ?? 2) + 1;
  const started = Date.now();
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const wait = take(opts.provider, Date.now());
    if (wait > 0) {
      if (wait > timeoutMs) throw new HttpError(`Rate limit for ${opts.provider} exhausted; retry in ${Math.ceil(wait / 1000)} s`, 429, opts.provider);
      await sleep(wait);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(target, { method, headers, body, signal: ctrl.signal });
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (res.ok) {
        log.debug('integration.call', { provider: opts.provider, status: res.status, attempt, ms: Date.now() - started });
        return { status: res.status, data: data as T, headers: res.headers, attempts: attempt, durationMs: Date.now() - started };
      }
      const retryable = res.status === 429 || res.status >= 500;
      const err = new HttpError(`${opts.provider} responded ${res.status}: ${scrub(typeof data === 'string' ? data : JSON.stringify(data ?? ''), headers)}`, res.status, opts.provider, data);
      if (!retryable || attempt === maxAttempts) {
        log.warn('integration.failed', { provider: opts.provider, status: res.status, attempt });
        throw err;
      }
      lastErr = err;
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 300 * 2 ** (attempt - 1));
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const aborted = (e as Error).name === 'AbortError';
      lastErr = new Error(aborted ? `${opts.provider} timed out after ${timeoutMs} ms` : `${opts.provider} network error: ${scrub((e as Error).message, headers)}`);
      if (attempt === maxAttempts) {
        log.warn('integration.failed', { provider: opts.provider, attempt, reason: aborted ? 'timeout' : 'network' });
        throw lastErr;
      }
      await sleep(300 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error(`${opts.provider}: request failed`);
}

/* ---------------- Small parsing helpers shared by connectors ---------------- */

export const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
export const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
/** First non-empty string among several candidate keys. */
export const pick = (o: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const k of keys) {
    const s = asString(o[k]);
    if (s) return s;
  }
  return null;
};
