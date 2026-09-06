import Link from 'next/link';
import { loadClient } from '@/lib/db/load-client';
import type { Assessment, CanonicalProfile } from '@/lib/canonical/types';
import { formatDate, formatDateTime, formatINR } from '@/lib/engines/normalize';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, SeverityBadge, StatusBadge } from '@/components/ui/badges';
import { Timeline } from '@/components/ui/timeline';

function snapshot(p: CanonicalProfile, a: Assessment | null) {
  const cur = p.employment.records.find((r) => r.status === 'CURRENT');
  return {
    'Full name': p.person.fullName.value ?? '-',
    'Verification status': p.verification.status,
    'Income': p.person.income.value?.amount ? formatINR(p.person.income.value.amount) : '-',
    'Credit score': p.credit?.score?.toString() ?? '-',
    'Credit band': p.credit?.band ?? '-',
    'Current employer': cur?.employer.name ?? '-',
    'Employment since': cur?.joiningDate ?? '-',
    'PAN status': p.identityDocuments.find((d) => d.docType === 'PAN')?.status ?? '-',
    'PAN-Aadhaar linked': String(p.identityDocuments.find((d) => d.docType === 'PAN')?.aadhaarLinked ?? '-'),
    'UAN-Aadhaar linked': String(p.employment.epfo?.aadhaarLinked ?? '-'),
    'Mobile status': p.mobile?.subscriberStatus ?? '-',
    'Addresses': String(p.addresses.length),
    'Bank accounts': String(p.bankAccounts.length),
    'Phones': String(p.contacts.phones.length),
    'Profile status': a?.overall.profileStatus ?? '-',
    'Risk level': a?.overall.riskLevel ?? '-',
    'Profile score': a?.score.total?.toString() ?? '-',
    'Completeness': a ? `${Math.round(a.overall.completeness * 100)}%` : '-',
    'Open signals': a ? String(a.riskSignals.length) : '-',
  };
}

export default async function HistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { c360, db } = await loadClient(id, 'history');
  const { runs } = c360;
  const aId = sp.a ?? runs[0]?.id;
  const bId = sp.b ?? runs[1]?.id;
  const [{ data: ra }, { data: rb }, { data: events }] = await Promise.all([
    aId ? db.from('verification_runs').select('*').eq('id', aId).maybeSingle() : Promise.resolve({ data: null }),
    bId ? db.from('verification_runs').select('*').eq('id', bId).maybeSingle() : Promise.resolve({ data: null }),
    db.from('intelligence_events').select('*').eq('client_id', id).order('occurred_at', { ascending: false }).limit(100),
  ]);
  const sa = ra ? snapshot(ra.canonical as CanonicalProfile, ra.assessment as Assessment | null) : null;
  const sb = rb ? snapshot(rb.canonical as CanonicalProfile, rb.assessment as Assessment | null) : null;
  const toneFor = (t: string): 'good' | 'warn' | 'bad' | 'neutral' | 'gold' => (t.startsWith('VERIFICATION') ? 'gold' : t.includes('RISK') || t.includes('DISPUTE') || t === 'FINDING_FLAGGED' ? 'warn' : t === 'FINDING_REJECTED' ? 'bad' : t === 'FINDING_ATTACHED' || t === 'STATUS_CHANGED' ? 'good' : 'neutral');

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <Panel title="Verification timeline" right={<Badge tone="muted">{runs.length} snapshots - never overwritten</Badge>}>
          {runs.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Snapshot</th>
                  <th>Provider</th>
                  <th>Verification ID</th>
                  <th>Status</th>
                  <th>Completed</th>
                  <th>Ingested</th>
                  <th>Compare</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.run_seq}</td>
                    <td className="font-medium">{r.snapshot_label}</td>
                    <td className="text-xs">{r.provider_key}</td>
                    <td className="mono text-xs">{r.verification_id}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="text-xs">{formatDate(r.completed_at)}</td>
                    <td className="text-xs">{formatDateTime(r.ingested_at)}</td>
                    <td className="text-xs">
                      <Link href={`?a=${r.id}&b=${bId ?? ''}`} className="text-gold-300">A</Link> / <Link href={`?a=${aId ?? ''}&b=${r.id}`} className="text-gold-300">B</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No runs.</Empty>
          )}
        </Panel>
        <Panel title="Compare snapshots" right={sa && sb ? <Badge tone="info">Run #{ra!.run_seq} vs run #{rb!.run_seq}</Badge> : null}>
          {sa ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>A - run #{ra!.run_seq} ({formatDate(ra!.completed_at)})</th>
                  <th>B - {rb ? `run #${rb.run_seq} (${formatDate(rb.completed_at)})` : 'select a second run'}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(sa).map(([k, v]) => {
                  const other = sb?.[k as keyof typeof sb];
                  const changed = sb && other !== v;
                  return (
                    <tr key={k} className={changed ? 'bg-gold-500/5' : ''}>
                      <td className="text-xs text-ink-300">{k}</td>
                      <td className={changed ? 'text-gold-300' : ''}>{v}</td>
                      <td className={changed ? 'text-gold-300' : 'text-ink-300'}>{other ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty>Nothing to compare yet.</Empty>
          )}
        </Panel>
      </div>
      <Panel title="Client intelligence timeline">
        <Timeline
          items={(events ?? []).map((e) => ({
            at: e.occurred_at,
            title: e.title,
            detail: e.detail,
            tone: toneFor(e.event_type),
            meta: (
              <>
                <Badge tone="muted">{e.event_type.replace(/_/g, ' ')}</Badge>
                {e.source_key ? <Badge tone="neutral">Source: {e.source_key}</Badge> : null}
                {e.previous_value || e.new_value ? <span className="mono text-[10.5px] text-ink-400">{e.previous_value ?? '-'} to {e.new_value ?? '-'}</span> : null}
                {e.reviewer_status === 'REVIEWED' ? <Badge tone="good">reviewed</Badge> : null}
              </>
            ),
          }))}
        />
      </Panel>
      <div className="hidden">
        <SeverityBadge severity="NONE" />
      </div>
    </div>
  );
}
