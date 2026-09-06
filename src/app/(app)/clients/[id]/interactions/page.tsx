import { loadClient } from '@/lib/db/load-client';
import { hasPermission } from '@/lib/security/permissions';
import { formatDate, formatDateTime } from '@/lib/engines/normalize';
import { loadIntelligence } from '@/lib/wealth/load-context';
import type { InteractionRow, InterestRow } from '@/lib/wealth/types';
import { Panel, Empty, Stat } from '@/components/ui/panel';
import { Badge, EvidenceBadge, StatusBadge } from '@/components/ui/badges';
import { Timeline, type TimelineItem } from '@/components/ui/timeline';
import { ContactControlsForm, InteractionForm, InterestForm, TaskCompleteButtons, TaskForm, type ContactControlsValues } from '@/components/engagement/interaction-form';

type ContactRow = ContactControlsValues & { last_contact_at: string | null; updated_at: string };
type TaskRow = { id: string; title: string; task_type: string; due_at: string | null; assigned_to: string | null; status: string; priority: string; source: string; reason: string | null; created_at: string };

const label = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '-');

function outcomeTone(o: string | null): 'good' | 'warn' | 'bad' | 'muted' | 'gold' {
  if (o === 'CONVERTED') return 'gold';
  if (o === 'PROGRESSED') return 'good';
  if (o === 'DECLINED') return 'bad';
  if (o === 'NO_RESPONSE') return 'warn';
  return 'muted';
}

export default async function InteractionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, role, db, userId } = await loadClient(id, 'interactions');
  const canWrite = hasPermission(role, 'notes:write');
  const [bundle, { data: contactData }, { data: tasksData }] = await Promise.all([loadIntelligence(db, id), db.from('contact_controls').select('*').eq('client_id', id).maybeSingle(), db.from('tasks').select('*').eq('client_id', id).eq('status', 'OPEN').order('due_at', { ascending: true, nullsFirst: false })]);
  const contact = (contactData ?? null) as ContactRow | null;
  const tasks = (tasksData ?? []) as TaskRow[];
  const interactions = bundle.ctx.interactions;
  const interests = bundle.ctx.interests;
  const byName = Object.fromEntries(c360.staff.map((s) => [s.user_id, s.full_name]));
  const now = Date.now();
  const last7 = interactions.filter((i) => now - new Date(i.occurred_at).getTime() <= 7 * 86_400_000).length;
  const summary = engagementSummary(interactions);
  const frequencyBreached = contact?.preferred_frequency_days && contact.last_contact_at ? (now - new Date(contact.last_contact_at).getTime()) / 86_400_000 < contact.preferred_frequency_days : false;

  return (
    <div className="space-y-4">
      {contact?.do_not_contact ? <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm font-semibold text-red-300">DO NOT CONTACT is set for this client. No outbound call, message or marketing may be initiated. Record inbound contact only.</div> : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Contact controls" right={contact?.do_not_contact ? <Badge tone="bad">Do not contact</Badge> : <Badge tone="good">Contact permitted</Badge>}>
          <dl className="kv text-xs">
            <dt>Preferred channel</dt>
            <dd>{label(contact?.preferred_channel)}</dd>
            <dt>Max frequency</dt>
            <dd>{contact?.preferred_frequency_days ? `every ${contact.preferred_frequency_days} days` : 'not stated'}</dd>
            <dt>Marketing</dt>
            <dd>{contact?.marketing_permission ? <Badge tone="good">Permitted</Badge> : <Badge tone="muted">Not permitted</Badge>}</dd>
            <dt>Language / format</dt>
            <dd>
              {contact?.preferred_language ?? 'en'} / {label(contact?.preferred_format)}
            </dd>
            <dt>Reporting</dt>
            <dd>{label(contact?.reporting_frequency)}</dd>
            <dt>Last contact</dt>
            <dd>{contact?.last_contact_at ? formatDateTime(contact.last_contact_at) : 'never'}</dd>
            <dt>Contacts in last 7 days</dt>
            <dd className={last7 >= 3 ? 'text-amber-300' : ''}>{last7}</dd>
          </dl>
          {frequencyBreached ? <p className="mt-2 text-[11px] text-amber-300">Inside the client&apos;s preferred contact gap. Avoid initiating another outbound touch unless the client asked.</p> : null}
          {canWrite ? (
            <div className="mt-3 border-t border-white/[0.06] pt-3">
              <ContactControlsForm clientId={id} current={contact} />
            </div>
          ) : null}
        </Panel>

        <Panel title="Post-meeting capture" className="xl:col-span-2" right={<Badge tone="muted">CRM</Badge>}>
          {canWrite ? <InteractionForm clientId={id} /> : <p className="text-sm text-ink-400">Your role cannot record interactions.</p>}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Relationship history" className="xl:col-span-2" right={<Badge tone="muted">{interactions.length}</Badge>}>
          <Timeline items={interactions.map(toTimelineItem)} />
        </Panel>

        <div className="space-y-4">
          <Panel title="Engagement summary" right={<Badge tone="muted">operational</Badge>}>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Interactions" value={summary.total} sub={`${summary.inbound} inbound / ${summary.outbound} outbound`} />
              <Stat label="Last contact" value={summary.lastAt ? formatDate(summary.lastAt) : 'never'} sub={summary.lastKind ? label(summary.lastKind) : undefined} tone="muted" />
              <Stat label="Pending responses" value={summary.pending} sub="outcome pending / no response" tone={summary.pending ? 'warn' : 'good'} />
              <Stat label="Declines" value={summary.declined} sub={summary.declineReasons[0] ?? 'no reasons recorded'} tone={summary.declined ? 'bad' : 'good'} />
              <Stat label="Meetings" value={summary.meetings} sub={`${summary.siteVisits} site visit(s)`} tone="muted" />
              <Stat label="Avg response" value={summary.avgResponseHours !== null ? `${summary.avgResponseHours}h` : 'n/a'} sub="client response time" tone="muted" />
            </div>
            {summary.declineReasons.length > 1 ? (
              <ul className="mt-3 space-y-0.5 text-[11px] text-ink-300">
                {summary.declineReasons.map((r) => (
                  <li key={r}>- declined: {r}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-[11px] text-ink-500">Operational engagement indicator - not affection or loyalty. Counts describe contact activity only.</p>
          </Panel>

          <Panel title="Open tasks" right={<Badge tone={tasks.length ? 'warn' : 'muted'}>{tasks.length}</Badge>}>
            {tasks.length ? (
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <li key={t.id} className="rounded border border-white/[0.06] bg-ink-900 p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={t.priority === 'URGENT' ? 'bad' : t.priority === 'HIGH' ? 'warn' : 'muted'}>{t.priority}</Badge>
                      <Badge tone="neutral">{label(t.task_type)}</Badge>
                      <Badge tone="muted">{label(t.source)}</Badge>
                    </div>
                    <div className="mt-1 text-ink-100">{t.title}</div>
                    <div className="mt-0.5 text-ink-400">
                      {t.due_at ? `due ${formatDateTime(t.due_at)}` : 'no due date'} - {t.assigned_to ? (byName[t.assigned_to] ?? 'Staff') : 'unassigned'}
                    </div>
                    {t.reason ? <div className="mt-0.5 text-ink-500">{t.reason}</div> : null}
                    {canWrite ? (
                      <div className="mt-1.5">
                        <TaskCompleteButtons id={t.id} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-400">No open tasks for this client.</p>
            )}
            {canWrite ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <TaskForm clientId={id} staff={c360.staff} me={userId} />
              </div>
            ) : null}
          </Panel>
        </div>
      </div>

      <Panel title="Client interest memory" right={<Badge tone="muted">{interests.length} categories</Badge>}>
        <p className="mb-3 text-xs text-amber-300">Never repeatedly pitch something the client has clearly declined. A declined category stays declined until the client says otherwise.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <InterestColumn title="Interested" tone="good" rows={interests.filter((i) => i.stance === 'INTERESTED')} />
          <InterestColumn title="Not interested" tone="bad" rows={interests.filter((i) => i.stance === 'NOT_INTERESTED')} />
          <InterestColumn title="Unknown" tone="muted" rows={interests.filter((i) => i.stance === 'UNKNOWN')} />
        </div>
        {canWrite ? (
          <div className="mt-4">
            <InterestForm clientId={id} />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function InterestColumn({ title, tone, rows }: { title: string; tone: 'good' | 'bad' | 'muted'; rows: InterestRow[] }) {
  const border = tone === 'good' ? 'border-verified/30' : tone === 'bad' ? 'border-danger/30' : 'border-white/[0.08]';
  const text = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-ink-300';
  return (
    <div className={`rounded-lg border ${border} bg-ink-900 p-3`}>
      <div className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${text}`}>
        {title} <span className="mono text-ink-400">{rows.length}</span>
      </div>
      {rows.length ? (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <li key={r.category} className="text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-ink-100">{label(r.category)}</span>
                <EvidenceBadge kind={r.evidence_class} short />
              </div>
              {r.note || r.source ? (
                <div className="text-[11px] text-ink-400">
                  {r.note ?? ''}
                  {r.source ? ` (${r.source})` : ''}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-500">Nothing recorded.</p>
      )}
    </div>
  );
}

function toTimelineItem(i: InteractionRow): TimelineItem {
  const chips: Array<{ key: string; label: string; items: string[]; tone: 'neutral' | 'bad' | 'good' | 'warn' | 'gold' | 'info' }> = [
    { key: 'q', label: 'asked', items: i.questions, tone: 'neutral' },
    { key: 'o', label: 'objection', items: i.objections, tone: 'bad' },
    { key: 'i', label: 'interest', items: i.interests, tone: 'good' },
    { key: 'c', label: 'concern', items: i.concerns, tone: 'warn' },
    { key: 'm', label: 'commitment', items: i.commitments, tone: 'gold' },
    { key: 'p', label: 'product', items: i.products_discussed, tone: 'info' },
  ];
  return {
    at: i.occurred_at,
    title: `${label(i.channel)} ${label(i.kind).toLowerCase()} - ${i.direction === 'INBOUND' ? 'inbound' : 'outbound'}`,
    detail: i.summary,
    tone: i.outcome === 'DECLINED' ? 'bad' : i.outcome === 'CONVERTED' ? 'gold' : i.outcome === 'PROGRESSED' ? 'good' : i.outcome === 'NO_RESPONSE' ? 'warn' : 'neutral',
    meta: (
      <>
        {i.outcome ? <Badge tone={outcomeTone(i.outcome)}>{label(i.outcome)}</Badge> : null}
        {i.decline_reason ? <Badge tone="bad">reason: {i.decline_reason}</Badge> : null}
        {i.follow_up_at ? <Badge tone="warn">follow-up {formatDate(i.follow_up_at)}</Badge> : null}
        {i.response_time_hours !== null ? <Badge tone="muted">response {i.response_time_hours}h</Badge> : null}
        {chips.flatMap((c) => c.items.map((x, n) => (
          <Badge key={`${c.key}${n}`} tone={c.tone} className="normal-case tracking-normal">
            {c.label}: {x}
          </Badge>
        )))}
        {i.client_declared_changes.map((x, n) => (
          <Badge key={`d${n}`} tone="warn" className="border-dashed normal-case tracking-normal">
            client said: {x}
          </Badge>
        ))}
        {i.client_declared_changes.length ? <StatusBadge status="UNREVIEWED" /> : null}
      </>
    ),
  };
}

function engagementSummary(rows: InteractionRow[]) {
  const total = rows.length;
  const inbound = rows.filter((r) => r.direction === 'INBOUND').length;
  const pending = rows.filter((r) => r.outcome === 'PENDING' || r.outcome === 'NO_RESPONSE').length;
  const declinedRows = rows.filter((r) => r.outcome === 'DECLINED');
  const withResponse = rows.filter((r) => r.response_time_hours !== null);
  const last = rows[0] ?? null;
  return {
    total,
    inbound,
    outbound: total - inbound,
    pending,
    declined: declinedRows.length,
    declineReasons: [...new Set(declinedRows.map((r) => r.decline_reason).filter((x): x is string => !!x))],
    meetings: rows.filter((r) => r.kind === 'MEETING').length,
    siteVisits: rows.filter((r) => r.kind === 'SITE_VISIT').length,
    avgResponseHours: withResponse.length ? Math.round((withResponse.reduce((s, r) => s + Number(r.response_time_hours), 0) / withResponse.length) * 10) / 10 : null,
    lastAt: last?.occurred_at ?? null,
    lastKind: last?.kind ?? null,
  };
}
