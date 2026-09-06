'use client';
import { useState } from 'react';
import { saveScoringConfig, updateStaffRole } from '@/lib/actions';
import { ActionForm } from '@/components/ui/action-form';

const KEYS = [
  ['identity', 'Identity confidence'],
  ['employment', 'Employment stability'],
  ['credit', 'Credit indicator'],
  ['contact', 'Contact verification'],
  ['completeness', 'Data completeness'],
  ['risk', 'Risk signals'],
] as const;

export function ScoringForm({ current }: { current: Record<string, number> }) {
  const [w, setW] = useState<Record<string, number>>(Object.fromEntries(KEYS.map(([k]) => [k, Math.round((current[k] ?? 0) * 100)])));
  const total = Object.values(w).reduce((s, v) => s + v, 0);
  return (
    <ActionForm action={saveScoringConfig} resetOnSuccess={false}>
      <div className="grid gap-2 sm:grid-cols-2">
        {KEYS.map(([k, label]) => (
          <label key={k} className="text-xs">
            <span className="label">{label}</span>
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={50} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="flex-1" />
              <input type="number" name={k} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="input w-16 py-1" />
            </div>
          </label>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <span className={total === 100 ? 'text-emerald-300' : 'text-red-300'}>Total {total}%</span>
        <input name="version" className="input w-40" placeholder="score-1.1" required />
        <input name="notes" className="input flex-1" placeholder="Why this change?" />
        <button className="btn btn-primary" disabled={total !== 100}>
          Activate version
        </button>
      </div>
    </ActionForm>
  );
}

export function StaffRoleForm({ userId, role, isActive, disabled }: { userId: string; role: string; isActive: boolean; disabled: boolean }) {
  return (
    <ActionForm action={updateStaffRole} className="flex items-center gap-1" resetOnSuccess={false} confirm="Change this user's role/access? This is audit-logged.">
      <input type="hidden" name="userId" value={userId} />
      <select name="role" defaultValue={role} className="input w-44 py-1 text-xs" disabled={disabled}>
        {['SUPER_ADMIN', 'COMPLIANCE_OFFICER', 'SENIOR_ANALYST', 'ANALYST', 'RELATIONSHIP_MANAGER', 'AUDITOR'].map((r) => (
          <option key={r} value={r}>
            {r.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" name="isActive" defaultChecked={isActive} disabled={disabled} /> active
      </label>
      <button className="btn btn-sm" disabled={disabled}>
        Save
      </button>
    </ActionForm>
  );
}
