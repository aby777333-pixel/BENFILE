import { NextResponse, type NextRequest } from 'next/server';
import { getStaff } from '@/lib/db/server';
import { hasPermission } from '@/lib/security/permissions';
import { rateLimit } from '@/lib/security/rate-limit';

/** GET /api/evidence/:runId - raw provider payload for the evidence drawer (audited by the RPC). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const { db, staff } = await getStaff();
  if (!staff) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!hasPermission(staff.role, 'clients:read')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const rl = rateLimit(`evidence:${staff.userId}`, 60, 10 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  const { data, error } = await db.rpc('get_raw_payload', { p_run_id: runId, p_reason: 'evidence drawer' });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ payload: data }, { headers: { 'Cache-Control': 'no-store' } });
}
