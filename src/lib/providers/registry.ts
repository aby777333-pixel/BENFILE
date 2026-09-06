import { indiaKycCompositeAdapter } from './india-kyc-composite';
import type { ProviderAdapter } from './types';

const adapters: ProviderAdapter[] = [indiaKycCompositeAdapter];

export function listAdapters(): ProviderAdapter[] {
  return adapters;
}

export function getAdapter(key: string): ProviderAdapter | undefined {
  return adapters.find((a) => a.key === key);
}

/** Auto-detect which adapter understands a payload. */
export function detectAdapter(raw: unknown): ProviderAdapter | undefined {
  return adapters.find((a) => a.detect(raw));
}

export function registerAdapter(adapter: ProviderAdapter) {
  if (!adapters.some((a) => a.key === adapter.key)) adapters.push(adapter);
}
