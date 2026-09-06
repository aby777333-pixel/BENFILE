import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Lock } from 'lucide-react';
import { getStaff } from '@/lib/db/server';
import { hasPermission } from '@/lib/security/permissions';
import { completeTask } from '@/lib/actions-wealth';
import { createRmTask } from '@/lib/actions-ops';
import { formatDate, formatDateTime } from '@/lib/engines/normalize';
import { cr } from '@/lib/wealth/wealth-engine';
import { Panel, Empty, Stat } from '@/components/ui/panel';
import { Badge, ConfidenceBadge } from '@/components/ui/badges';
import { ActionForm } from '@/components/ui/action-form';

export const dynamic = 'force-dynamic';

type Bucket = 'OVERDUE' | 'TODAY' | 'THIS_WEEK' | 'TRIGGER' | 'OTHER';
type Conf = 'HIGH' | 'MEDIUM' | 'LOW';

interface ActionItem {
  id: string;
  bucket: Bucket;
  kind: string;
  title: string;
  reason: string;
  confidence: Conf;
  clientId: string | null;
  clientCode: string | null;
  href: string;
  when: string | null;
  taskId?: string;
  outreach: boolean;
  sensitive?: boolean;
}

interface ClientLite {
  id: string;
  client_code: string;
  display_name: string;
  consent_status: string;
  freshness: string | null;
  assigned_to: string | null;
}

const BUCKET_ORDER: Bucket[] = ['OVERDUE', 'TODAY', 'THIS_WEEK', 'TRIGGER', 'OTHER'];
const BUCKET_LABEL: Record<Bucket, string> = { OVERDUE: 'Overdue', TODAY: 'Today', THIS_WEEK: 'This week', TRIGGER: 'Opportunity triggers', OTHER: 'Everything else' };
const BUCKET_TONE: Record<Bucket, 'bad' | 'warn' | 'info' | 'gold' | 'muted'> = { OVERDUE: 'bad', TODAY: 'warn', THIS_WEEK: 'info', TRIGGER: 'gold', OTHER: 'muted' };

function bucketFor(iso: string | null | undefined, now: Date, weekEnd: Date, fallback: Bucket = 'OTHER'): Bucket {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(startToday.getTime() + 86_400_000);
  if (d < startToday) return 'OVERDUE';
  if (d < endToday) return 'TODAY';
  if (d < weekEnd) return 'THIS_WEEK';
  return fallback;
}

export default async function RmCockpitPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { db, staff } = await getStaff();
  if (!staff) redirect('/login');
  const sp = await searchParams;
  const me = staff.userId;
  const now = new Date();
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  const in60 = new Date(now.getTime() + 60 * 86_400_000);
  const todayIso = now.toISOString().slice(0, 10);

  const [
    { data: clientsRaw },
    { data: tasks },
    { data: visits },
    { data: suit },
    { data: docReq },
    { data: proposals },
    { data: maturing },
    { data: triggers },
    { data: scores },
    { data: prefs },
    { data: plotInterest },
    { data: landowners },
    { data: urgentCases },
    { data: strategies },
    { data: controls },
  ] = await Promise.all([
    db.from('clients').select('id,client_code,display_name,consent_status,freshness,assigned_to').neq('status', 'ARCHIVED'),
    db.from('tasks').select('id,client_id,title,task_type,due_at,priority,source,reason').eq('assigned_to', me).eq('status', 'OPEN').order('due_at', { ascending: true, nullsFirst: false }),
    db.from('site_visits').select('id,client_id,project_id,scheduled_at,status,pickup_required,pickup_point,projects(name)').eq('rm_id', me).eq('status', 'SCHEDULED').gte('scheduled_at', new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString()).lte('scheduled_at', weekEnd.toISOString()),
    db.from('aif_suitability').select('client_id,stage,kyc_status,aml_status,sof_status,expected_amount,updated_at'),
    db.from('document_requests').select('id,client_id,document_type,requested_at').eq('status', 'REQUESTED'),
    db.from('interactions').select('id,client_id,occurred_at,summary,follow_up_at').eq('kind', 'PROPOSAL').eq('outcome', 'PENDING'),
    db.from('assets').select('id,client_id,title,category,value_mid,details').eq('status', 'ACTIVE').not('details->>maturity_on', 'is', null).gte('details->>maturity_on', todayIso),
    db.from('opportunity_triggers').select('id,client_id,trigger_type,title,event_date,confidence,recommended_action,sensitive').eq('status', 'OPEN'),
    db.from('opportunity_scores').select('client_id,vertical,score,relevance'),
    db.from('property_preferences').select('client_id,budget_max,cities'),
    db.from('plot_interest').select('client_id'),
    db.from('landowner_profiles').select('client_id,stage,land_location,extent_acres').in('stage', ['LEAD', 'OWNERSHIP_VERIFICATION']),
    db.from('cases').select('id,client_id,case_code,title,opened_at').eq('priority', 'URGENT').neq('status', 'CLOSED'),
    db.from('approach_strategies').select('client_id,result,confidence,computed_at').order('computed_at', { ascending: false }).limit(200),
    db.from('contact_controls').select('client_id,do_not_contact'),
  ]);

  const clients = (clientsRaw ?? []) as ClientLite[];
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const myClientIds = new Set(clients.filter((c) => c.assigned_to === me).map((c) => c.id));
  const scope: 'mine' | 'all' = sp.scope === 'all' ? 'all' : sp.scope === 'mine' ? 'mine' : myClientIds.size ? 'mine' : 'all';
  const inScope = (clientId: string | null | undefined) => scope === 'all' || !clientId || myClientIds.has(clientId);
  const dnc = new Set((controls ?? []).filter((c) => c.do_not_contact).map((c) => c.client_id as string));
  const code = (id: string | null | undefined) => (id ? (clientById.get(id)?.client_code ?? null) : null);
  const items: ActionItem[] = [];
  const push = (it: Omit<ActionItem, 'clientCode'>) => {
    if (!inScope(it.clientId)) return;
    items.push({ ...it, clientCode: code(it.clientId) });
  };

  // 1. My open tasks (overdue first)
  for (const t of tasks ?? []) {
    push({ id: `task-${t.id}`, bucket: bucketFor(t.due_at, now, weekEnd, 'OTHER'), kind: t.task_type, title: t.title, reason: t.reason ?? (t.source === 'NEXT_BEST_ACTION' ? 'Generated from the approach engine' : t.source === 'TRIGGER' ? 'Generated from an opportunity trigger' : 'Assigned to you'), confidence: t.priority === 'URGENT' || t.priority === 'HIGH' ? 'HIGH' : 'MEDIUM', clientId: t.client_id, href: t.client_id ? `/clients/${t.client_id}/approach` : '/rm', when: t.due_at, taskId: t.id, outreach: ['CALL', 'MEETING', 'FOLLOW_UP', 'PROPOSAL'].includes(t.task_type) });
  }
  // 2. Site visits this week
  for (const v of visits ?? []) {
    const proj = Array.isArray(v.projects) ? v.projects[0] : v.projects;
    push({ id: `visit-${v.id}`, bucket: bucketFor(v.scheduled_at, now, weekEnd, 'THIS_WEEK'), kind: 'SITE_VISIT', title: `Site visit - ${(proj as { name?: string } | null)?.name ?? 'project'}`, reason: `${v.pickup_required ? `Pickup from ${v.pickup_point ?? 'client'}; ` : ''}confirm logistics and bring approvals, EC summary and plot map`, confidence: 'HIGH', clientId: v.client_id, href: `/clients/${v.client_id}/property`, when: v.scheduled_at, outreach: true });
  }
  // 3. AIF follow-ups (journeys not yet funded)
  for (const s of suit ?? []) {
    if (['FUNDING', 'SUBSCRIPTION', 'REPORTING'].includes(s.stage)) continue;
    push({ id: `aif-${s.client_id}`, bucket: 'OTHER', kind: 'AIF_FOLLOW_UP', title: `AIF journey at ${String(s.stage).replace(/_/g, ' ').toLowerCase()}`, reason: `${s.expected_amount ? `Expected INR ${cr(Number(s.expected_amount))}; ` : ''}next: ${s.kyc_status !== 'COMPLETE' ? 'complete KYC' : s.aml_status !== 'COMPLETE' ? 'AML screen pending' : s.sof_status !== 'COMPLETE' ? 'source-of-funds evidence' : 'advance the stage'}`, confidence: s.expected_amount ? 'MEDIUM' : 'LOW', clientId: s.client_id, href: `/clients/${s.client_id}/approach`, when: null, outreach: true });
  }
  // 4. Pending KYC / consent
  const suitByClient = new Map((suit ?? []).map((s) => [s.client_id as string, s]));
  for (const c of clients) {
    const kycPending = suitByClient.get(c.id)?.kyc_status === 'PENDING';
    if (c.consent_status !== 'GRANTED' || kycPending) {
      push({ id: `kyc-${c.id}`, bucket: 'OTHER', kind: 'KYC', title: c.consent_status !== 'GRANTED' ? `Consent ${c.consent_status.toLowerCase()} - obtain or renew consent` : 'KYC pending for AIF journey', reason: c.consent_status !== 'GRANTED' ? 'No data may be refreshed or used for outreach without a granted consent' : 'KYC must be complete before compliance approval', confidence: 'HIGH', clientId: c.id, href: `/clients/${c.id}/documents`, when: null, outreach: false });
    }
  }
  // 5. Missing documents
  for (const d of docReq ?? []) {
    push({ id: `doc-${d.id}`, bucket: bucketFor(new Date(new Date(d.requested_at).getTime() + 7 * 86_400_000).toISOString(), now, weekEnd, 'OTHER'), kind: 'DOCUMENT_REQUEST', title: `Chase document: ${String(d.document_type).replace(/_/g, ' ')}`, reason: `Requested ${formatDate(d.requested_at)}; still outstanding`, confidence: 'HIGH', clientId: d.client_id, href: `/clients/${d.client_id}/documents`, when: d.requested_at, outreach: true });
  }
  // 6. Proposals awaiting response
  for (const p of proposals ?? []) {
    push({ id: `prop-${p.id}`, bucket: bucketFor(p.follow_up_at, now, weekEnd, 'OTHER'), kind: 'PROPOSAL', title: 'Proposal awaiting client response', reason: p.summary, confidence: 'MEDIUM', clientId: p.client_id, href: `/clients/${p.client_id}/interactions`, when: p.follow_up_at ?? p.occurred_at, outreach: true });
  }
  // 7. Maturing investments (within 60 days)
  for (const a of maturing ?? []) {
    const m = (a.details as { maturity_on?: string } | null)?.maturity_on ?? null;
    if (!m || new Date(m) > in60) continue;
    push({ id: `mat-${a.id}`, bucket: bucketFor(m, now, weekEnd, 'TRIGGER'), kind: 'MATURITY', title: `${a.title} matures ${formatDate(m)}`, reason: `${a.value_mid ? `INR ${cr(Number(a.value_mid))} ` : ''}${String(a.category).replace(/_/g, ' ').toLowerCase()} - discuss reinvestment options before maturity`, confidence: 'HIGH', clientId: a.client_id, href: `/clients/${a.client_id}/assets`, when: m, outreach: true });
  }
  // 8. Opportunity triggers
  for (const t of triggers ?? []) {
    push({ id: `trig-${t.id}`, bucket: 'TRIGGER', kind: t.trigger_type, title: t.title, reason: t.sensitive ? 'Sensitive trigger - do not initiate contact; note for context only' : (t.recommended_action ?? 'Review and decide whether an approach is appropriate'), confidence: (t.confidence === 'VERIFIED' || t.confidence === 'HIGH' ? 'HIGH' : t.confidence === 'MEDIUM' ? 'MEDIUM' : 'LOW') as Conf, clientId: t.client_id, href: `/clients/${t.client_id}/approach`, when: t.event_date, outreach: !t.sensitive, sensitive: Boolean(t.sensitive) });
  }
  // 9. Reverification
  for (const c of clients) {
    if (c.freshness === 'STALE' || c.freshness === 'AGING') {
      push({ id: `fresh-${c.id}`, bucket: c.freshness === 'STALE' ? 'THIS_WEEK' : 'OTHER', kind: 'REVERIFY', title: `Profile ${c.freshness.toLowerCase()} - request re-verification`, reason: 'Verified facts have aged beyond the freshness window; do not rely on them for decisions', confidence: 'HIGH', clientId: c.id, href: `/clients/${c.id}/history`, when: null, outreach: false });
    }
  }
  // 10. Inactive high-value leads
  const scoreMap = new Map<string, Map<string, { score: number | null; relevance: string | null }>>();
  for (const s of scores ?? []) {
    const m = scoreMap.get(s.client_id) ?? new Map();
    m.set(s.vertical, { score: s.score, relevance: s.relevance });
    scoreMap.set(s.client_id, m);
  }
  for (const [cid, m] of scoreMap) {
    const eng = m.get('ENGAGEMENT');
    const high = ['AIF', 'PROPERTY'].filter((v) => m.get(v)?.relevance === 'HIGH');
    if (eng && (eng.score ?? 100) < 30 && high.length) {
      push({ id: `inactive-${cid}`, bucket: 'OTHER', kind: 'RE_ENGAGE', title: `Dormant ${high.join(' + ')} lead`, reason: `Engagement score ${eng.score} while ${high.join('/')} relevance is high - a light-touch check-in is appropriate`, confidence: 'MEDIUM', clientId: cid, href: `/clients/${cid}/approach`, when: null, outreach: true });
    }
  }
  // 11. Property buyers awaiting plot options
  const withInterest = new Set((plotInterest ?? []).map((p) => p.client_id as string));
  for (const p of prefs ?? []) {
    if (withInterest.has(p.client_id)) continue;
    push({ id: `plots-${p.client_id}`, bucket: 'OTHER', kind: 'PLOT_OPTIONS', title: 'Buyer awaiting plot options', reason: `Requirements declared${p.budget_max ? ` (budget INR ${cr(Number(p.budget_max))}` : ''}${(p.cities as string[] | null)?.length ? `${p.budget_max ? ', ' : ' ('}${(p.cities as string[]).join('/')}` : ''}${p.budget_max || (p.cities as string[] | null)?.length ? ')' : ''} but no plots shortlisted yet`, confidence: 'MEDIUM', clientId: p.client_id, href: `/clients/${p.client_id}/property`, when: null, outreach: true });
  }
  // 12. Landowners awaiting review
  for (const l of landowners ?? []) {
    push({ id: `land-${l.client_id}`, bucket: 'OTHER', kind: 'LANDOWNER', title: `Landowner at ${String(l.stage).replace(/_/g, ' ').toLowerCase()}`, reason: `${l.land_location ?? 'Location not recorded'}${l.extent_acres ? `, ${l.extent_acres} acres` : ''} - verify ownership before any commercial discussion`, confidence: 'MEDIUM', clientId: l.client_id, href: `/clients/${l.client_id}/property`, when: null, outreach: false });
  }
  // 13. Open urgent complaints / cases
  for (const c of urgentCases ?? []) {
    push({ id: `case-${c.id}`, bucket: 'TODAY', kind: 'URGENT_CASE', title: `${c.case_code}: ${c.title}`, reason: `Urgent case open since ${formatDate(c.opened_at)}`, confidence: 'HIGH', clientId: c.client_id, href: `/clients/${c.client_id}/notes`, when: c.opened_at, outreach: false });
  }
  // 14. Next best actions (latest strategy per client)
  const seenStrategy = new Set<string>();
  for (const s of strategies ?? []) {
    if (seenStrategy.has(s.client_id)) continue;
    seenStrategy.add(s.client_id);
    const nba = (s.result as { nextBestAction?: { action: string; reason: string; confidence: Conf } } | null)?.nextBestAction;
    if (!nba?.action) continue;
    push({ id: `nba-${s.client_id}`, bucket: 'OTHER', kind: 'NEXT_BEST_ACTION', title: nba.action, reason: `${nba.reason} (computed ${formatDate(s.computed_at)})`, confidence: nba.confidence ?? 'LOW', clientId: s.client_id, href: `/clients/${s.client_id}/approach`, when: null, outreach: true });
  }

  const confRank: Record<Conf, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  items.sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || (a.when && b.when ? new Date(a.when).getTime() - new Date(b.when).getTime() : a.when ? -1 : b.when ? 1 : 0) || confRank[a.confidence] - confRank[b.confidence]);
  const grouped = BUCKET_ORDER.map((b) => ({ bucket: b, items: items.filter((i) => i.bucket === b) })).filter((g) => g.items.length);
  const canWrite = hasPermission(staff.role, 'notes:write');
  const counts = { overdue: items.filter((i) => i.bucket === 'OVERDUE').length, today: items.filter((i) => i.bucket === 'TODAY').length, week: items.filter((i) => i.bucket === 'THIS_WEEK').length, triggers: items.filter((i) => i.bucket === 'TRIGGER').length, dnc: items.filter((i) => i.clientId && dnc.has(i.clientId)).length };
  const scopeClients = scope === 'mine' ? clients.filter((c) => myClientIds.has(c.id)) : clients;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">What should I do today?</h1>
          <p className="text-xs text-ink-400">
            Ranked by legitimate business priority: overdue, today, this week, triggers, then everything else. {staff.fullName} - {formatDate(now.toISOString())}.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-400">Scope</span>
          <Link href="/rm?scope=mine" className={`btn btn-sm ${scope === 'mine' ? 'btn-primary' : ''}`}>
            My clients ({myClientIds.size})
          </Link>
          <Link href="/rm?scope=all" className={`btn btn-sm ${scope === 'all' ? 'btn-primary' : ''}`}>
            All clients ({clients.length})
          </Link>
        </div>
      </div>
      {scope === 'all' && !myClientIds.size ? <p className="text-xs text-amber-300">No clients are assigned to you, so the cockpit shows all clients.</p> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Overdue', counts.overdue, counts.overdue ? 'bad' : 'good'],
          ['Today', counts.today, counts.today ? 'warn' : 'good'],
          ['This week', counts.week, 'muted'],
          ['Open triggers', counts.triggers, 'gold'],
          ['Do-not-contact items', counts.dnc, counts.dnc ? 'warn' : 'good'],
        ].map(([label, v, tone]) => (
          <div key={String(label)} className="panel p-3">
            <Stat label={String(label)} value={<span className="mono text-2xl">{v}</span>} tone={tone as 'good'} />
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {grouped.length ? (
            grouped.map((g) => (
              <Panel key={g.bucket} title={BUCKET_LABEL[g.bucket]} right={<Badge tone={BUCKET_TONE[g.bucket]}>{g.items.length}</Badge>}>
                <ul className="divide-y divide-white/[0.05]">
                  {g.items.map((it) => {
                    const locked = Boolean(it.clientId && dnc.has(it.clientId));
                    return (
                      <li key={it.id} className="flex flex-col gap-2 py-2.5 md:flex-row md:items-start">
                        <div className="flex w-full min-w-0 flex-1 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone="neutral">{it.kind.replace(/_/g, ' ')}</Badge>
                            {it.clientCode && it.clientId ? (
                              <Link href={it.href} className="mono text-xs text-gold-300 hover:underline">
                                {it.clientCode}
                              </Link>
                            ) : null}
                            {locked ? (
                              <Badge tone="bad" title="Client has asked not to be contacted. Excluded from outreach suggestions.">
                                <Lock size={10} /> do not contact
                              </Badge>
                            ) : null}
                            {it.sensitive ? <Badge tone="warn">do not initiate contact</Badge> : null}
                            {it.when ? <span className="text-[11px] text-ink-400">{it.when.length > 10 ? formatDateTime(it.when) : formatDate(it.when)}</span> : null}
                          </div>
                          <div className={`text-sm font-medium ${locked && it.outreach ? 'text-ink-400 line-through' : 'text-ink-100'}`}>{it.title}</div>
                          <div className="text-xs text-ink-300">{locked && it.outreach ? 'Outreach suppressed: contact controls forbid it. Record-keeping and compliance work may continue.' : it.reason}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <ConfidenceBadge level={it.confidence} />
                          {it.taskId && canWrite ? (
                            <ActionForm action={completeTask}>
                              <input type="hidden" name="id" value={it.taskId} />
                              <input type="hidden" name="status" value="DONE" />
                              <button className="btn btn-sm">Done</button>
                            </ActionForm>
                          ) : (
                            <Link href={it.href} className="btn btn-sm">
                              Open
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            ))
          ) : (
            <Empty>Nothing needs your attention in this scope. Switch to all clients or create a task.</Empty>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Create task">
            {canWrite ? (
              <ActionForm action={createRmTask} className="space-y-2">
                <div>
                  <label className="label" htmlFor="t-title">
                    Title
                  </label>
                  <input id="t-title" name="title" className="input" required minLength={3} placeholder="Call client about factsheet" />
                </div>
                <div>
                  <label className="label" htmlFor="t-client">
                    Client (optional)
                  </label>
                  <select id="t-client" name="clientId" className="input" defaultValue="">
                    <option value="">No client</option>
                    {scopeClients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.client_code} - {c.display_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label" htmlFor="t-type">
                      Type
                    </label>
                    <select id="t-type" name="taskType" className="input" defaultValue="FOLLOW_UP">
                      {['FOLLOW_UP', 'CALL', 'MEETING', 'DOCUMENT_REQUEST', 'REVERIFY', 'SITE_VISIT', 'PROPOSAL', 'KYC', 'REVIEW'].map((t) => (
                        <option key={t} value={t}>
                          {t.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="t-priority">
                      Priority
                    </label>
                    <select id="t-priority" name="priority" className="input" defaultValue="NORMAL">
                      {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="t-due">
                    Due
                  </label>
                  <input id="t-due" name="dueAt" type="datetime-local" className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="t-reason">
                    Reason
                  </label>
                  <input id="t-reason" name="reason" className="input" placeholder="Why this matters" />
                </div>
                <button className="btn btn-primary btn-sm">Create task</button>
              </ActionForm>
            ) : (
              <p className="text-xs text-ink-400">Your role cannot create tasks.</p>
            )}
          </Panel>
          <Panel title="How this list is built">
            <ul className="space-y-1 text-xs text-ink-300">
              <li>Overdue and dated items first; then open triggers; then journey follow-ups.</li>
              <li>Outreach items for clients with do-not-contact are shown locked and never suggested.</li>
              <li>Sensitive triggers (inheritance, illness) are context only - never initiate contact.</li>
              <li>Confidence reflects evidence quality, not sales pressure. No dark-pattern nudges.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
