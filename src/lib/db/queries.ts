import type { Assessment, CanonicalProfile } from '@/lib/canonical/types';
import type { Db } from './server';

export interface ClientRow {
  id: string;
  client_code: string;
  display_name: string;
  country: string;
  status: string;
  review_status: string;
  risk_level: string;
  credit_band: string | null;
  employment_status: string | null;
  occupation: string | null;
  city: string | null;
  completeness: number | null;
  freshness: string | null;
  latest_run_id: string | null;
  last_verified_at: string | null;
  consent_status: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunRow {
  id: string;
  run_seq: number;
  provider_key: string;
  adapter_version: string;
  engine_version: string | null;
  verification_id: string;
  reference_id: string | null;
  status: string;
  requested_at: string | null;
  completed_at: string | null;
  snapshot_label: string | null;
  canonical: CanonicalProfile;
  assessment: Assessment | null;
  warnings: string[];
  ingested_at: string;
}

export interface SignalRow {
  id: string;
  fingerprint: string;
  rule_key: string;
  category: string;
  severity: string;
  origin: string;
  source_key: string;
  title: string;
  explanation: string;
  evidence: Array<{ label: string; sourceKey: string; path?: string | null; value?: string | null }>;
  detected_at: string | null;
  updated_at: string;
  status: string;
  requires_review: boolean;
  reviewer_id: string | null;
  reviewer_notes: string | null;
  reviewed_at: string | null;
}

export interface Client360 {
  client: ClientRow;
  run: RunRow | null;
  runs: Array<Pick<RunRow, 'id' | 'run_seq' | 'snapshot_label' | 'status' | 'completed_at' | 'ingested_at' | 'provider_key' | 'verification_id'>>;
  signals: SignalRow[];
  consents: Array<{ id: string; status: string; purpose: string; purpose_code: string; granted_at: string | null; expires_at: string | null; sources_authorized: string[]; provider_key: string | null; consent_reference: string | null }>;
  cases: Array<{ id: string; case_code: string; title: string; status: string; priority: string; assigned_to: string | null; opened_at: string; assignee?: { full_name: string } | null }>;
  staff: Array<{ user_id: string; full_name: string; role: string }>;
  sensitive: {
    documents: Array<{ doc_type: string; number_masked: string | null; sensitive_value_id: string | null; name_on_document: string | null; subtype: string | null; status: string | null; aadhaar_linked: boolean | null; source_key: string; tier: number; evidence_path: string | null; retrieved_at: string | null; assertion: string }>;
    phones: Array<{ number_masked: string; sensitive_value_id: string | null; phone_type: string | null; source_key: string; tier: number; evidence_path: string | null }>;
    emails: Array<{ email_masked: string; sensitive_value_id: string | null; source_key: string; tier: number; evidence_path: string | null }>;
    banks: Array<{ account_masked: string | null; sensitive_value_id: string | null; ifsc: string | null; bank_name: string | null; branch: string | null; account_type: string | null; holder_name: string | null; verified: boolean | null; source_key: string; tier: number; evidence_path: string | null }>;
    epfo: { uan_masked: string | null; uan_sensitive_value_id: string | null; member_id_masked: string | null; member_id_sensitive_value_id: string | null } | null;
  };
}

export async function getClient360(db: Db, id: string): Promise<Client360 | null> {
  const { data: client } = await db.from('clients').select('*').eq('id', id).maybeSingle();
  if (!client) return null;
  const [{ data: run }, { data: runs }, { data: signals }, { data: consents }, { data: cases }, { data: staff }] = await Promise.all([
    client.latest_run_id ? db.from('verification_runs').select('*').eq('id', client.latest_run_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('verification_runs').select('id,run_seq,snapshot_label,status,completed_at,ingested_at,provider_key,verification_id').eq('client_id', id).order('run_seq', { ascending: false }),
    db.from('risk_signals').select('*').eq('client_id', id).order('severity', { ascending: false }).order('updated_at', { ascending: false }),
    db.from('consents').select('id,status,purpose,purpose_code,granted_at,expires_at,sources_authorized,provider_key,consent_reference').eq('client_id', id).order('created_at', { ascending: false }),
    db.from('cases').select('id,case_code,title,status,priority,assigned_to,opened_at,assignee:staff_profiles!cases_assigned_to_fkey(full_name)').eq('client_id', id).order('opened_at', { ascending: false }),
    db.from('staff_profiles').select('user_id,full_name,role').eq('is_active', true).order('full_name'),
  ]);
  const runId = client.latest_run_id;
  const [{ data: documents }, { data: phones }, { data: emails }, { data: banks }, { data: epfo }] = runId
    ? await Promise.all([
        db.from('identity_documents').select('doc_type,number_masked,sensitive_value_id,name_on_document,subtype,status,aadhaar_linked,source_key,tier,evidence_path,retrieved_at,assertion').eq('run_id', runId),
        db.from('phone_numbers').select('number_masked,sensitive_value_id,phone_type,source_key,tier,evidence_path').eq('run_id', runId),
        db.from('emails').select('email_masked,sensitive_value_id,source_key,tier,evidence_path').eq('run_id', runId),
        db.from('bank_accounts').select('account_masked,sensitive_value_id,ifsc,bank_name,branch,account_type,holder_name,verified,source_key,tier,evidence_path').eq('run_id', runId),
        db.from('epfo_records').select('uan_masked,uan_sensitive_value_id,member_id_masked,member_id_sensitive_value_id').eq('run_id', runId).maybeSingle(),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: null }];
  return {
    client: client as ClientRow,
    run: (run as RunRow | null) ?? null,
    runs: (runs ?? []) as Client360['runs'],
    signals: (signals ?? []) as SignalRow[],
    consents: (consents ?? []) as Client360['consents'],
    cases: ((cases ?? []) as unknown[]).map((c) => {
      const row = c as Record<string, unknown>;
      const a = row.assignee;
      return { ...(row as object), assignee: Array.isArray(a) ? (a[0] as { full_name: string } | undefined) ?? null : (a as { full_name: string } | null) } as Client360['cases'][number];
    }),
    staff: (staff ?? []) as Client360['staff'],
    sensitive: {
      documents: (documents ?? []) as Client360['sensitive']['documents'],
      phones: (phones ?? []) as Client360['sensitive']['phones'],
      emails: (emails ?? []) as Client360['sensitive']['emails'],
      banks: (banks ?? []) as Client360['sensitive']['banks'],
      epfo: (epfo as Client360['sensitive']['epfo']) ?? null,
    },
  };
}

export interface ClientSearch {
  q?: string;
  status?: string;
  risk?: string;
  credit?: string;
  employment?: string;
  completeness?: string;
  freshness?: string;
  review?: string;
  assigned?: string;
}

export async function searchClients(db: Db, s: ClientSearch, extraIds?: string[] | null): Promise<ClientRow[]> {
  let q = db.from('clients').select('*').neq('status', 'ARCHIVED').order('updated_at', { ascending: false }).limit(200);
  if (extraIds && extraIds.length) q = q.in('id', extraIds);
  else if (s.q) q = q.or(`display_name.ilike.%${s.q}%,client_code.ilike.%${s.q}%,search_text.ilike.%${s.q}%`);
  if (s.status) q = q.eq('status', s.status);
  if (s.risk) q = q.eq('risk_level', s.risk);
  if (s.credit) q = q.eq('credit_band', s.credit);
  if (s.employment) q = q.eq('employment_status', s.employment);
  if (s.freshness) q = q.eq('freshness', s.freshness);
  if (s.review) q = q.eq('review_status', s.review);
  if (s.assigned) q = q.eq('assigned_to', s.assigned);
  if (s.completeness === 'incomplete') q = q.lt('completeness', 0.75);
  if (s.completeness === 'complete') q = q.gte('completeness', 0.75);
  const { data } = await q;
  return (data ?? []) as ClientRow[];
}
