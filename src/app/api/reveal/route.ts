import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getStaff } from '@/lib/db/server';
import { hasPermission } from '@/lib/security/permissions';
import { rateLimit } from '@/lib/security/rate-limit';

const Body = z.object({ id: z.string().uuid(), reason: z.string().min(5).max(300) });

/** POST /api/reveal - controlled reveal of one sensitive identifier. Permission-checked twice (app + RPC) and audit-logged by the RPC. */
export async function POST(req: NextRequest) {
  const { db, staff } = await getStaff();
  if (!staff) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!hasPermission(staff.role, 'sensitive:reveal')) return NextResponse.json({ error: 'your role cannot reveal sensitive fields' }, { status: 403 });
  const rl = rateLimit(`reveal:${staff.userId}`, 30, 10 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: 'too many reveals; try again later' }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'a reason of at least 5 characters is required' }, { status: 400 });
  const { data, error } = await db.rpc('reveal_sensitive', { p_id: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ value: row.value_full, kind: row.kind }, { headers: { 'Cache-Control': 'no-store' } });
}
