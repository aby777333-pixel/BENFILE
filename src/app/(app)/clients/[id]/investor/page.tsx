import { loadClient } from '@/lib/db/load-client';
import { formatDateTime, formatINR } from '@/lib/engines/normalize';
import { Panel, Empty, Kv } from '@/components/ui/panel';
import { Badge, ProvenanceTag } from '@/components/ui/badges';
import { InvestorForm } from '@/components/client360/investor-form';

export default async function InvestorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c360, db } = await loadClient(id, 'investor');
  const { data: profiles } = await db.from('investor_profiles').select('*').eq('client_id', id).order('captured_at', { ascending: false });
  const latest = profiles?.[0];
  const byName = Object.fromEntries(c360.staff.map((s) => [s.user_id, s.full_name]));
  const verifiedIncome = c360.run?.canonical.person.income.value?.amount;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Client-declared investor profile" right={<ProvenanceTag kind="CLIENT_DECLARED" />}>
        <p className="mb-3 text-xs text-ink-400">Captured directly from the client under consent. Kept strictly separate from externally verified information. Risk tolerance is never inferred from personal characteristics.</p>
        {latest ? (
          <>
            <Kv
              rows={[
                ['Investment objectives', latest.objectives.join(', ') || null],
                ['Investment horizon', latest.horizon],
                ['Liquidity needs', latest.liquidity_needs],
                ['Risk tolerance', latest.risk_tolerance ? <Badge key="r" tone="declared">{latest.risk_tolerance}</Badge> : null],
                ['Experience', latest.experience],
                ['Income range (declared)', latest.income_range],
                ['Net-worth range (declared)', latest.net_worth_range],
                ['Source of funds', latest.source_of_funds],
                ['Source of wealth', latest.source_of_wealth],
                ['Expected investment', latest.expected_investment_amount ? formatINR(Number(latest.expected_investment_amount)) : null],
                ['Preferences', latest.preferences.join(', ') || null],
                ['Captured', `${byName[latest.captured_by] ?? 'Staff'} - ${formatDateTime(latest.captured_at)}`],
                ['Client confirmed', (latest.declaration as { clientConfirmed?: boolean }).clientConfirmed ? <Badge key="c" tone="good">Yes</Badge> : <Badge key="n" tone="warn">Not confirmed</Badge>],
              ]}
            />
            {profiles && profiles.length > 1 ? <p className="mt-2 text-[11px] text-ink-500">{profiles.length - 1} earlier version(s) retained.</p> : null}
          </>
        ) : (
          <Empty>No investor profile captured yet.</Empty>
        )}
      </Panel>
      <div className="space-y-4">
        <Panel title="Declared vs verified" right={<ProvenanceTag kind="DERIVED" short />}>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Client declared</th>
                <th>Externally verified</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Income</td>
                <td>{latest?.income_range ?? <span className="text-ink-400">-</span>}</td>
                <td>{verifiedIncome ? formatINR(verifiedIncome) : <span className="text-ink-400">Not available</span>}</td>
              </tr>
              <tr>
                <td>Net worth</td>
                <td>{latest?.net_worth_range ?? <span className="text-ink-400">-</span>}</td>
                <td><span className="text-ink-400">Not verified by any source</span></td>
              </tr>
              <tr>
                <td>Source of funds</td>
                <td>{latest?.source_of_funds ?? <span className="text-ink-400">-</span>}</td>
                <td><span className="text-ink-400">Employment verified via EPFO; funds not traced</span></td>
              </tr>
            </tbody>
          </table>
        </Panel>
        <Panel title="Capture / update investor profile">
          <InvestorForm clientId={id} />
        </Panel>
      </div>
    </div>
  );
}
