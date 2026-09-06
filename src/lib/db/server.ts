import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { cache } from 'react';
import type { StaffRole } from '@/lib/security/permissions';

export type Db = SupabaseClient;

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** Server-side Supabase client bound to the request cookies (RLS applies). */
export async function createServerSupabase(): Promise<Db> {
  const cookieStore = await cookies();
  return createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(list: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          /* called from a Server Component; middleware refreshes the session */
        }
      },
    },
  });
}

export interface StaffContext {
  userId: string;
  email: string;
  fullName: string;
  role: StaffRole;
}

/** Resolves the signed-in staff member (cached per request). Returns null if not staff. */
export const getStaff = cache(async (): Promise<{ db: Db; staff: StaffContext | null }> => {
  const db = await createServerSupabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { db, staff: null };
  const { data } = await db.from('staff_profiles').select('user_id,email,full_name,role,is_active').eq('user_id', user.id).maybeSingle();
  if (!data || !data.is_active) return { db, staff: null };
  return { db, staff: { userId: data.user_id, email: data.email, fullName: data.full_name, role: data.role as StaffRole } };
});
