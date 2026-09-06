/**
 * Simple in-memory sliding-window rate limiter for API routes.
 * Suitable for a single Node instance; swap for Redis/Upstash when scaling horizontally.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return { ok: false, remaining: 0, retryAfterMs: windowMs - (now - arr[0]) };
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return { ok: true, remaining: limit - arr.length, retryAfterMs: 0 };
}
