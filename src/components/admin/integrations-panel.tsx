import { CATEGORY_LABEL, groupCatalog, integrationStatus, STATUS_LABEL, summarizeCatalog, type IntegrationEntry, type IntegrationStatus } from '@/lib/integrations/catalog';
import { PRICE_TIER_LABEL, pricingFor, type PriceTier } from '@/lib/integrations/pricing';
import { Panel, Stat } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badges';

const TONE: Record<IntegrationStatus, 'good' | 'warn' | 'muted' | 'info'> = { LIVE: 'good', SANDBOX_FALLBACK: 'warn', NOT_CONFIGURED: 'muted', MANUAL: 'info' };
const PRICE_TONE: Record<PriceTier, 'good' | 'info' | 'gold' | 'warn' | 'muted'> = { FREE: 'good', FREE_TIER: 'info', PAID: 'gold', CONTRACT: 'warn', UNPUBLISHED: 'muted' };
const MODULE_LABEL: Record<IntegrationEntry['module'], string> = {
  VERIFICATION_INGEST: 'Verification ingest',
  EXTERNAL_INTELLIGENCE: 'External intelligence',
  WEALTH: 'Wealth / investments',
  DOCUMENTS: 'Document centre',
  PROPERTY: 'Property / inventory',
  CLIENT_PORTAL: 'Client portal',
};

/**
 * Server component: renders the integration catalogue with the live status of
 * each API. Reads only the *presence* of environment variables - values never
 * reach the browser.
 */
export function IntegrationsPanel() {
  const env = process.env;
  const summary = summarizeCatalog(env);
  const groups = groupCatalog();
  return (
    <Panel title="Integration catalogue - licensed APIs" right={<Badge tone={summary.live ? 'good' : 'warn'}>{summary.live} / {summary.total} live</Badge>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Live" value={summary.live} tone="good" />
        <Stat label="Sandbox fallback" value={summary.sandboxFallback} tone="warn" />
        <Stat label="Not configured" value={summary.notConfigured} tone="muted" />
        <Stat label="Manual / portal only" value={summary.manual} tone="muted" />
      </div>
      <p className="mt-2 text-[11px] text-ink-500">
        Status is derived from which server environment variables are set (names only; values are never read here). A live connector replaces its sandbox counterpart automatically. Integration points have the contract in code and switch on once the provider&apos;s commercial onboarding completes. Commercial column from the October 2026 pricing review. Sources: docs/BENFILE_APIS.pdf, docs/BENFILE_APIS_PRICING_BY_CATEGORY.pdf, docs/INTEGRATIONS.md, docs/PURCHASE_LIST.md.
      </p>
      <div className="mt-3 space-y-3">
        {groups.map((g) => (
          <details key={g.category} open={g.entries.some((e) => integrationStatus(e, env) === 'LIVE')}>
            <summary className="cursor-pointer text-xs font-semibold text-ink-200">
              {CATEGORY_LABEL[g.category]} <span className="mono text-ink-500">{g.entries.length}</span>
              <span className="ml-2 inline-flex gap-1">
                {(['LIVE', 'SANDBOX_FALLBACK', 'NOT_CONFIGURED', 'MANUAL'] as IntegrationStatus[]).map((st) => {
                  const n = g.entries.filter((e) => integrationStatus(e, env) === st).length;
                  return n ? (
                    <Badge key={st} tone={TONE[st]}>
                      {n} {STATUS_LABEL[st].toLowerCase()}
                    </Badge>
                  ) : null;
                })}
              </span>
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Integration</th>
                    <th>Provider</th>
                    <th>Feeds</th>
                    <th>Status</th>
                    <th>Commercial</th>
                    <th>Environment</th>
                    <th>Docs</th>
                  </tr>
                </thead>
                <tbody>
                  {g.entries.map((e) => {
                    const st = integrationStatus(e, env);
                    const pr = pricingFor(e.id);
                    return (
                      <tr key={e.id}>
                        <td className="mono text-xs">{e.id}</td>
                        <td>
                          <div className="font-medium">{e.name}</div>
                          <div className="text-[11px] text-ink-400">{e.purpose}</div>
                          {e.consent ? <div className="text-[11px] text-amber-300/80">Consent: {e.consent}</div> : null}
                        </td>
                        <td className="text-xs">{e.provider}</td>
                        <td className="text-xs text-ink-300">{MODULE_LABEL[e.module]}</td>
                        <td>
                          <Badge tone={TONE[st]}>{STATUS_LABEL[st]}</Badge>
                          {e.connectorKey ? <div className="mono mt-0.5 text-[10px] text-ink-500">{e.connectorKey}</div> : null}
                        </td>
                        <td className="max-w-[16rem]">
                          <Badge tone={PRICE_TONE[pr.tier]}>{PRICE_TIER_LABEL[pr.tier]}</Badge>
                          <div className="mt-0.5 text-[10.5px] text-ink-400">{pr.price}</div>
                          {st !== 'LIVE' ? <div className="text-[10.5px] text-ink-500">To obtain: {pr.toObtain}</div> : null}
                        </td>
                        <td className="mono text-[10.5px]">
                          {e.envVars.map((k) => (
                            <div key={k} className={env[k]?.trim() ? 'text-emerald-300' : 'text-ink-500'}>
                              {env[k]?.trim() ? '+' : '-'} {k}
                            </div>
                          ))}
                        </td>
                        <td className="text-xs">
                          <a href={e.docsUrl} target="_blank" rel="noreferrer noopener" className="text-gold-300 hover:underline">
                            docs
                          </a>
                          <div className="text-[10.5px] text-ink-500">{e.sandbox}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
      {summary.missingEnvVars.length ? (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-ink-300">Environment variables still required ({summary.missingEnvVars.length})</summary>
          <p className="mono mt-1 break-all text-[10.5px] text-ink-400">{summary.missingEnvVars.join(', ')}</p>
        </details>
      ) : null}
    </Panel>
  );
}
