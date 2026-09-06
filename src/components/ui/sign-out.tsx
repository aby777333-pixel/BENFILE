'use client';
import { useRouter } from 'next/navigation';
import { browserSupabase } from '@/lib/db/browser';

export function SignOut() {
  const router = useRouter();
  return (
    <button
      className="mt-2 w-full rounded-md border border-white/10 px-2 py-1 text-[11px] text-ink-300 hover:bg-white/[0.04]"
      onClick={async () => {
        await browserSupabase().auth.signOut();
        router.replace('/login');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
