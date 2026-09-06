import { loadClient } from '@/lib/db/load-client';
import { hasPermission } from '@/lib/security/permissions';
import { formatDateTime } from '@/lib/engines/normalize';
import { extractClaims, type ExtractedClaim } from '@/lib/wealth/human-input-engine';
import type { HumanInputRow } from '@/lib/wealth/types';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, StatusBadge } from '@/components/ui/badges';
import { HumanInputForm, VerifyHumanInputButton } from '@/components/engagement/human-input-form';
import { HUMAN_CATEGORIES, HUMAN_SOURCE_TYPES } from '@/lib/wealth/human-input-constants';

type HumanItem = HumanInputRow & { related_transaction: string | null; language: string | null };

type VerificationFinding = { title: string; source: string; matchStatus: string; matchScore: number; url: string | null; recordId: string };
type VerificationResult = {
  checkedAt?: string;
  by?: string;
  claims?: Array<{ kind: string; entities: string[]; verifiable: boolean; plan: string[]; questions: string[]; cautions: string[] }>;
  results?: Array<{ kind: string; status: string; summary: string; findings: VerificationFinding[]; checkedConnectors: string[] }>;
};

const SOURCE_LABEL: Record<string, string> = Object.fromEntries(HUMAN_SOURCE_TYPES.map((s) => [s.key, s.label.toUpperCase()]));
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(HUMAN_CATEGORIES.map((c) => [c.key, c.label]));
const CONFIDENCE_LABEL: Record<string, string> = { VERY_LOW: 'very low', LOW: 'low', MEDIUM: 'medium', HIGH: 'high' };

function sourceTone(sourceType: string): 'warn' | 'declared' | 'muted' | 'bad' {
  if (sourceType === 'CLIENT_DECLARED') return 'declared';
  if (sourceType === 'RUMOUR' || sourceType === 'UNKNOWN_SOURCE') return 'bad';
  if (sourceType === 'FIRST_HAND_OBSERVATION') return 'warn';
  return 'muted';
}

function statusTone(status: string): 'good' | 'warn' | 'bad' | 'muted' {
  if (status === 'VERIFIED') return 'good';
  if (status === 'CONTRADICTED') return 'bad';
  if (status === 'POSSIBLE_MATCH' || status === 'VERIFY_REQUESTED') return 'warn';
  return 'muted';
}

export default async function HumanInputPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, role, db } = await loadClient(id, 'humaninput');
  const canWrite = hasPermission(role, 'notes:write');
  const canVerify = hasPermission(role, 'external:search');
  const { data } = await db.from('human_inputs').select('*').eq('client_id', id).order('created_at', { ascending: false });
  const items = (data ?? []) as HumanItem[];
  const byName = Object.fromEntries(c360.staff.map((s) => [s.user_id, s.full_name]));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-dashed border-amber-400/60 bg-amber-400/[0.06] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold uppercase tracking-[0.14em] text-amber-300">Human input is context, not fact</div>
          <Badge tone="warn">Human context influence on financial profile: NONE</Badge>
        </div>
        <p className="mt-1 text-xs text-amber-200/80">Everything on this tab is an observation, statement, opinion or rumour recorded by a person. It never feeds a score, a net-worth figure, a suitability decision or a risk rating. It can only generate verification tasks and questions.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <LayerCard tone="good" title="Layer 1 - Verified profile" body="Facts returned by trusted sources or official records, with provenance and freshness. Drives scores and decisions." />
        <LayerCard tone="declared" title="Layer 2 - Client-declared profile" body="What the client stated about themselves, captured with their knowledge. Labelled as declared; never presented as verified." />
        <LayerCard tone="warn" title="Layer 3 - Human & market context" body="This tab. Observations, hearsay, opinions and market chatter. Kept separate, visibly unverified, and only ever a prompt to verify." />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {canWrite ? (
            <Panel title="Record human input" right={<Badge tone="warn">Unverified</Badge>}>
              <HumanInputForm clientId={id} />
            </Panel>
          ) : null}

          <Panel title="Human context items" right={<Badge tone="muted">{items.length}</Badge>}>
            {items.length ? (
              <ul className="space-y-3">
                {items.map((it) => (
                  <HumanItemCard key={it.id} item={it} author={byName[it.author_id] ?? 'Staff'} canVerify={canVerify} />
                ))}
              </ul>
            ) : (
              <Empty>No human input recorded. Anything recorded here stays outside the verified profile.</Empty>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Unverified human context (AI summary)" right={<Badge tone="warn">Not fact</Badge>}>
            <p className="text-[11px] text-ink-400">Assembled deterministically from the items on this tab. Every sentence is attributed to its source and phrased as a statement, never as a finding.</p>
            <div className="mt-2 rounded-lg border border-dashed border-amber-400/40 bg-ink-900 p-3 text-xs leading-relaxed text-ink-200">{items.length ? buildSummary(items) : 'No human context has been recorded for this client. Nothing here influences the financial profile.'}</div>
          </Panel>
          <Panel title="How this tab is used">
            <ul className="space-y-1.5 text-xs text-ink-300">
              <li>- Each item is tagged with who asserted it and how confident the author was. That is author confidence, not verification confidence.</li>
              <li>- Claims are extracted into a verification plan and follow-up questions. Verification runs only through consented connectors.</li>
              <li>- A verified claim still does not change the profile automatically; it creates a task to attach the official record or document.</li>
              <li>- Contradicted or unverifiable items remain visible, unchanged, and clearly labelled.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function LayerCard({ tone, title, body }: { tone: 'good' | 'declared' | 'warn'; title: string; body: string }) {
  const border = tone === 'good' ? 'border-verified/30' : tone === 'declared' ? 'border-declared/30' : 'border-dashed border-amber-400/50';
  const text = tone === 'good' ? 'text-emerald-300' : tone === 'declared' ? 'text-cyan-300' : 'text-amber-300';
  return (
    <div className={`rounded-lg border ${border} bg-ink-900 p-3`}>
      <div className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${text}`}>{title}</div>
      <p className="mt-1 text-xs text-ink-300">{body}</p>
    </div>
  );
}

function HumanItemCard({ item, author, canVerify }: { item: HumanItem; author: string; canVerify: boolean }) {
  const claims = extractClaims(item.body);
  const vr = (item.verification_result ?? null) as VerificationResult | null;
  const verifiable = claims.some((c) => c.verifiable);
  return (
    <li className="rounded-lg border border-dashed border-amber-400/50 bg-amber-400/[0.03] p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="warn">{CATEGORY_LABEL[item.category] ?? item.category.replace(/_/g, ' ')}</Badge>
        <Badge tone={sourceTone(item.source_type)}>{SOURCE_LABEL[item.source_type] ?? item.source_type.replace(/_/g, ' ')}</Badge>
        <Badge tone={statusTone(item.status)}>{item.status.replace(/_/g, ' ')}</Badge>
        {item.first_hand ? <Badge tone="neutral">First-hand</Badge> : null}
        {item.client_confirmed ? <Badge tone="declared">Client confirmed</Badge> : null}
        {item.has_evidence ? <Badge tone="info">Evidence exists</Badge> : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-ink-100">{item.body}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ink-400">
        {item.attributed_to ? <span>Attributed to: <span className="text-ink-200">{item.attributed_to}</span></span> : null}
        <span>
          Author confidence (not verification confidence): <span className="text-ink-200">{CONFIDENCE_LABEL[item.author_confidence] ?? item.author_confidence.toLowerCase()}</span>
        </span>
        {item.related_company ? <span>Company: {item.related_company}</span> : null}
        {item.related_property ? <span>Property: {item.related_property}</span> : null}
        {item.related_transaction ? <span>Transaction: {item.related_transaction}</span> : null}
        {item.language && item.language !== 'en' ? <span className="mono">lang {item.language}</span> : null}
        <span>
          {author} - {formatDateTime(item.created_at)}
        </span>
        <span className="text-amber-300/80">Influence on financial profile: NONE</span>
      </div>

      <details className="mt-2 text-xs" open={!vr}>
        <summary className="cursor-pointer text-ink-300">Extracted claims ({claims.length})</summary>
        <ul className="mt-1.5 space-y-2">
          {claims.map((c, i) => (
            <ClaimView key={i} claim={c} />
          ))}
        </ul>
      </details>

      {vr ? <VerificationView vr={vr} /> : null}

      {canVerify && verifiable && item.status !== 'ARCHIVED' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <VerifyHumanInputButton id={item.id} />
          <span className="text-[11px] text-ink-400">{vr ? 'Re-run the authorised check. The note itself is never edited.' : 'Runs only the consented connectors relevant to the extracted claims.'}</span>
        </div>
      ) : null}
    </li>
  );
}

function ClaimView({ claim }: { claim: ExtractedClaim }) {
  return (
    <li className="rounded border border-white/[0.06] bg-ink-900 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{claim.kind.replace(/_/g, ' ')}</Badge>
        <Badge tone={claim.verifiable ? 'info' : 'muted'}>{claim.verifiable ? 'Verifiable' : 'Context only'}</Badge>
        {claim.entities.map((e) => (
          <span key={e} className="mono rounded border border-white/10 px-1.5 py-0.5 text-[10.5px] text-ink-200">
            {e}
          </span>
        ))}
      </div>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
        <ListBlock title="Verification plan" items={claim.verificationPlan} />
        <ListBlock title="Follow-up questions" items={claim.followUpQuestions} />
        <ListBlock title="Cautions" items={claim.cautions} tone="amber" />
      </div>
    </li>
  );
}

function ListBlock({ title, items, tone }: { title: string; items: string[]; tone?: 'amber' }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">{title}</div>
      {items.length ? (
        <ul className={`mt-0.5 space-y-0.5 ${tone === 'amber' ? 'text-amber-200/80' : 'text-ink-200'}`}>
          {items.map((x) => (
            <li key={x}>- {x}</li>
          ))}
        </ul>
      ) : (
        <div className="mt-0.5 text-ink-500">None</div>
      )}
    </div>
  );
}

function VerificationView({ vr }: { vr: VerificationResult }) {
  const results = vr.results ?? [];
  return (
    <div className="mt-2 rounded border border-white/[0.08] bg-ink-900 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
        <span className="font-semibold uppercase tracking-wider text-ink-300">Verification result</span>
        {vr.checkedAt ? <span>checked {formatDateTime(vr.checkedAt)}</span> : null}
      </div>
      {results.length ? (
        <ul className="mt-1.5 space-y-2">
          {results.map((r, i) => (
            <li key={i}>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="neutral">{r.kind.replace(/_/g, ' ')}</Badge>
                <Badge tone={statusTone(r.status)}>{r.status.replace(/_/g, ' ')}</Badge>
                {r.checkedConnectors.length ? <span className="mono text-ink-400">connectors: {r.checkedConnectors.join(', ')}</span> : <span className="text-ink-500">no connector run</span>}
              </div>
              <p className="mt-1 text-ink-200">{r.summary}</p>
              {r.findings.length ? (
                <div className="mt-1 overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Record</th>
                        <th>Match</th>
                        <th>Source</th>
                        <th>Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.findings.map((f) => (
                        <tr key={f.recordId}>
                          <td className="text-xs">{f.title}</td>
                          <td>
                            <StatusBadge status={f.matchStatus} /> <span className="mono text-ink-400">{f.matchScore}%</span>
                          </td>
                          <td className="text-xs text-ink-300">{f.source}</td>
                          <td className="text-xs">
                            {f.url ? (
                              <a href={f.url} target="_blank" rel="noreferrer noopener" className="text-gold-300 hover:underline">
                                open
                              </a>
                            ) : (
                              <span className="text-ink-500">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-ink-300">No automated verification path for the claims in this note. Follow the verification plan above.</p>
      )}
    </div>
  );
}

function buildSummary(items: HumanItem[]): string {
  const article = (label: string) => (/^[aeiou]/i.test(label) ? 'An' : 'A');
  return items
    .map((it) => {
      const src = (HUMAN_SOURCE_TYPES.find((s) => s.key === it.source_type)?.label ?? it.source_type.replace(/_/g, ' ')).toLowerCase();
      const who = it.attributed_to ? `${src} (${it.attributed_to})` : src;
      const body = it.body.trim().replace(/\s+/g, ' ');
      const quoted = body.length > 220 ? `${body.slice(0, 217)}...` : body;
      const tail =
        it.status === 'VERIFIED'
          ? 'A later authorised check found an official record consistent with this statement; the statement itself remains human context until the record is attached to the profile.'
          : it.status === 'CONTRADICTED'
            ? 'A later authorised check found records that do not support this statement.'
            : it.status === 'POSSIBLE_MATCH'
              ? 'A later authorised check found a similar record, but identity could not be confirmed.'
              : 'No independent evidence is currently available.';
      return `${article(src)} ${who} stated that "${quoted}". ${tail}`;
    })
    .join(' ');
}
