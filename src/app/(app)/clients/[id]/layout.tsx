import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadClient } from '@/lib/db/load-client';
import { hasPermission, SECTION_ACCESS, type Permission } from '@/lib/security/permissions';
import { audit } from '@/lib/db/audit';
import { Client360Header } from '@/components/client360/header';
import { TabNav } from '@/components/client360/tab-nav';

export const dynamic = 'force-dynamic';

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, role, db } = await loadClient(id);
  const staff = { role };
  if (!c360) notFound();
  await audit(db, { action: 'client.view', clientId: id, entityTable: 'clients', entityId: id });

  const tabs = [
    ['overview', 'Overview', ''],
    ['identity', 'Identity', '/identity'],
    ['financial', 'Financial Health', '/financial'],
    ['credit', 'Credit', '/credit'],
    ['employment', 'Employment', '/employment'],
    ['banking', 'Banking', '/banking'],
    ['contact', 'Contact', '/contact'],
    ['addresses', 'Addresses', '/addresses'],
    ['risk', 'Risk', '/risk'],
    ['external', 'External Intel', '/external'],
    ['graph', 'Relationships', '/graph'],
    ['documents', 'Documents', '/documents'],
    ['history', 'Verification History', '/history'],
    ['notes', 'Notes & Cases', '/notes'],
    ['investor', 'Investor Profile', '/investor'],
    ['audit', 'Audit', '/audit'],
  ]
    .filter(([key]) => hasPermission(staff.role, SECTION_ACCESS[key] as Permission))
    .map(([key, label, path]) => ({ key, label, href: `/clients/${id}${path}` }));

  return (
    <div className="space-y-4">
      <Client360Header data={c360} role={staff.role} />
      <div className="no-print sticky top-0 z-30 -mx-4 border-b border-white/[0.07] bg-ink-950/90 px-4 backdrop-blur md:-mx-6 md:px-6">
        <TabNav tabs={tabs} base={`/clients/${id}`} />
      </div>
      {children}
      <div className="no-print pt-4 text-[11px] text-ink-500">
        Client 360 for {c360.client.client_code}. Verified facts, client-declared data, derived values and analyst assessments are labelled throughout.{' '}
        <Link href="/clients" className="text-ink-400 hover:text-ink-200">
          Back to search
        </Link>
      </div>
    </div>
  );
}
