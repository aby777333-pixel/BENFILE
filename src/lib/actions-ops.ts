'use server';
/**
 * Operational server actions: compliance configuration (rules + freshness windows) and RM tasks.
 * Same discipline as actions.ts: authenticate, permission-check, write under RLS, audit, revalidate.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { audit } from '@/lib/db/audit';
import { getStaff } from '@/lib/db/server';
import { hasPermission, type Permission } from '@/lib/security/permissions';
import type { ActionResult } from '@/lib/actions';

async function guard(perm: Permission) {
  const { db, staff } = await getStaff();
  if (!staff) throw new Error('Not signed in');
  if (!hasPermission(staff.role, perm)) throw new Error(`Your role does not have ${perm}`);
  return { db, staff };
}
const wrap = async (fn: () => Promise<string | void>): Promise<ActionResult> => {
  try {
    const m = await fn();
    return { ok: true, message: m ?? undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
};
const optStr = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : String(v));

/** Replace a compliance rule's JSON value. Every regulatory threshold is configuration-driven; changes are versioned and audited. */
export async function updateComplianceRule(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const key = z.string().min(3).max(80).regex(/^[a-z0-9_.-]+$/i).parse(form.get('key'));
    const raw = z.string().min(1).max(4000).parse(form.get('valueJson'));
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('Value must be valid JSON (for example {"pct": 5} or ["PAN","AADHAAR"]).');
    }
    if (value === null || typeof value !== 'object') throw new Error('Value must be a JSON object or array.');
    const { db, staff } = await guard('scoring:configure');
    const { data: current, error: readErr } = await db.from('compliance_rules').select('key,value,version').eq('key', key).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error('Unknown rule key');
    const description = optStr(form.get('description'));
    const nextVersion = Number(current.version ?? 1) + 1;
    const patch: Record<string, unknown> = { value, version: nextVersion, updated_by: staff.userId, updated_at: new Date().toISOString() };
    if (description !== null) patch.description = description;
    const { error } = await db.from('compliance_rules').update(patch).eq('key', key);
    if (error) throw new Error(error.message);
    await audit(db, { action: 'compliance.rule_change', entityTable: 'compliance_rules', entityId: key, fieldKey: key, details: { previous: current.value, next: value, version: nextVersion } });
    revalidatePath('/aif');
    revalidatePath('/inventory');
    return `Rule ${key} updated to version ${nextVersion}.`;
  });
}

/** Update a freshness window (fresh < stale < expired, all in days). */
export async function updateFreshnessWindow(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const dataClass = z.string().min(2).max(60).regex(/^[A-Z0-9_]+$/).parse(form.get('dataClass'));
    const days = z.coerce.number().int().min(1).max(3650);
    const fresh = days.parse(form.get('fresh'));
    const stale = days.parse(form.get('stale'));
    const expired = days.parse(form.get('expired'));
    if (!(fresh < stale && stale < expired)) throw new Error('Windows must satisfy fresh < stale < expired.');
    const { db } = await guard('scoring:configure');
    const { data: current, error: readErr } = await db.from('freshness_windows').select('data_class,fresh_days,stale_days,expired_days').eq('data_class', dataClass).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error('Unknown data class');
    const { error } = await db.from('freshness_windows').update({ fresh_days: fresh, stale_days: stale, expired_days: expired }).eq('data_class', dataClass);
    if (error) throw new Error(error.message);
    await audit(db, { action: 'compliance.freshness_change', entityTable: 'freshness_windows', entityId: dataClass, details: { previous: { fresh: current.fresh_days, stale: current.stale_days, expired: current.expired_days }, next: { fresh, stale, expired } } });
    revalidatePath('/aif');
    return `Freshness window ${dataClass} updated.`;
  });
}

/** Create a task for the signed-in staff member (or another assignee). Client is optional. */
export async function createRmTask(form: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const { db, staff } = await guard('notes:write');
    const clientId = optStr(form.get('clientId'));
    const assignedTo = optStr(form.get('assignedTo'));
    const { error } = await db.from('tasks').insert({
      client_id: clientId ? z.string().uuid().parse(clientId) : null,
      title: z.string().min(3).max(200).parse(form.get('title')),
      task_type: z.enum(['FOLLOW_UP', 'CALL', 'MEETING', 'DOCUMENT_REQUEST', 'REVERIFY', 'SITE_VISIT', 'PROPOSAL', 'KYC', 'REVIEW']).parse(form.get('taskType') ?? 'FOLLOW_UP'),
      due_at: optStr(form.get('dueAt')) ? new Date(String(form.get('dueAt'))).toISOString() : null,
      assigned_to: assignedTo ? z.string().uuid().parse(assignedTo) : staff.userId,
      priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).parse(form.get('priority') ?? 'NORMAL'),
      source: 'MANUAL',
      reason: optStr(form.get('reason')),
      created_by: staff.userId,
    });
    if (error) throw new Error(error.message);
    revalidatePath('/rm');
    if (clientId) revalidatePath(`/clients/${clientId}`, 'layout');
    return 'Task created';
  });
}
