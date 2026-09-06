'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function TabNav({ tabs, base }: { tabs: Array<{ key: string; label: string; href: string }>; base: string }) {
  const path = usePathname();
  return (
    <nav className="-mb-px flex gap-0.5 overflow-x-auto">
      {tabs.map((t) => {
        const active = t.href === base ? path === base : path.startsWith(t.href);
        return (
          <Link key={t.key} href={t.href} data-active={active} className="tab-link">
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
