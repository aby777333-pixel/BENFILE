import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ingestVerification } from '@/lib/db/ingest';
import { getStaff } from '@/lib/db/server';
import { hasPermission } from '@/lib/security/permissions';
import { rateLimit } from '@/lib/security/rate-limit';
import { log } from '@/lib/security/logger';

const Body = z.object({
  raw: z.unknown().refine((v) => v !== undefined && v !== null, 'raw payload is required'),
  providerKey: z.string().optional(),
  clientId: z.string().uuid().optional().nullable(),
  snapshotLabel: z.string().max(120).optional().nullable(),
  consent: z
    .object({ purpose: z.string().min(3).max(300), purposeCode: z.string().max(60).optional(), reference: z.string().max(120).optional().nullable(), expiresAt: z.string().optional().nullable(), sources: z.array(z.string()).optional() })
    .optional(),
});

/**
 * POST /api/ingest - accepts a provider response and creates a new verification run.
 * Auth: signed-in staff with verification:ingest.
 * Machine ingest (webhooks) can use Authorization: Bearer <BENFILE_INGEST_API_KEY> AND must specify an existing clientId
 * (machine ingests run under the service role; disabled until SUPABASE_SERVICE_ROLE_KEY is configured).
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'local';
  const rl = rateLimit(`ingest:${ip}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });

  const { db, staff } = await getStaff();
  if (!staff) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!hasPermission(staff.role, 'verification:ingest')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const result = await ingestVerification(db, { ...parsed.data, raw: parsed.data.raw as unknown, actorId: staff.userId });
    return NextResponse.json({ clientId: result.clientId, clientCode: result.clientCode, runId: result.runId, runSeq: result.runSeq, status: result.assessment.overall.profileStatus, riskLevel: result.assessment.overall.riskLevel, warnings: result.warnings });
  } catch (e) {
    log.error('ingest.failed', { error: (e as Error).message });
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
