import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getStaff } from './server';
import { getClient360, type Client360 } from './queries';
import { hasPermission, SECTION_ACCESS, type Permission, type StaffRole } from '@/lib/security/permissions';

/** Per-request cached Client 360 loader with section permission gate. */
export const loadClient = cache(async (id: string, section?: string): Promise<{ c360: Client360; role: StaffRole; userId: string; db: Awaited<ReturnType<typeof getStaff>>['db'] }> => {
  const { db, staff } = await getStaff();
  if (!staff) notFound();
  if (section && !hasPermission(staff.role, SECTION_ACCESS[section] as Permission)) notFound();
  const c360 = await getClient360(db, id);
  if (!c360) notFound();
  return { c360, role: staff.role, userId: staff.userId, db };
});
