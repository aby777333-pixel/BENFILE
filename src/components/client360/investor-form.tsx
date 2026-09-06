'use client';
import { saveInvestorProfile } from '@/lib/actions';
import { ActionForm } from '@/components/ui/action-form';

const OBJ = ['Capital preservation', 'Regular income', 'Balanced growth', 'Long-term growth', 'Tax efficiency', 'Retirement', 'Education', 'Property purchase'];
const PREF = ['Equity', 'Debt / fixed income', 'Mutual funds', 'Real estate', 'Gold', 'Insurance-linked', 'Alternative assets', 'ESG / ethical'];

export function InvestorForm({ clientId }: { clientId: string }) {
  const sel = (name: string, opts: string[]) => (
    <select name={name} className="input">
      <option value="">Not stated</option>
      {opts.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
  return (
    <ActionForm action={saveInvestorProfile}>
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Investment objectives</label>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {OBJ.map((o) => (
              <label key={o} className="flex items-center gap-1.5">
                <input type="checkbox" name="objectives" value={o} /> {o}
              </label>
            ))}
          </div>
        </div>
        <div><label className="label">Investment horizon</label>{sel('horizon', ['< 1 year', '1-3 years', '3-5 years', '5-10 years', '> 10 years'])}</div>
        <div><label className="label">Liquidity needs</label>{sel('liquidity', ['High (may need funds within 12 months)', 'Medium', 'Low (funds not needed for 5+ years)'])}</div>
        <div><label className="label">Risk tolerance (client stated)</label>{sel('riskTolerance', ['Conservative', 'Moderately conservative', 'Balanced', 'Moderately aggressive', 'Aggressive'])}</div>
        <div><label className="label">Investment experience</label>{sel('experience', ['None', 'Limited (< 2 years)', 'Moderate (2-5 years)', 'Extensive (5+ years)', 'Professional'])}</div>
        <div><label className="label">Income range (declared)</label>{sel('incomeRange', ['< 5 L', '5-10 L', '10-25 L', '25-50 L', '50 L - 1 Cr', '> 1 Cr'])}</div>
        <div><label className="label">Net-worth range (declared)</label>{sel('netWorthRange', ['< 25 L', '25 L - 1 Cr', '1-5 Cr', '5-25 Cr', '> 25 Cr'])}</div>
        <div><label className="label">Source of funds</label>{sel('sourceOfFunds', ['Salary', 'Business income', 'Savings', 'Sale of property', 'Inheritance / gift', 'Investment proceeds', 'Loan', 'Other'])}</div>
        <div><label className="label">Source of wealth</label>{sel('sourceOfWealth', ['Employment', 'Business ownership', 'Inheritance', 'Investments', 'Property', 'Other'])}</div>
        <div><label className="label">Expected investment amount (INR)</label><input name="expectedAmount" type="number" min={0} className="input" /></div>
        <div className="sm:col-span-2">
          <label className="label">Investment preferences</label>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {PREF.map((o) => (
              <label key={o} className="flex items-center gap-1.5">
                <input type="checkbox" name="preferences" value={o} /> {o}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-200 sm:col-span-2">
          <input type="checkbox" name="confirmed" /> The client reviewed and confirmed these declarations.
        </label>
      </div>
      <button className="btn btn-primary mt-3">Save investor profile</button>
    </ActionForm>
  );
}
