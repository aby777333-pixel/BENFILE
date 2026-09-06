import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Activity, Briefcase, LayoutDashboard, Search, Settings, ShieldCheck, UserPlus } from 'lucide-react';
import { getStaff } from '@/lib/db/server';
import { hasPermission, ROLE_LABEL } from '@/lib/security/permissions';
import { Logo } from '@/components/ui/logo';
import { SignOut } from '@/components/ui/sign-out';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff } = await getStaff();
  if (!staff) redirect('/login?reason=not-staff');
  const nav = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { href: '/clients', label: 'Clients', icon: Search, show: true },
    { href: '/clients/new', label: 'New verification', icon: UserPlus, show: hasPermission(staff.role, 'verification:ingest') },
    { href: '/cases', label: 'Cases', icon: Briefcase, show: true },
    { href: '/audit', label: 'Audit trail', icon: Activity, show: hasPermission(staff.role, 'audit:read') },
    { href: '/admin', label: 'Administration', icon: Settings, show: hasPermission(staff.role, 'scoring:configure') || hasPermission(staff.role, 'users:manage') || hasPermission(staff.role, 'retention:manage') },
  ].filter((n) => n.show);
  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/[0.07] bg-ink-900 md:flex">
        <Link href="/dashboard" className="flex items-center gap-3 px-4 py-4">
          <Logo size={34} />
          <div>
            <div className="text-sm font-bold tracking-[0.18em]">BENFILE</div>
            <div className="text-[10px] uppercase tracking-wider text-ink-400">Intelligence terminal</div>
          </div>
        </Link>
        <nav className="mt-2 flex-1 space-y-0.5 px-2">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-200 transition hover:bg-white/[0.04] hover:text-ink-100">
              <n.icon size={16} className="text-ink-400" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/[0.07] p-3 text-xs">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-gold-500" />
            <div className="min-w-0">
              <div className="truncate font-medium text-ink-100">{staff.fullName}</div>
              <div className="truncate text-ink-400">{ROLE_LABEL[staff.role]}</div>
            </div>
          </div>
          <SignOut />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="no-print flex items-center justify-between border-b border-white/[0.07] bg-ink-900/80 px-4 py-2 backdrop-blur md:hidden">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Logo size={26} />
            <span className="text-sm font-bold tracking-[0.18em]">BENFILE</span>
          </Link>
          <nav className="flex gap-3 text-xs">
            {nav.slice(0, 4).map((n) => (
              <Link key={n.href} href={n.href} className="text-ink-300">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-[1500px] p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
