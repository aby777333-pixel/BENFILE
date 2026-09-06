/** BENFILE mark: a dossier tab with a "B" monogram and a verification tick, gold on ink. */
export function Logo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-label="BENFILE" role="img">
      <defs>
        <linearGradient id="bf-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F0D58F" />
          <stop offset="1" stopColor="#C4952E" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="14" fill="#0F1621" stroke="rgba(255,255,255,0.08)" />
      <path d="M16 20a4 4 0 0 1 4-4h10l4 4h10a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V20z" fill="url(#bf-gold)" opacity="0.18" />
      <path d="M16 20a4 4 0 0 1 4-4h10l4 4h10a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V20z" fill="none" stroke="url(#bf-gold)" strokeWidth="2" />
      <path d="M25 26h8.5c3.6 0 5.8 1.8 5.8 4.6 0 1.9-1 3.3-2.6 3.9 2.2.5 3.6 2.2 3.6 4.5 0 3.2-2.4 5-6.3 5H25V26zm4 3.4v4.2h4c1.7 0 2.6-.8 2.6-2.1 0-1.4-.9-2.1-2.6-2.1h-4zm0 7.3v4.9h4.5c1.9 0 2.9-.9 2.9-2.5s-1-2.4-2.9-2.4H29z" fill="url(#bf-gold)" />
      <circle cx="46" cy="42" r="7" fill="#0F1621" stroke="url(#bf-gold)" strokeWidth="2" />
      <path d="M42.5 42.2l2.4 2.4 4.6-4.8" fill="none" stroke="#2FBF71" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
