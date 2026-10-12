/**
 * Live connector registry.
 *
 * Each factory lists the environment variables it needs. When they are all
 * present the live connector is built and the sandbox connector(s) it
 * supersedes are dropped from the orchestrator registry; otherwise the sandbox
 * stays so the workflow remains exercisable. Secrets are read once per
 * process from the server environment and never leave this module.
 */
import type { Env } from '@/lib/integrations/catalog';
import type { ExternalConnector } from '../types';
import { attestrConnector } from './attestr';
import { braveNewsConnector, braveWebConnector } from './brave';
import { complyAdvantageConnector } from './complyadvantage';
import { DILISENSE_MEDIA_ENDPOINT, dilisenseConnector } from './dilisense';
import { eCourtsConnector } from './ecourts';
import { openSanctionsConnector } from './opensanctions';

export interface LiveConnectorFactory {
  key: string;
  envVars: string[];
  supersedes: string[];
  build(env: Env): ExternalConnector;
}

export const LIVE_CONNECTOR_FACTORIES: LiveConnectorFactory[] = [
  { key: 'attestr-mca', envVars: ['ATTESTR_AUTH_TOKEN'], supersedes: ['mca-sandbox'], build: (env) => attestrConnector({ authToken: env.ATTESTR_AUTH_TOKEN!, fetchDirectors: env.ATTESTR_FETCH_DIRECTORS !== 'false' }) },
  { key: 'opensanctions', envVars: ['OPENSANCTIONS_API_KEY'], supersedes: ['sanctions-sandbox'], build: (env) => openSanctionsConnector({ apiKey: env.OPENSANCTIONS_API_KEY!, dataset: env.OPENSANCTIONS_DATASET, threshold: env.OPENSANCTIONS_THRESHOLD ? Number(env.OPENSANCTIONS_THRESHOLD) : undefined }) },
  { key: 'dilisense', envVars: ['DILISENSE_API_KEY'], supersedes: ['sanctions-sandbox'], build: (env) => dilisenseConnector({ apiKey: env.DILISENSE_API_KEY!, baseUrl: env.DILISENSE_BASE_URL, mediaEndpoint: env.DILISENSE_MEDIA_ENDPOINT ?? (env.DILISENSE_ADVERSE_MEDIA === 'true' ? DILISENSE_MEDIA_ENDPOINT : undefined) }) },
  { key: 'complyadvantage', envVars: ['COMPLYADVANTAGE_API_KEY'], supersedes: ['sanctions-sandbox'], build: (env) => complyAdvantageConnector({ apiKey: env.COMPLYADVANTAGE_API_KEY!, searchUrl: env.COMPLYADVANTAGE_SEARCH_URL, fuzziness: env.COMPLYADVANTAGE_FUZZINESS ? Number(env.COMPLYADVANTAGE_FUZZINESS) : undefined }) },
  { key: 'ecourts', envVars: ['ECOURTS_API_TOKEN'], supersedes: ['courts-sandbox'], build: (env) => eCourtsConnector({ apiToken: env.ECOURTS_API_TOKEN!, baseUrl: env.ECOURTS_BASE_URL, searchParam: env.ECOURTS_SEARCH_PARAM }) },
  { key: 'brave-web', envVars: ['BRAVE_SEARCH_API_KEY'], supersedes: ['web-sandbox'], build: (env) => braveWebConnector({ apiKey: env.BRAVE_SEARCH_API_KEY! }) },
  { key: 'brave-news', envVars: ['BRAVE_SEARCH_API_KEY'], supersedes: ['media-sandbox'], build: (env) => braveNewsConnector({ apiKey: env.BRAVE_SEARCH_API_KEY! }) },
];

export function configuredFactories(env: Env = process.env): LiveConnectorFactory[] {
  return LIVE_CONNECTOR_FACTORIES.filter((f) => f.envVars.every((k) => !!env[k]?.trim()));
}

/** Sandbox connectors + configured live connectors, with superseded sandboxes removed. */
export function composeRegistry(sandbox: ExternalConnector[], env: Env = process.env): ExternalConnector[] {
  const live = configuredFactories(env);
  const drop = new Set(live.flatMap((f) => f.supersedes));
  return [...live.map((f) => f.build(env)), ...sandbox.filter((c) => !drop.has(c.key))];
}
