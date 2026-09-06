import { NextResponse, type NextRequest } from 'next/server';
import { audit } from '@/lib/db/audit';
import { getStaff } from '@/lib/db/server';

/** GET /api/documents/:id/url - short-lived signed URL for a document or photo the caller is allowed to read (RLS). Audited. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { db, staff } = await getStaff();
  if (!staff) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let row = (await db.from('client_documents').select('id,client_id,storage_bucket,storage_path,doc_type').eq('id', id).maybeSingle()).data as { id: string; client_id: string; storage_bucket: string; storage_path: string | null; doc_type: string } | null;
  let kind = 'document';
  if (!row) {
    const ph = (await db.from('client_photos').select('id,client_id,storage_bucket,storage_path,purpose').eq('id', id).maybeSingle()).data;
    if (ph) { row = { id: ph.id, client_id: ph.client_id, storage_bucket: ph.storage_bucket, storage_path: ph.storage_path, doc_type: ph.purpose }; kind = 'photo'; }
  }
  if (!row || !row.storage_path) return NextResponse.json({ error: 'not found or not permitted' }, { status: 404 });
  const { data, error } = await db.storage.from(row.storage_bucket).createSignedUrl(row.storage_path, 120);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await audit(db, { action: `${kind}.view`, clientId: row.client_id, entityTable: kind === 'photo' ? 'client_photos' : 'client_documents', entityId: row.id, details: { docType: row.doc_type } });
  return NextResponse.json({ url: data.signedUrl }, { headers: { 'Cache-Control': 'no-store' } });
}
