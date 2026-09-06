import type { Metadata } from 'next';
import { PortalApp } from '@/components/portal/portal-app';

export const metadata: Metadata = { title: 'Client portal', robots: { index: false, follow: false } };

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PortalApp token={token} />;
}
