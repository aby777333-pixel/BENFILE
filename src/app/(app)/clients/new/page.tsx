import { redirect } from 'next/navigation';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getStaff } from '@/lib/db/server';
import { hasPermission } from '@/lib/security/permissions';
import { listAdapters } from '@/lib/providers/registry';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badges';
import { IngestForm } from '@/components/client360/ingest-form';

export const dynamic = 'force-dynamic';

export default async function NewVerificationPage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  const { clientId } = await searchParams;
  const { db, staff } = await getStaff();
  if (!staff || !hasPermission(staff.role, 'verification:ingest')) redirect('/dashboard');
  const sample = await readFile(path.join(process.cwd(), 'fixtures', 'india-composite-sample.json'), 'utf8').catch(() => '');
  const sparse = await readFile(path.join(process.cwd(), 'fixtures', 'sparse-sample.json'), 'utf8').catch(() => '');
  const existing = clientId ? (await db.from('clients').select('id,client_code,display_name').eq('id', clientId).maybeSingle()).data : null;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel title={existing ? `Re-verify ${existing.client_code} - ${existing.display_name}` : 'New client verification'} className="xl:col-span-2">
        <IngestForm clientId={existing?.id ?? null} samples={[{ label: 'Load full sample (Rohan Kumar Mehta)', json: sample }, { label: 'Load sparse / stale sample (Priya S. Nair)', json: sparse }]} />
      </Panel>
      <div className="space-y-4">
        <Panel title="Provider adapters">
          <ul className="space-y-2 text-sm">
            {listAdapters().map((a) => (
              <li key={a.key} className="rounded border border-white/[0.06] p-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{a.name}</span>
                  <Badge tone="good">v{a.version}</Badge>
                </div>
                <div className="mono text-[11px] text-ink-400">{a.key} - {a.country}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {a.domains.map((d) => (
                    <Badge key={d} tone="muted">
                      {d}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-ink-500">Pipeline: Provider API - Adapter - Canonical model (Zod-validated) - Rules engines - Snapshot. Adapters auto-detect the payload shape; add a new provider by registering an adapter, no UI changes needed.</p>
        </Panel>
        <Panel title="Machine ingest">
          <p className="text-xs text-ink-300">
            <span className="mono">POST /api/ingest</span> with <span className="mono">{'{ raw, clientId?, consent? }'}</span> as a signed-in staff user. Rate-limited, validated, audited. Webhook ingest via a bearer key activates once the service-role key is configured server-side.
          </p>
        </Panel>
      </div>
    </div>
  );
}
