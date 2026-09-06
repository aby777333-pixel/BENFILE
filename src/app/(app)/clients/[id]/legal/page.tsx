import { loadClient } from '@/lib/db/load-client';
import { loadIntelligence } from '@/lib/wealth/load-context';
import { cr } from '@/lib/wealth/wealth-engine';
import { hasPermission } from '@/lib/security/permissions';
import { formatDate, formatDateTime } from '@/lib/engines/normalize';
import { Panel, Empty, NotAvailable } from '@/components/ui/panel';
import { Badge, EvidenceBadge, EntityMatchBadge, SourceTag, StatusBadge } from '@/components/ui/badges';
import { AttachLegalForm, LegalReviewForm, type LegalPrefill } from '@/components/wealth/legal-forms';
import type { LegalMatterRow, LiabilityRow } from '@/lib/wealth/types';

interface FindingRow {
  id: string;
  title: string;
  excerpt: string | null;
  url: string | null;
  source_name: string;
  connector_key: string;
  tier: number;
  match_score: number;
  match_status: string;
  category: string | null;
  entity_role: string | null;
  published_at: string | null;
  retrieved_at: string;
  data: Record<string, unknown>;
  review_status: string;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const pick = (data: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = data[k];
    if (v !== null && v !== undefined && v !== '' && typeof v !== 'object') return String(v);
  }
  return undefined;
};
const roleTone = (r: string | null) => (!r || r === 'UNKNOWN' ? 'muted' : ['DEFENDANT', 'RESPONDENT'].includes(r) ? 'warn' : ['PLAINTIFF', 'PETITIONER'].includes(r) ? 'info' : 'neutral');
const SubjectBadge = ({ kind }: { kind: string }) => <Badge tone={kind === 'ASSOCIATED_COMPANY' ? 'gold' : 'neutral'}>{kind === 'ASSOCIATED_COMPANY' ? 'Associated company' : 'Person'}</Badge>;
const Parties = ({ parties }: { parties: LegalMatterRow['parties'] }) => {
  const list = Array.isArray(parties) ? parties : [];
  if (!list.length) return <NotAvailable label="Not listed" />;
  return (
    <ul className="space-y-0.5 text-xs">
      {list.slice(0, 6).map((p, i) => (
        <li key={i}><span className="text-ink-100">{p.name}</span> <span className="text-ink-400">{(p.role ?? 'UNKNOWN').replace(/_/g, ' ').toLowerCase()}</span></li>
      ))}
      {list.length > 6 ? <li className="text-ink-400">+{list.length - 6} more</li> : null}
    </ul>
  );
};

function MattersTable({ rows, canReview }: { rows: LegalMatterRow[]; canReview: boolean }) {
  if (!rows.length) return <Empty>No legal matters attached to this client.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>Case</th><th>Court / jurisdiction</th><th>Type / category</th><th>Parties</th><th>Client role</th><th>Subject</th><th>Filed</th><th>Status</th><th>Latest order</th><th>Amount</th><th>Source / evidence</th><th>Identity match</th><th>Review</th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className={m.review_status === 'NOT_THE_CLIENT' ? 'opacity-50' : ''}>
              <td className="mono text-xs">{m.case_number ?? <NotAvailable label="No number" />}</td>
              <td className="text-xs">{m.court ?? '-'}{m.jurisdiction ? <div className="text-ink-400">{m.jurisdiction}</div> : null}</td>
              <td className="text-xs">{m.case_type ?? '-'}{m.category ? <div><Badge tone={['INSOLVENCY', 'RECOVERY', 'CRIMINAL_COMPLAINT'].includes(m.category) ? 'bad' : 'neutral'}>{m.category.replace(/_/g, ' ')}</Badge></div> : null}</td>
              <td><Parties parties={m.parties} /></td>
              <td><Badge tone={roleTone(m.client_role)}>{(m.client_role ?? 'UNKNOWN').replace(/_/g, ' ')}</Badge></td>
              <td><SubjectBadge kind={m.subject_kind} /></td>
              <td className="text-xs">{formatDate(m.filing_date)}</td>
              <td>{m.status ? <StatusBadge status={m.status.toUpperCase().replace(/\s+/g, '_')} /> : <NotAvailable label="Unknown" />}</td>
              <td className="text-xs">{m.latest_order_date ? formatDate(m.latest_order_date) : '-'}</td>
              <td className="mono text-xs">{num(m.amount_involved) !== null ? `INR ${cr(num(m.amount_involved) ?? 0)}` : '-'}</td>
              <td><div className="flex flex-col gap-1"><SourceTag sourceKey={m.source_key} /><EvidenceBadge kind={m.evidence_class} /></div></td>
              <td><div className="flex flex-col gap-1"><span className="mono text-xs">{num(m.identity_confidence) !== null ? `${num(m.identity_confidence)}%` : 'Not scored'}</span>{m.match_status ? <EntityMatchBadge status={m.match_status} /> : null}</div></td>
              <td><div className="space-y-1"><StatusBadge status={m.review_status} />{canReview ? <LegalReviewForm id={m.id} current={m.review_status} /> : null}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function prefillFrom(f: FindingRow): LegalPrefill {
  const d = f.data ?? {};
  const partiesRaw = d.parties ?? d.petitioners ?? d.respondents;
  return {
    caseNumber: pick(d, ['case_number', 'caseNumber', 'cnr', 'cnr_number', 'case_no']) ?? f.title,
    court: pick(d, ['court', 'court_name', 'bench']),
    jurisdiction: pick(d, ['jurisdiction', 'state', 'district']),
    caseType: pick(d, ['case_type', 'caseType', 'type']),
    category: (pick(d, ['category']) ?? f.category ?? undefined)?.toUpperCase(),
    clientRole: (pick(d, ['client_role', 'role']) ?? f.entity_role ?? undefined)?.toUpperCase().replace(/\s+/g, '_'),
    subjectKind: pick(d, ['subject_kind', 'subjectKind']),
    filingDate: pick(d, ['filing_date', 'filingDate', 'registration_date', 'date_filed'])?.slice(0, 10),
    status: pick(d, ['status', 'case_status', 'stage']),
    orderDate: pick(d, ['latest_order_date', 'order_date', 'last_hearing'])?.slice(0, 10),
    amount: pick(d, ['amount', 'amount_involved', 'claim_amount']),
    sourceKey: f.connector_key,
    evidenceClass: 'OFFICIAL_PUBLIC_RECORD',
    identityConfidence: String(f.match_score ?? ''),
    matchStatus: f.match_status,
    parties: partiesRaw ? JSON.stringify(partiesRaw) : undefined,
  };
}

export default async function LegalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, db } = await loadClient(id, 'legal');
  const { ctx } = await loadIntelligence(db, id);
  const canReview = hasPermission(role, 'external:review');
  const [{ data: findingsData }, { data: attachedData }] = await Promise.all([
    db.from('external_findings').select('id,title,excerpt,url,source_name,connector_key,tier,match_score,match_status,category,entity_role,published_at,retrieved_at,data,review_status').eq('client_id', id).eq('result_type', 'LEGAL_RECORD').order('retrieved_at', { ascending: false }),
    db.from('legal_matters').select('finding_id').eq('client_id', id).not('finding_id', 'is', null),
  ]);
  const attached = new Set(((attachedData ?? []) as Array<{ finding_id: string | null }>).map((r) => r.finding_id));
  const findings = ((findingsData ?? []) as FindingRow[]).filter((f) => !attached.has(f.id));
  const matters = [...ctx.legal].sort((a, b) => (b.filing_date ?? '').localeCompare(a.filing_date ?? ''));
  const insolvency = matters.filter((m) => m.category === 'INSOLVENCY' || m.category === 'RECOVERY');
  const distressed = ctx.liabilities.filter((l) => ['WRITTEN_OFF', 'SETTLED', 'DPD_90'].includes(l.repayment_status ?? ''));
  const personCount = matters.filter((m) => m.subject_kind !== 'ASSOCIATED_COMPANY').length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gold-500/25 bg-gold-500/[0.06] px-4 py-3 text-xs text-ink-200">
        <span className="font-semibold text-gold-300">Presence of a name in litigation is not evidence of wrongdoing.</span> Roles: plaintiff / defendant / petitioner / respondent / witness / director of involved company / other / unknown. Every matter carries an identity-match confidence and must be reviewed before it is treated as belonging to the client. Matters against an associated company are shown separately from matters against the person.
      </div>

      <Panel title={`Legal, insolvency & regulatory register (${matters.length})`} right={<span className="flex gap-1.5"><Badge tone="neutral">{personCount} person</Badge><Badge tone="gold">{matters.length - personCount} associated company</Badge>{ctx.externalPending ? <Badge tone="warn">{ctx.externalPending} external findings pending</Badge> : null}</span>}>
        <MattersTable rows={matters} canReview={canReview} />
        {!canReview ? <p className="mt-2 text-[11px] text-ink-400">Your role can view matters; review decisions require the external:review permission.</p> : null}
      </Panel>

      <Panel title="Insolvency, default & recovery" right={insolvency.length || distressed.length ? <Badge tone="bad">{insolvency.length + distressed.length} signal(s)</Badge> : <Badge tone="good">None recorded</Badge>}>
        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">Against the person</h4>
            <DistressList matters={insolvency.filter((m) => m.subject_kind !== 'ASSOCIATED_COMPANY')} liabilities={distressed} />
          </div>
          <div>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">Against associated companies</h4>
            <DistressList matters={insolvency.filter((m) => m.subject_kind === 'ASSOCIATED_COMPANY')} liabilities={[]} companyNote />
          </div>
        </div>
      </Panel>

      <Panel title={`External legal findings not yet attached (${findings.length})`} right={<Badge tone="muted">From External Intel searches</Badge>}>
        {findings.length ? (
          <div className="space-y-4">
            {findings.map((f) => (
              <details key={f.id} className="rounded-lg border border-white/[0.06] bg-ink-900 p-3">
                <summary className="cursor-pointer">
                  <span className="font-medium text-ink-100">{f.title}</span>
                  <span className="ml-2 inline-flex flex-wrap gap-1 align-middle"><EntityMatchBadge status={f.match_status} score={num(f.match_score) ?? undefined} /><SourceTag sourceKey={f.connector_key} tier={f.tier} label={f.source_name} /><StatusBadge status={f.review_status} /></span>
                  {f.excerpt ? <p className="mt-1 text-xs text-ink-300">{f.excerpt}</p> : null}
                  <p className="mt-0.5 text-[11px] text-ink-500">Retrieved {formatDateTime(f.retrieved_at)}{f.published_at ? ` - published ${formatDate(f.published_at)}` : ''}{f.url ? <> - <a href={f.url} target="_blank" rel="noreferrer" className="text-ink-300 underline">source</a></> : null}</p>
                </summary>
                <div className="mt-3 border-t border-white/[0.06] pt-3">
                  {canReview ? <AttachLegalForm clientId={id} findingId={f.id} prefill={prefillFrom(f)} /> : <p className="text-xs text-ink-400">Attaching requires the external:review permission.</p>}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <Empty>No unattached legal-record findings. Run an External Intel search to look for court records.</Empty>
        )}
      </Panel>

      {canReview ? (
        <Panel title="Add legal matter manually" right={<Badge tone="gold">Analyst entry - review still required</Badge>}>
          <AttachLegalForm clientId={id} submitLabel="Add legal matter" prefill={{ evidenceClass: 'ANALYST_PROVIDED', sourceKey: 'ANALYST', matchStatus: 'POSSIBLE_MATCH' }} />
        </Panel>
      ) : null}
    </div>
  );
}

function DistressList({ matters, liabilities, companyNote }: { matters: LegalMatterRow[]; liabilities: LiabilityRow[]; companyNote?: boolean }) {
  if (!matters.length && !liabilities.length) return <Empty>{companyNote ? 'No insolvency or recovery matters recorded against associated companies.' : 'No insolvency, recovery or defaulted facilities recorded.'}</Empty>;
  return (
    <ul className="space-y-1.5 text-sm">
      {matters.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center gap-2 rounded border border-danger/25 bg-danger/5 px-3 py-2">
          <Badge tone="bad">{(m.category ?? 'LEGAL').replace(/_/g, ' ')}</Badge>
          <span className="mono text-xs">{m.case_number ?? 'No number'}</span>
          <span className="text-ink-200">{m.court ?? 'Court not available'}</span>
          <Badge tone={roleTone(m.client_role)}>{(m.client_role ?? 'UNKNOWN').replace(/_/g, ' ')}</Badge>
          <SubjectBadge kind={m.subject_kind} />
          <span className="text-xs text-ink-400">{m.status ?? 'status unknown'} - filed {formatDate(m.filing_date)}</span>
          <StatusBadge status={m.review_status} />
        </li>
      ))}
      {liabilities.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center gap-2 rounded border border-warn/25 bg-warn/5 px-3 py-2">
          <Badge tone="warn">{(l.repayment_status ?? '').replace(/_/g, ' ')}</Badge>
          <span className="text-ink-100">{l.liability_type.replace(/_/g, ' ')}</span>
          <span className="text-ink-300">{l.lender ?? 'Lender not available'}</span>
          <span className="mono text-xs">{num(l.outstanding) !== null ? `INR ${cr(num(l.outstanding) ?? 0)}` : 'outstanding not available'}</span>
          <Badge tone={['GUARANTOR', 'DIRECTOR_GUARANTOR'].includes(l.role) ? 'gold' : 'neutral'}>{l.role.replace(/_/g, ' ')}</Badge>
          <EvidenceBadge kind={l.evidence_class} short />
          <SourceTag sourceKey={l.source_key} />
        </li>
      ))}
    </ul>
  );
}
