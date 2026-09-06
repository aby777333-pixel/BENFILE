export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>
    </div>
  );
}
