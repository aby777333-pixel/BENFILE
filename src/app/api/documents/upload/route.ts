import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { audit } from '@/lib/db/audit';
import { getStaff } from '@/lib/db/server';
import { hasPermission } from '@/lib/security/permissions';
import { rateLimit } from '@/lib/security/rate-limit';
import { classifyByName, consistencyChecks, docTypeMeta, maskDocNumber, parseStructured, qualitySignals, refreshDue } from '@/lib/wealth/documents-engine';
import { hashIdentifier } from '@/lib/security/masking';
import type { CanonicalProfile } from '@/lib/canonical/types';

export const runtime = 'nodejs';

/**
 * POST /api/documents/upload (multipart): file + clientId + docType + optional fields.
 * Pipeline: classify -> hash -> store (private bucket) -> parse structured -> consistency vs Client 360 ->
 * duplicate / quality signals -> expiry -> record. Sensitive numbers go to sensitive_values via RPC.
 */
export async function POST(req: NextRequest) {
  const { db, staff } = await getStaff();
  if (!staff) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!hasPermission(staff.role, 'documents:request') && !hasPermission(staff.role, 'clients:write')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!rateLimit(`upload:${staff.userId}`, 60, 10 * 60_000).ok) return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  const form = await req.formData();
  const file = form.get('file');
  const clientId = String(form.get('clientId') ?? '');
  if (!(file instanceof File) || !clientId) return NextResponse.json({ error: 'file and clientId are required' }, { status: 400 });
  if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: 'file exceeds 50 MB' }, { status: 413 });
  const isPhoto = form.get('purpose') === 'PHOTO';
  const docType = isPhoto ? 'PHOTOGRAPH' : String(form.get('docType') || classifyByName(file.name));
  const meta = docTypeMeta(docType);
  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const bucket = isPhoto ? 'client-photos' : 'client-documents';
  const path = `${clientId}/${Date.now()}-${docType.toLowerCase()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: upErr } = await db.storage.from(bucket).upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (upErr) return NextResponse.json({ error: `storage: ${upErr.message}` }, { status: 500 });

  if (isPhoto) {
    await db.from('client_photos').update({ is_current: false }).eq('client_id', clientId).eq('purpose', String(form.get('photoPurpose') ?? 'PROFILE'));
    const { data, error } = await db.from('client_photos').insert({ client_id: clientId, purpose: String(form.get('photoPurpose') ?? 'PROFILE'), storage_bucket: bucket, storage_path: path, mime_type: file.type, size_bytes: file.size, sha256, quality: { sizeBytes: file.size, mime: file.type, note: 'Operational checks only; appearance is never analysed for profiling.' }, uploaded_by: staff.userId, upload_source: 'STAFF' }).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(db, { action: 'photo.upload', clientId, entityTable: 'client_photos', entityId: data.id, details: { purpose: form.get('photoPurpose') } });
    return NextResponse.json({ id: data.id, path });
  }

  const { data: existing } = await db.from('client_documents').select('id,sha256').eq('client_id', clientId).not('sha256', 'is', null);
  const existingShas = new Map((existing ?? []).map((d) => [d.sha256 as string, d.id as string]));
  const text = /^(application\/json|text\/)/.test(file.type) || /\.(json|csv|txt)$/i.test(file.name) ? buf.toString('utf8').slice(0, 200_000) : null;
  const parsed = parseStructured(file.type, file.name, text);
  const { quality, tamper, duplicateOf } = qualitySignals({ mime: file.type, size: file.size, name: file.name, sha256, existingShas });

  const { data: client } = await db.from('clients').select('latest_run_id').eq('id', clientId).single();
  const run = client?.latest_run_id ? (await db.from('verification_runs').select('canonical').eq('id', client.latest_run_id).maybeSingle()).data : null;
  const p = run?.canonical as CanonicalProfile | undefined;
  const nameOnDoc = String(form.get('nameOnDocument') || '') || null;
  const dobOnDoc = String(form.get('dobOnDocument') || '') || null;
  const addrOnDoc = String(form.get('addressOnDocument') || '') || null;
  const consistency = p ? consistencyChecks(docType, parsed, { name_on_document: nameOnDoc, dob_on_document: dobOnDoc, address_on_document: addrOnDoc }, { fullName: p.person.fullName.value, dob: p.person.dateOfBirth.value, addresses: p.addresses.map((a) => a.fullAddress ?? '').filter(Boolean), bankHolderName: p.bankAccounts[0]?.accountHolderName ?? null }) : [];
  const number = String(form.get('documentNumber') || '') || (parsed?.number as string | undefined) || null;
  let sensitiveId: string | null = null;
  if (number && meta.sensitiveKind && hasPermission(staff.role, 'verification:ingest')) {
    const { data: sid } = await db.rpc('store_sensitive', { p_client_id: clientId, p_run_id: null, p_kind: meta.sensitiveKind, p_entity_table: 'client_documents', p_field_key: docType, p_value_full: number, p_value_hash: hashIdentifier(meta.sensitiveKind, number) });
    sensitiveId = (sid as string) ?? null;
  }
  const expiry = String(form.get('expiryDate') || '') || (parsed?.expiryDate as string | undefined) || null;
  const uploadedAt = new Date().toISOString();
  const fresh = refreshDue(docType, uploadedAt, expiry);
  const { data, error } = await db.from('client_documents').insert({
    client_id: clientId, room: String(form.get('room') || meta.room), doc_type: docType, title: String(form.get('title') || file.name), storage_bucket: bucket, storage_path: path, mime_type: file.type, size_bytes: file.size, sha256,
    number_masked: maskDocNumber(docType, number), sensitive_value_id: sensitiveId, issue_date: String(form.get('issueDate') || '') || (parsed?.issueDate as string | undefined) || null, expiry_date: expiry, issuing_authority: String(form.get('issuingAuthority') || '') || (parsed?.issuingAuthority as string | undefined) || null,
    name_on_document: nameOnDoc ?? (parsed?.name as string | undefined) ?? null, dob_on_document: dobOnDoc ?? (parsed?.dob as string | undefined) ?? null, address_on_document: addrOnDoc ?? (parsed?.address as string | undefined) ?? null,
    extracted: parsed ? Object.fromEntries(Object.entries(parsed).filter(([k]) => !['number', 'raw'].includes(k))) : {}, extraction_status: parsed ? 'PARSED' : nameOnDoc || dobOnDoc ? 'MANUAL' : 'PENDING', classification: { docType, byName: classifyByName(file.name), chosenByUser: !!form.get('docType') }, quality, tamper_signals: tamper, consistency,
    status: tamper.some((t) => t.signal === 'TINY_FILE') ? 'UNREADABLE' : fresh.flag === 'EXPIRED' ? 'EXPIRED' : parsed || nameOnDoc ? 'EXTRACTED' : 'EXTRACTION_PENDING', review_status: 'PENDING', access_level: meta.access, evidence_class: 'CLIENT_DECLARED', upload_source: 'STAFF', uploaded_by: staff.userId, uploaded_at: uploadedAt, duplicate_of: duplicateOf, refresh_due_on: fresh.refreshDueOn,
  }).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await db.from('intelligence_events').insert({ client_id: clientId, event_type: 'DOCUMENT_UPLOADED', title: `${meta.label} uploaded`, detail: `${consistency.filter((c) => c.status === 'MISMATCH').length} mismatch(es), ${tamper.length} signal(s)`, source_key: 'DOCUMENTS', actor_id: staff.userId });
  await audit(db, { action: 'document.upload', clientId, entityTable: 'client_documents', entityId: data.id, details: { docType, size: file.size, parsed: !!parsed, tamper: tamper.length } });
  return NextResponse.json({ id: data.id, docType, consistency, tamper, duplicateOf, extraction: parsed ? 'PARSED' : 'PENDING' });
}
