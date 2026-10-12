'use client';
import { createBrowserClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: ReturnType<typeof createBrowserClient> | null = null;
let portal: SupabaseClient | null = null;

/** Staff browser client - picks up the signed-in session from cookies. */
export function browserSupabase() {
  if (!client) client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return client;
}

/**
 * Client-portal client: never reads or stores a session, so every portal call runs as the anon
 * role and is authorised by the portal token alone - even when a staff member opens a portal
 * link in a browser where they are signed in.
 */
export function portalSupabase() {
  if (!portal) portal = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return portal;
}
