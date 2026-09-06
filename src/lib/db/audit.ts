import type { Db } from './server';
import { log } from '@/lib/security/logger';

export interface AuditInput {
  action: string;
  clientId?: string | null;
  entityTable?: string | null;
  entityId?: string | null;
  fieldKey?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** Writes an append-only audit row through the SECURITY DEFINER RPC. Never throws to the caller. */
export async function audit(db: Db, input: AuditInput): Promise<void> {
  const { error } = await db.rpc('log_audit', {
    p_action: input.action,
    p_client_id: input.clientId ?? null,
    p_entity_table: input.entityTable ?? null,
    p_entity_id: input.entityId ?? null,
    p_field_key: input.fieldKey ?? null,
    p_details: input.details ?? {},
    p_ip: input.ip ?? null,
    p_ua: input.userAgent ?? null,
  });
  if (error) log.error('audit.write_failed', { action: input.action, error: error.message });
}
