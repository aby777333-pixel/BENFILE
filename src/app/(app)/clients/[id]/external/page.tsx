import { loadClient } from '@/lib/db/load-client';
import { hasPermission } from '@/lib/security/permissions';
import { listConnectors } from '@/lib/external/orchestrator';
import { RESULT_TYPE_LABEL, type ResultType } from '@/lib/external/types';
import { formatDate, formatDateTime } from '@/lib/engines/normalize';
import { TIER_LABEL, type SourceTier } from '@/lib/canonical/types';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, EntityMatchBadge, ModeBadge, StatusBadge } from '@/components/ui/badges';
import { ExternalSearchForm, FindingReview } from '@/components/client360/external-forms';

const SECTIONS: Array<{ title: string; types: ResultType[] }> = [
  { title: 'Government records', types: ['GOVERNMENT_RECORD'] },
  { title: 'Corporate records', types: ['CORPORATE_RECORD', 'DIRECTORSHIP'] },
  { title: 'Regulatory & screening', types: ['REGULATORY_RECORD', 'SANCTIONS_SCREEN', 'PEP_SCREEN'] },
  { title: 'Legal records', types: ['LEGAL_RECORD'] },
  { title: 'Professional profiles', types: ['PROFESSIONAL_PROFILE'] },
  { title: 'Public social profiles', types: ['SOCIAL_PROFILE'] },
  { title: 'News & media', types: ['NEWS'] },
  { title: 'Public assets', types: ['PUBLIC_ASSET'] },
  { title: 'Web mentions', types: ['WEB_MENTION'] },
];

export default async function ExternalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ filter?: string }> }) {
  const { id } = await params;
  const { filter } = await searchParams;
  const { c360, role, db } = await loadClient(id, 'external');
  const canSearch = hasPermission(role, 'external:search');
  const canReview = hasPermission(role, 'external:review');
  const [{ data: findings }, { data: searches }, { data: refresh }] = await Promise.all([
    db.from('external_findings').select('*').eq('client_id', id).order('tier').order('match_score', { ascending: false }),
    db.from('external_searches').select('*').eq('client_id', id).order('started_at', { ascending: false }).limit(5),
    db.from('refresh_schedules').select('*').eq('client_id', id).maybeSingle(),
  ]);
  const consent = c360.consents.find((c) => c.status === 'GRANTED');
  const all = findings ?? [];
  const shown = filter === 'review' ? all.filter((f) => f.review_status === 'PENDING' && (f.data?.humanReviewRequired || f.match_status !== 'CONFIRMED')) : filter === 'risks' ? all.filter((f) => f.category === 'POTENTIAL_ADVERSE' || f.result_type === 'LEGAL_RECORD' || (f.data?.hits ?? 0) > 0) : filter === 'identity' ? all.filter((f) => ['PROFESSIONAL_PROFILE', 'SOCIAL_PROFILE', 'WEB_MENTION'].includes(f.result_type)) : all;
  const pending = all.filter((f) => f.review_status === 'PENDING').length;
  const connectors = listConnectors();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="External intelligence search" className="xl:col-span-2" right={consent ? <Badge tone="good">Consent on file</Badge> : <Badge tone="bad">No consent</Badge>}>
          <p className="mb-3 text-xs text-ink-400">
            Flow: consent & lawful purpose - normalise identity - government - corporate/regulatory - professional - public web - social - media - entity resolution - de-duplication - evidence ranking - human review - Client 360 update. Findings are stored as PENDING and never attach to the permanent profile until an authorised reviewer accepts them.
          </p>
          {consent ? (
            <p className="mb-3 text-xs text-ink-300">
              Purpose <span className="text-ink-100">{consent.purpose}</span> - authorised sources <span className="mono text-ink-100">{consent.sources_authorized.join(', ') || 'none'}</span>
              {consent.expires_at ? ` - expires ${formatDate(consent.expires_at)}` : ''}
            </p>
          ) : (
            <p className="mb-3 text-xs text-amber-300">Record consent (Notes & Cases tab) before searching. BENFILE is not a covert people-search tool.</p>
          )}
          {canSearch && consent ? <ExternalSearchForm clientId={id} connectors={connectors.map((c) => ({ key: c.key, name: c.name, mode: c.mode, tier: c.tier, requires: c.requiresConsentFor, authorised: c.requiresConsentFor.every((s) => consent.sources_authorized.includes(s) || consent.sources_authorized.includes('ALL')) }))} /> : null}
        </Panel>
        <Panel title="Continuous refresh">
          {refresh ? (
            <dl className="kv">
              <dt>Last checked</dt>
              <dd>{formatDateTime(refresh.last_checked_at)}</dd>
              <dt>Next permitted</dt>
              <dd>{formatDate(refresh.next_permitted_at)}</dd>
              <dt>Authorised until</dt>
              <dd>{refresh.authorized_until ? formatDate(refresh.authorized_until) : 'Consent has no expiry'}</dd>
              <dt>Sources checked</dt>
              <dd className="mono text-xs">{refresh.sources_checked.join(', ')}</dd>
              <dt>Monitoring</dt>
              <dd>{refresh.enabled ? <Badge tone="good">Enabled</Badge> : <Badge tone="muted">Manual only</Badge>}</dd>
            </dl>
          ) : (
            <p className="text-sm text-ink-400">No external search has run yet.</p>
          )}
          <p className="mt-3 text-[11px] text-ink-500">Refresh never runs beyond the purpose and authorisation granted. Changes are written to the intelligence timeline with previous and new values.</p>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-400">Show:</span>
        {[
          ['', 'All results', all.length],
          ['review', 'Potential identity matches (pending review)', all.filter((f) => f.review_status === 'PENDING').length],
          ['risks', 'Potential risks', all.filter((f) => f.category === 'POTENTIAL_ADVERSE' || f.result_type === 'LEGAL_RECORD').length],
          ['identity', 'Digital footprint', all.filter((f) => ['PROFESSIONAL_PROFILE', 'SOCIAL_PROFILE', 'WEB_MENTION'].includes(f.result_type)).length],
        ].map(([k, l, n]) => (
          <a key={String(k)} href={`?filter=${k}`} className={`rounded border px-2 py-1 ${filter === k || (!filter && !k) ? 'border-gold-500/40 text-gold-300' : 'border-white/10 text-ink-300'}`}>
            {l} <span className="mono">{n}</span>
          </a>
        ))}
        {pending ? <Badge tone="warn">{pending} awaiting review</Badge> : null}
      </div>

      {!all.length ? <Empty>No external findings yet. Run a search above.</Empty> : null}
      {SECTIONS.map((sec) => {
        const items = shown.filter((f) => sec.types.includes(f.result_type as ResultType));
        if (!items.length) return null;
        return (
          <Panel key={sec.title} title={sec.title} right={<Badge tone="muted">{items.length}</Badge>}>
            <ul className="space-y-3">
              {items.map((f) => {
                const data = (f.data ?? {}) as Record<string, unknown>;
                const reasons = (f.match_reasons as { reasons?: string[]; gaps?: string[] }) ?? {};
                return (
                  <li key={f.id} className={`rounded-lg border p-3 ${f.review_status === 'ADDED' ? 'border-verified/30 bg-verified/5' : f.review_status === 'REJECTED' ? 'border-white/[0.05] opacity-60' : f.review_status === 'FLAGGED' ? 'border-amber-400/30' : 'border-white/[0.07] bg-ink-900'}`}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone="neutral">{RESULT_TYPE_LABEL[f.result_type as ResultType] ?? f.result_type}</Badge>
                          <EntityMatchBadge status={f.match_status} score={f.match_score} />
                          <Badge tone="muted" title={TIER_LABEL[f.tier as SourceTier]}>
                            Tier {f.tier}
                          </Badge>
                          <ModeBadge mode={String(data.mode ?? 'LIVE')} />
                          <StatusBadge status={f.review_status} />
                          {f.category === 'POTENTIAL_ADVERSE' ? <Badge tone="bad">{String(data.categoryLabel ?? 'Potential adverse media')}</Badge> : f.severity && f.severity !== 'INFO' ? <Badge tone={f.severity === 'HIGH' ? 'bad' : 'warn'}>{f.severity}</Badge> : null}
                          {f.entity_role ? <Badge tone="warn">role: {f.entity_role.replace(/_/g, ' ')}</Badge> : null}
                        </div>
                        <h4 className="mt-1.5 text-sm font-semibold text-ink-100">
                          {f.url ? (
                            <a href={f.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
                              {f.title}
                            </a>
                          ) : (
                            f.title
                          )}
                        </h4>
                        {f.excerpt ? <p className="mt-1 text-xs text-ink-300">{f.excerpt}</p> : null}
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ink-500">
                          <span>Source: {f.source_name}</span>
                          {f.published_at ? <span>Published {formatDate(f.published_at)}</span> : null}
                          <span>Retrieved {formatDateTime(f.retrieved_at)}</span>
                          {f.record_id ? <span className="mono">{f.record_id}</span> : null}
                          {f.url ? <span className="mono truncate max-w-xs">{f.url}</span> : null}
                        </div>
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-ink-400">Match reasoning & record</summary>
                          <div className="mt-1 grid gap-2 sm:grid-cols-2">
                            <div>
                              <div className="text-ink-400">Reasons</div>
                              <ul className="text-emerald-300">{(reasons.reasons ?? []).map((r) => <li key={r}>+ {r}</li>)}</ul>
                              <ul className="text-ink-500">{(reasons.gaps ?? []).map((g) => <li key={g}>- {g} not corroborated</li>)}</ul>
                            </div>
                            <pre className="mono max-h-48 overflow-auto rounded bg-ink-950 p-2 text-[10.5px] text-ink-300">{JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => !['mode', 'categoryLabel', 'humanReviewRequired', 'connectorName'].includes(k))), null, 2)}</pre>
                          </div>
                        </details>
                        {f.review_note ? <p className="mt-1 text-[11px] text-gold-300">Reviewer: {f.review_note}</p> : null}
                      </div>
                      {canReview && f.review_status === 'PENDING' ? <FindingReview id={f.id} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}

      {searches?.length ? (
        <Panel title="Search history">
          <ul className="space-y-1 text-xs text-ink-300">
            {searches.map((s) => (
              <li key={s.id} className="flex flex-wrap gap-x-3 border-b border-white/[0.05] py-1.5">
                <span>{formatDateTime(s.started_at)}</span>
                <span className="text-ink-100">{s.purpose}</span>
                <span className="mono">{(s.connectors as string[]).join(', ')}</span>
                <span>{(s.summary as { total?: number }).total ?? 0} findings</span>
                {((s.summary as { skipped?: Array<{ key: string; reason: string }> }).skipped ?? []).map((k) => (
                  <span key={k.key} className="text-amber-300">
                    skipped {k.key}: {k.reason}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
