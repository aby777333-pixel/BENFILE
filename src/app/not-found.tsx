import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="panel max-w-md p-6 text-center">
        <div className="text-sm font-semibold uppercase tracking-widest text-gold-300">BENFILE</div>
        <h1 className="mt-2 text-lg font-semibold">Not found or not authorised</h1>
        <p className="mt-2 text-sm text-ink-300">The record does not exist, or your role does not permit access to this section. Access attempts are logged.</p>
        <Link href="/dashboard" className="btn mt-4">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
