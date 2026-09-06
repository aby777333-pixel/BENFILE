import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/db/server';
import { searchClients, type ClientSearch } from '@/lib/db/queries';
import { audit } from '@/lib/db/audit';
import { hashIdentifier, type SensitiveKind } from '@/lib/security/masking';
import { formatDate } from '@/lib/engines/normalize';
import { Panel, Empty } from '@/components/ui/panel';
import { Badge, FreshnessPill, SeverityBadge, StatusBadge } from '@/components/ui/badges';

export const dynamic = 'force-dynamic';

const SEL = (name: string, label: string, opts: string[], current?: string) => (
  <label className="text-xs">
    <span className="label">{label}</span>
    <select name={name} defaultValue={current ?? ''} className="input py-1.5">
      <option value="">Any</option>
      {opts.map((o) => (
        <option key={o} value={o}>
          {o.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  </label>
);

export default async function ClientsPage({ searchParams }: { searchParams: Promise<ClientSearch & { by?: string }> }) {
  const sp = await searchParams;
  const { db, staff } = await getStaff();
  if (!staff) redirect('/login');
  // Identifier search: PAN / phone / email / UAN are looked up by hash so plaintext never touches the query.
  let ids: string[] | null = null;
  const by = sp.by as SensitiveKind | 'TEXT' | undefined;
  if (sp.q && by && by !== 'TEXT') {
    const h = hashIdentifier(by, sp.q);
    const { data } = h ? await db.rpc('find_clients_by_hash', { p_kind: by, p_hash: h }) : { data: [] };
    ids = Array.isArray(data) ? (data as string[]) : [];
    await audit(db, { action: 'client.search_identifier', details: { kind: by, matches: ids.length } });
  } else if (sp.q) {
    await audit(db, { action: 'client.search', details: { q: sp.q.slice(0, 40) } });
  }
  const rows = await searchClients(db, { ...sp, q: by && by !== 'TEXT' ? undefined : sp.q }, ids);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Client search</h1>
          <p className="text-xs text-ink-400">Search by client ID, reference, verification ID, name, or by hashed identifier (PAN, phone, e-mail, UAN). Identifiers are never shown in results.</p>
        </div>
        <Link href="/clients/new" className="btn btn-primary">
          New verification
        </Link>
      </div>
      <Panel>
        <form className="grid gap-3 md:grid-cols-[1fr_170px]">
          <div className="grid gap-2 sm:grid-cols-[1fr_190px]">
            <input name="q" defaultValue={sp.q ?? ''} className="input" placeholder="Name, BF-000001, REF-..., VER-..., employer, city" />
            <select name="by" defaultValue={sp.by ?? 'TEXT'} className="input">
              <option value="TEXT">Text / IDs</option>
              <option value="PAN">PAN (exact)</option>
              <option value="PHONE">Phone (exact)</option>
              <option value="EMAIL">E-mail (exact)</option>
              <option value="UAN">UAN (exact)</option>
              <option value="BANK_ACCOUNT">Bank account (exact)</option>
            </select>
          </div>
          <button className="btn justify-center">Search</button>
          <div className="grid grid-cols-2 gap-2 md:col-span-2 md:grid-cols-4 xl:grid-cols-7">
            {SEL('status', 'Verification status', ['PENDING', 'VERIFIED', 'NEEDS_REVIEW', 'PARTIAL', 'REJECTED'], sp.status)}
            {SEL('risk', 'Risk level', ['NONE', 'INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], sp.risk)}
            {SEL('credit', 'Credit band', ['EXCELLENT', 'VERY_GOOD', 'GOOD', 'FAIR', 'POOR', 'NO_HISTORY', 'NOT_AVAILABLE'], sp.credit)}
            {SEL('employment', 'Employment', ['CURRENT', 'EXITED', 'UNKNOWN'], sp.employment)}
            {SEL('completeness', 'Completeness', ['complete', 'incomplete'], sp.completeness)}
            {SEL('freshness', 'Freshness', ['FRESH', 'RECENT', 'AGING', 'STALE'], sp.freshness)}
            {SEL('review', 'Review status', ['UNREVIEWED', 'IN_REVIEW', 'REVIEWED', 'ESCALATED'], sp.review)}
          </div>
        </form>
      </Panel>
      <Panel title={`Results`} right={<Badge tone="muted">{rows.length}</Badge>}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Credit band</th>
                  <th>Employment</th>
                  <th>City</th>
                  <th>Complete</th>
                  <th>Freshness</th>
                  <th>Review</th>
                  <th>Last verified</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/clients/${c.id}`} className="mono text-gold-300 hover:underline">
                        {c.client_code}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                        {c.display_name}
                      </Link>
                      {c.occupation ? <div className="text-xs text-ink-400">{c.occupation}</div> : null}
                    </td>
                    <td><StatusBadge status={c.status} /></td>
                    <td><SeverityBadge severity={c.risk_level} /></td>
                    <td className="text-xs">{c.credit_band?.replace('_', ' ') ?? '-'}</td>
                    <td className="text-xs">{c.employment_status ?? '-'}</td>
                    <td className="text-xs">{c.city ?? '-'}</td>
                    <td className="mono text-xs">{c.completeness !== null ? `${Math.round(Number(c.completeness) * 100)}%` : '-'}</td>
                    <td>{c.freshness ? <FreshnessPill freshness={c.freshness} /> : '-'}</td>
                    <td><StatusBadge status={c.review_status} /></td>
                    <td className="text-xs">{formatDate(c.last_verified_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No clients match.</Empty>
        )}
      </Panel>
    </div>
  );
}
