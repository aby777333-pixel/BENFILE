'use client';
import type { ActionResult } from '@/lib/actions';
import type { AifFundRow, AifSuitabilityRow } from '@/lib/wealth/types';
import { ActionForm } from '@/components/ui/action-form';
import { Badge } from '@/components/ui/badges';
import { AIF_STAGES } from '@/lib/wealth/aif-stages';
export { AIF_STAGES };


export function AifJourney({ suit, funds, rules }: { suit: AifSuitabilityRow | null; funds: AifFundRow[]; rules: Record<string, unknown> }) {
  const idx = suit ? AIF_STAGES.indexOf(suit.stage) : 0;
  const screens = (rules['aif.required_screens'] as string[] | undefined) ?? ['KYC', 'AML', 'SANCTIONS', 'PEP'];
  const docs = (rules['aif.required_documents'] as string[] | undefined) ?? [];
  const min = (rules['aif.min_commitment'] as { amount?: number } | undefined)?.amount;
  const st = (k: string) => {
    const m: Record<string, string | undefined> = { KYC: suit?.kyc_status, AML: suit?.aml_status, SANCTIONS: suit?.sanctions_status, PEP: suit?.pep_status, SOF: suit?.sof_status, SOW: suit?.sow_status, BO: suit?.beneficial_owner_status };
    return m[k] ?? 'PENDING';
  };
  return (
    <section className="panel p-4">
      <h3 className="panel-title">AIF capital path (compliance workflow)</h3>
      <ol className="mt-2 flex flex-wrap gap-1">
        {AIF_STAGES.map((s, i) => (
          <li key={s} className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${i < idx ? 'bg-verified/20 text-emerald-300' : i === idx ? 'bg-gold-500/20 text-gold-300 ring-1 ring-gold-500/40' : 'bg-white/[0.04] text-ink-500'}`}>{s.replace(/_/g, ' ')}</li>
        ))}
      </ol>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <div className="panel-title mb-1">Required screens</div>
          {screens.map((k) => <div key={k} className="flex justify-between border-b border-white/[0.05] py-0.5"><span>{k}</span><Badge tone={st(k) === 'COMPLETE' ? 'good' : st(k) === 'FLAGGED' ? 'bad' : 'muted'}>{st(k)}</Badge></div>)}
          <div className="flex justify-between border-b border-white/[0.05] py-0.5"><span>Source of funds</span><Badge tone={st('SOF') === 'COMPLETE' ? 'good' : 'muted'}>{st('SOF')}</Badge></div>
          <div className="flex justify-between border-b border-white/[0.05] py-0.5"><span>Source of wealth</span><Badge tone={st('SOW') === 'COMPLETE' ? 'good' : 'muted'}>{st('SOW')}</Badge></div>
          <div className="flex justify-between border-b border-white/[0.05] py-0.5"><span>Beneficial ownership</span><Badge tone={st('BO') === 'COMPLETE' ? 'good' : 'muted'}>{st('BO')}</Badge></div>
          <div className="flex justify-between border-b border-white/[0.05] py-0.5"><span>Bank verified</span><Badge tone={suit?.bank_verified ? 'good' : 'muted'}>{suit?.bank_verified ? 'YES' : 'PENDING'}</Badge></div>
        </div>
        <div>
          <div className="panel-title mb-1">Status</div>
          <dl className="kv">
            <dt>Classification</dt><dd>{suit?.investor_classification ?? 'Not assessed'}</dd>
            <dt>Risk profile</dt><dd>{suit?.risk_profile ?? 'Not set'} {suit?.risk_profile_basis ? <span className="text-ink-500">({suit.risk_profile_basis})</span> : null}</dd>
            <dt>Horizon / liquidity</dt><dd>{suit?.horizon ?? '-'} / {suit?.liquidity_needs ?? '-'}</dd>
            <dt>Expected amount</dt><dd>{suit?.expected_amount ? `INR ${suit.expected_amount.toLocaleString('en-IN')}` : 'Not stated'}{min && suit?.expected_amount && suit.expected_amount < min ? <span className="ml-1 text-amber-300">below configured minimum INR {min.toLocaleString('en-IN')}</span> : null}</dd>
            <dt>Risk acknowledged</dt><dd>{suit?.risk_acknowledged ? 'Yes' : 'No'}</dd>
            <dt>Documents executed</dt><dd>{suit?.documents_executed ? 'Yes' : 'No'}</dd>
            <dt>Compliance approval</dt><dd>{suit?.compliance_approved_at ? <Badge tone="good">Approved {suit.compliance_approved_at.slice(0, 10)}</Badge> : <Badge tone="muted">Pending human approval</Badge>}</dd>
            <dt>Investment approval</dt><dd>{suit?.investment_approved_at ? <Badge tone="good">Approved {suit.investment_approved_at.slice(0, 10)}</Badge> : <Badge tone="muted">Pending</Badge>}</dd>
            <dt>Fund</dt><dd>{funds.find((f) => f.id === suit?.fund_id)?.name ?? 'Not selected'}</dd>
          </dl>
          <div className="mt-1 text-[10.5px] text-ink-500">Required documents (config): {docs.join(', ')}</div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-ink-500">Rules engine (deterministic, versioned) gates approvals. AI never overrides compliance. Final suitability, AML/PEP escalation and investment approval are human approval gates.</p>
    </section>
  );
}

export function SuitabilityForm({ clientId, suit, funds, canApprove, staff, action }: { clientId: string; suit: AifSuitabilityRow | null; funds: AifFundRow[]; canApprove: boolean; staff: Array<{ user_id: string; full_name: string }>; action: (fd: FormData) => Promise<ActionResult> }) {
  const status = (name: string, v?: string) => (
    <select name={name} className="input py-1 text-xs" defaultValue={v ?? 'PENDING'}>
      {['PENDING', 'IN_PROGRESS', 'COMPLETE', 'FLAGGED'].map((s) => <option key={s}>{s}</option>)}
    </select>
  );
  void staff;
  return (
    <section className="panel p-4">
      <h3 className="panel-title">Update suitability & journey</h3>
      <ActionForm action={action} resetOnSuccess={false}>
        <input type="hidden" name="clientId" value={clientId} />
        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
          <label><span className="label">Stage</span><select name="stage" className="input py-1 text-xs" defaultValue={suit?.stage ?? 'CLIENT_INTELLIGENCE'}>{AIF_STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></label>
          <label><span className="label">Investor classification</span><select name="classification" className="input py-1 text-xs" defaultValue={suit?.investor_classification ?? ''}><option value="">Not assessed</option>{['INDIVIDUAL', 'HNI', 'ACCREDITED', 'INSTITUTIONAL'].map((s) => <option key={s}>{s}</option>)}</select></label>
          <label><span className="label">Risk profile (questionnaire result)</span><select name="riskProfile" className="input py-1 text-xs" defaultValue={suit?.risk_profile ?? ''}><option value="">Not set</option>{['Conservative', 'Moderately Conservative', 'Balanced', 'Growth-Oriented', 'Aggressive'].map((s) => <option key={s}>{s}</option>)}</select></label>
          <label><span className="label">Horizon</span><input name="horizon" className="input py-1 text-xs" defaultValue={suit?.horizon ?? ''} placeholder="e.g. 5-10 years" /></label>
          <label><span className="label">Liquidity needs</span><input name="liquidityNeeds" className="input py-1 text-xs" defaultValue={suit?.liquidity_needs ?? ''} /></label>
          <label><span className="label">Expected amount (INR)</span><input name="expectedAmount" type="number" className="input py-1 text-xs" defaultValue={suit?.expected_amount ?? ''} /></label>
          <label><span className="label">KYC</span>{status('kyc_status', suit?.kyc_status)}</label>
          <label><span className="label">AML</span>{status('aml_status', suit?.aml_status)}</label>
          <label><span className="label">Sanctions</span>{status('sanctions_status', suit?.sanctions_status)}</label>
          <label><span className="label">PEP</span>{status('pep_status', suit?.pep_status)}</label>
          <label><span className="label">Source of funds</span>{status('sof_status', suit?.sof_status)}</label>
          <label><span className="label">Source of wealth</span>{status('sow_status', suit?.sow_status)}</label>
          <label><span className="label">Beneficial ownership</span>{status('beneficial_owner_status', suit?.beneficial_owner_status)}</label>
          <label><span className="label">Fund</span><select name="fundId" className="input py-1 text-xs" defaultValue={suit?.fund_id ?? ''}><option value="">None</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label><span className="label">Commitment (INR)</span><input name="commitment" type="number" className="input py-1 text-xs" defaultValue={suit?.commitment_amount ?? ''} /></label>
          <div className="flex flex-col gap-1 pt-4">
            <label className="flex items-center gap-1"><input type="checkbox" name="bankVerified" defaultChecked={suit?.bank_verified} /> Bank verified</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="riskAck" defaultChecked={suit?.risk_acknowledged} /> Risk acknowledged</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="docsExecuted" defaultChecked={suit?.documents_executed} /> Documents executed</label>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <button className="btn btn-sm btn-primary" name="approve" value="">Save</button>
          {canApprove ? <button className="btn btn-sm" name="approve" value="COMPLIANCE">Compliance approval</button> : null}
          {canApprove ? <button className="btn btn-sm" name="approve" value="INVESTMENT">Investment approval</button> : null}
        </div>
        <p className="mt-1 text-[10.5px] text-ink-500">Approvals are blocked until KYC, AML, sanctions and source-of-funds are COMPLETE and a risk profile exists. Human approval only.</p>
      </ActionForm>
    </section>
  );
}
