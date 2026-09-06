import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/db/server';
import { hasPermission, ROLE_LABEL, ROLE_PERMISSIONS, ROLES } from '@/lib/security/permissions';
import { listAdapters } from '@/lib/providers/registry';
import { listConnectors } from '@/lib/external/orchestrator';
import { TIER_LABEL } from '@/lib/canonical/types';
import { DEFAULT_RISK_CONFIG } from '@/lib/engines/risk';
import { formatDateTime } from '@/lib/engines/normalize';
import { Panel } from '@/components/ui/panel';
import { Badge, ModeBadge } from '@/components/ui/badges';
import { ScoringForm, StaffRoleForm } from '@/components/client360/admin-forms';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const { db, staff } = await getStaff();
  if (!staff) redirect('/login');
  const canScoring = hasPermission(staff.role, 'scoring:configure');
  const canUsers = hasPermission(staff.role, 'users:manage');
  const canRetention = hasPermission(staff.role, 'retention:manage');
  if (!canScoring && !canUsers && !canRetention) redirect('/dashboard');
  const [{ data: configs }, { data: staffList }, { data: retention }] = await Promise.all([db.from('scoring_configs').select('*').order('created_at', { ascending: false }), db.from('staff_profiles').select('*').order('full_name'), db.from('retention_policies').select('*').order('scope')]);
  const active = configs?.find((c) => c.is_active);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Administration</h1>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Explainable scoring - versioned weights" right={active ? <Badge tone="good">active: {active.version}</Badge> : null}>
          {canScoring ? <ScoringForm current={(active?.weights as Record<string, number>) ?? { identity: 0.25, employment: 0.2, credit: 0.2, contact: 0.1, completeness: 0.1, risk: 0.15 }} /> : <p className="text-sm text-ink-400">Read-only for your role.</p>}
          <table className="table mt-4">
            <thead>
              <tr>
                <th>Version</th>
                <th>Weights</th>
                <th>Active</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {configs?.map((c) => (
                <tr key={c.version}>
                  <td className="mono text-xs">{c.version}</td>
                  <td className="mono text-[10.5px] text-ink-300">{Object.entries(c.weights as Record<string, number>).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' - ')}</td>
                  <td>{c.is_active ? <Badge tone="good">Active</Badge> : <Badge tone="muted">Archived</Badge>}</td>
                  <td className="text-xs">{formatDateTime(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink-500">Existing runs keep the config version they were scored with. Credit weight is capped at 30% so the profile score can never become a proxy credit score.</p>
        </Panel>
        <Panel title="Risk rules configuration" right={<Badge tone="muted">{DEFAULT_RISK_CONFIG.version}</Badge>}>
          <dl className="kv">
            <dt>Stale source threshold</dt><dd>{DEFAULT_RISK_CONFIG.staleDays} days</dd>
            <dt>Low employer confidence</dt><dd>below {Math.round(DEFAULT_RISK_CONFIG.lowEmployerConfidence * 100)}%</dd>
            <dt>Poor credit</dt><dd>below {DEFAULT_RISK_CONFIG.poorCreditBelow}</dd>
            <dt>Fair credit</dt><dd>below {DEFAULT_RISK_CONFIG.fairCreditBelow}</dd>
          </dl>
          <p className="mt-2 text-[11px] text-ink-500">Rules live in code (src/lib/engines/risk.ts) and are versioned with the engine. Provider signals are always surfaced verbatim; contradictions create Needs Review.</p>
          <h4 className="panel-title mt-4">Source trust tiers</h4>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-300">
            {Object.entries(TIER_LABEL).map(([t, l]) => (
              <li key={t}>{l}</li>
            ))}
          </ul>
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Staff & roles" right={<Badge tone="muted">{staffList?.length ?? 0}</Badge>}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>E-mail</th>
                <th>Role</th>
                <th>Active</th>
                {canUsers ? <th>Change</th> : null}
              </tr>
            </thead>
            <tbody>
              {staffList?.map((s) => (
                <tr key={s.user_id}>
                  <td className="font-medium">{s.full_name}</td>
                  <td className="text-xs">{s.email}</td>
                  <td><Badge tone="gold">{ROLE_LABEL[s.role as keyof typeof ROLE_LABEL]}</Badge></td>
                  <td>{s.is_active ? <Badge tone="good">Yes</Badge> : <Badge tone="bad">No</Badge>}</td>
                  {canUsers ? <td><StaffRoleForm userId={s.user_id} role={s.role} isActive={s.is_active} disabled={s.user_id === staff.userId} /></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-ink-300">Permission matrix</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Permissions</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLES.map((r) => (
                    <tr key={r}>
                      <td className="whitespace-nowrap">{ROLE_LABEL[r]}</td>
                      <td className="mono text-[10.5px] text-ink-300">{ROLE_PERMISSIONS[r].join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Panel>
        <div className="space-y-4">
          <Panel title="Provider adapters & external connectors">
            <ul className="space-y-1 text-xs">
              {listAdapters().map((a) => (
                <li key={a.key} className="flex items-center justify-between border-b border-white/[0.05] py-1">
                  <span>{a.name} <span className="mono text-ink-500">{a.key}</span></span>
                  <Badge tone="good">Live adapter v{a.version}</Badge>
                </li>
              ))}
              {listConnectors().map((c) => (
                <li key={c.key} className="flex items-center justify-between border-b border-white/[0.05] py-1">
                  <span>{c.name} <span className="mono text-ink-500">T{c.tier} - needs {c.requiresConsentFor.join('/')}</span></span>
                  <ModeBadge mode={c.mode} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-500">Sandbox connectors are placeholders implementing the connector interface (searchPerson, verifyIdentity, searchCompanies, searchDirectorships, searchEmployment, searchLegalRecords, searchMedia, searchProfessionalProfiles, searchPublicSocialProfiles, searchSanctions, searchAssets, refreshProfile). Replace with licensed APIs without touching the UI.</p>
          </Panel>
          <Panel title="Retention policies" right={<Badge tone="muted">{retention?.length ?? 0}</Badge>}>
            <table className="table">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Retain</th>
                  <th>Action</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {retention?.map((r) => (
                  <tr key={r.id}>
                    <td className="mono text-xs">{r.scope}</td>
                    <td className="mono text-xs">{r.retain_days} d</td>
                    <td><Badge tone={r.action === 'DELETE' ? 'bad' : 'warn'}>{r.action}</Badge></td>
                    <td className="text-xs text-ink-300">{r.basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-ink-500">Deletion and anonymisation workflows run against these policies plus consent expiry, purpose expiry and case closure. Collected data is never kept merely because it was obtainable.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
