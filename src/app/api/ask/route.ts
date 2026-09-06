import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { audit } from '@/lib/db/audit';
import { getStaff } from '@/lib/db/server';
import { rateLimit } from '@/lib/security/rate-limit';
import { loadIntelligence } from '@/lib/wealth/load-context';
import { answerQuestion } from '@/lib/wealth/nlq';
import type { ClientAnalysis } from '@/lib/wealth/behavior-engine';
import type { ApproachStrategy } from '@/lib/wealth/approach-engine';

const Body = z.object({ clientId: z.string().uuid(), question: z.string().min(2).max(500) });

/** POST /api/ask - natural-language investigation over structured client data (no free-form generation). */
export async function POST(req: NextRequest) {
  const { db, staff } = await getStaff();
  if (!staff) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!rateLimit(`ask:${staff.userId}`, 60, 10 * 60_000).ok) return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const bundle = await loadIntelligence(db, parsed.data.clientId);
  const answer = answerQuestion(parsed.data.question, bundle.ctx, (bundle.latestAnalysis?.result as ClientAnalysis | undefined) ?? null, (bundle.latestStrategy?.result as ApproachStrategy | undefined) ?? null);
  await audit(db, { action: 'nlq.ask', clientId: parsed.data.clientId, details: { intent: answer.intent, q: parsed.data.question.slice(0, 80) } });
  return NextResponse.json(answer);
}
