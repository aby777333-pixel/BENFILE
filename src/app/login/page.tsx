'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { browserSupabase } from '@/lib/db/browser';
import { Logo } from '@/components/ui/logo';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await browserSupabase().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError('Sign-in failed. Check your credentials or contact your administrator.');
      return;
    }
    router.replace(params.get('next') || '/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="panel w-full max-w-sm p-6">
      <div className="mb-6 flex items-center gap-3">
        <Logo size={40} />
        <div>
          <div className="text-lg font-semibold tracking-tight">BENFILE</div>
          <div className="text-xs text-ink-300">Client Financial Intelligence Terminal</div>
        </div>
      </div>
      <label className="label" htmlFor="email">
        Work e-mail
      </label>
      <input id="email" className="input mb-3" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <label className="label" htmlFor="password">
        Password
      </label>
      <input id="password" className="input mb-4" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
      <button className="btn btn-primary w-full justify-center" disabled={busy}>
        {busy ? 'Signing in...' : 'Sign in'}
      </button>
      <p className="mt-4 text-[11px] leading-relaxed text-ink-400">
        Authorised personnel only. All access to client intelligence is logged. Sessions expire automatically.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(212,169,74,0.08),transparent_60%)] p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
