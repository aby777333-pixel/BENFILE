import type { CanonicalProfile } from '@/lib/canonical/types';

export interface AdapterResult {
  profile: CanonicalProfile;
  /** Non-fatal warnings raised while normalising. */
  warnings: string[];
}

/**
 * Provider adapter contract.
 *
 *   Provider API -> Adapter -> Canonical Data Model -> Rules Engine -> Client Profile
 *
 * Adapters are pure: they never touch the database, never log identifiers,
 * and never invent values. Missing input => null output.
 */
export interface ProviderAdapter {
  key: string;
  name: string;
  version: string;
  country: 'IN' | string;
  /** Domains this provider can return (used by the data-quality panel and consent checks). */
  domains: Array<'IDENTITY' | 'CONTACT' | 'DOCUMENTS' | 'ADDRESS' | 'BANKING' | 'EMPLOYMENT' | 'MOBILE' | 'CREDIT' | 'RISK'>;
  /** Quick structural probe so the registry can auto-detect a payload's provider. */
  detect(raw: unknown): boolean;
  normalize(raw: unknown): AdapterResult;
}
