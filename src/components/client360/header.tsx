import Link from 'next/link';
import { Download, RefreshCw } from 'lucide-react';
import type { Client360 } from '@/lib/db/queries';
import { formatDate, formatINR, formatTenure, monthsBetween } from '@/lib/engines/normalize';
import { hasPermission, type StaffRole } from '@/lib/security/permissions';
import { Badge, FreshnessPill, SeverityBadge, StatusBadge } from '@/components/ui/badges';
import { Stat } from '@/components/ui/panel';
import { exportReport } from '@/lib/actions';

export function Client360Header({ data, role }: { data: Client360; role: StaffRole }) {
  const { client, run, signals } = data;
  const p = run?.canonical;
  const a = run?.assessment;
  const current = p?.employment.records.find((r) => r.status === 'CURRENT');
  const tenure = current ? monthsBetween(current.joiningDate) : null;
  const initials = client.display_name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const openReview = signals.filter((s) => s.requires_review && !['DISMISSED', 'RESOLVED', 'REVIEWED'].includes(s.status)).length;
  const canFinancial = hasPermission(role, 'financial:read');
  return (
    <header className="panel p-4 md:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-gold-500/30 bg-gradient-to-br from-gold-500/20 to-transparent text-xl font-bold text-gold-300" title="Photograph not available from any lawful source; initials shown.">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{client.display_name}</h1>
              <StatusBadge status={client.status} />
              <SeverityBadge severity={client.risk_level} />
              {openReview ? (
                <Badge tone="warn" className="blink">
                  {openReview} needs review
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-300">
              <span className="mono">{client.client_code}</span>
              {run?.reference_id ? <span>Ref {run.reference_id}</span> : null}
              {run ? <span>Verification {run.verification_id}</span> : null}
              <span>
                Verification status: <span className="text-ink-100">{run?.status ?? 'none'}</span>
              </span>
              <span>Last verified {formatDate(client.last_verified_at)}</span>
              <span>
                Consent: <span className={client.consent_status === 'GRANTED' ? 'text-emerald-300' : 'text-amber-300'}>{client.consent_status}</span>
              </span>
            </div>
          </div>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          {hasPermission(role, 'verification:ingest') ? (
            <Link href={`/clients/new?clientId=${client.id}`} className="btn">
              <RefreshCw size={14} /> Re-verify
            </Link>
          ) : null}
          {hasPermission(role, 'reports:export') ? (
            <form action={exportReport}>
              <input type="hidden" name="clientId" value={client.id} />
              <button className="btn btn-primary">
                <Download size={14} /> Export report
              </button>
            </form>
          ) : null}
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Age" value={p?.person.age.value ?? 'N/A'} sub={p?.person.dateOfBirth.value ? `DOB ${formatDate(p.person.dateOfBirth.value)}` : undefined} />
        <Stat label="Occupation" value={p?.person.occupation.value ?? 'N/A'} />
        <Stat label="Income" value={canFinancial ? (p?.person.income.value?.amount ? formatINR(p.person.income.value.amount) : 'N/A') : 'Restricted'} sub={canFinancial && p?.person.income.value ? `${p.person.income.value.kind.toLowerCase()} - ${p.person.income.provenance.sourceKey}` : undefined} />
        <Stat label="Credit score" value={canFinancial ? (p?.credit?.score ?? 'N/A') : 'Restricted'} sub={canFinancial && p?.credit ? `${p.credit.bureau ?? 'Bureau'} - ${formatDate(p.credit.scoreDate)}` : undefined} tone={p?.credit?.score ? (p.credit.score >= 750 ? 'good' : p.credit.score >= 650 ? undefined : 'warn') : 'muted'} />
        <Stat label="Employer" value={current?.employer.name ?? (p?.employment.records.length ? 'No current EPFO record' : 'N/A')} sub={tenure !== null ? `Tenure ${formatTenure(tenure)}` : undefined} />
        <Stat label="Location" value={client.city ?? p?.addresses[0]?.city ?? 'N/A'} sub={p?.addresses[0]?.state ?? undefined} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.06] pt-3 text-xs text-ink-300">
        <span>
          Profile status <StatusBadge status={a?.overall.profileStatus ?? client.status} />
        </span>
        <span>
          Overall risk <SeverityBadge severity={a?.overall.riskLevel ?? 'NONE'} />
        </span>
        <span>
          Completeness <span className="mono text-ink-100">{a ? `${Math.round(a.overall.completeness * 100)}%` : 'N/A'}</span>
        </span>
        <span>
          Freshness <FreshnessPill freshness={a?.overall.freshness ?? 'UNKNOWN'} />
        </span>
        <span>
          Confidence <span className="text-ink-100">{a?.overall.confidence ?? 'N/A'}</span>
        </span>
        <span>
          Profile score <span className="mono text-gold-300">{a?.score.total ?? 'N/A'}</span>
          <span className="text-ink-500"> ({a?.score.configVersion})</span>
        </span>
      </div>
    </header>
  );
}
