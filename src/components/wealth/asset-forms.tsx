'use client';
import { useState } from 'react';
import { ActionForm } from '@/components/ui/action-form';
import { addAsset, addLiability, addWealthEvent, addFamilyLink } from '@/lib/actions-wealth';
import type { AssetCategory, EvidenceClass, ValuationBasis } from '@/lib/wealth/types';

const CATEGORIES: Array<[AssetCategory, string]> = [
  ['REAL_ESTATE', 'Real estate / land'],
  ['BUSINESS_INTEREST', 'Business interest'],
  ['FINANCIAL_INVESTMENT', 'Financial investment'],
  ['MUTUAL_FUND', 'Mutual fund'],
  ['SECURITY', 'Security (shares / bonds)'],
  ['DEPOSIT', 'Deposit'],
  ['CASH', 'Cash & bank balance'],
  ['RETIREMENT', 'Retirement (PF / NPS / gratuity)'],
  ['INSURANCE', 'Insurance (surrender / maturity value)'],
  ['VEHICLE', 'Vehicle'],
  ['LUXURY', 'Luxury / collectible'],
  ['OTHER', 'Other'],
];
const BASES: Array<[ValuationBasis, string]> = [
  ['NOT_VALUED', 'Not valued'],
  ['REGISTERED_TRANSACTION', 'Registered transaction value'],
  ['OFFICIAL_GUIDELINE', 'Official guideline value'],
  ['ESTIMATED_MARKET', 'Estimated market value'],
  ['STATEMENT', 'Statement'],
  ['NAV', 'NAV'],
  ['INSURED_VALUE', 'Insured value'],
  ['DECLARED', 'Declared'],
];
const EVIDENCE: Array<[EvidenceClass, string]> = [
  ['CLIENT_DECLARED', 'Client declared'],
  ['ANALYST_PROVIDED', 'Analyst provided'],
  ['OFFICIAL_PUBLIC_RECORD', 'Official public record'],
  ['AUTHORIZED_THIRD_PARTY', 'Authorised third-party data'],
  ['DERIVED_ESTIMATE', 'Derived estimate'],
  ['POSSIBLE_ASSOCIATION', 'Possible association (never counted)'],
  ['VERIFIED', 'Verified (senior roles only)'],
];
const CONFIDENCE = ['LOW', 'MEDIUM', 'HIGH', 'VERIFIED', 'INSUFFICIENT'];
const SCOPES = ['PERSONAL', 'JOINT', 'SPOUSE', 'HUF', 'FAMILY_COMPANY', 'TRUST', 'INHERITED', 'FAMILY_LINKED'];
const LIABILITY_TYPES = ['HOME_LOAN', 'LOAN_AGAINST_PROPERTY', 'BUSINESS_LOAN', 'PERSONAL_LOAN', 'CAR_LOAN', 'CREDIT_CARD', 'OVERDRAFT', 'CREDIT_LINE', 'GOLD_LOAN', 'EDUCATION_LOAN', 'LOAN_AGAINST_SECURITIES', 'OTHER'];
const REPAYMENT = ['REGULAR', 'DPD_30', 'DPD_60', 'DPD_90', 'RESTRUCTURED', 'SETTLED', 'WRITTEN_OFF', 'CLOSED'];
const ROLES = ['BORROWER', 'CO_BORROWER', 'GUARANTOR', 'DIRECTOR_GUARANTOR'];
const EVENT_TYPES = ['PROPERTY_ACQUIRED', 'PROPERTY_SOLD', 'BUSINESS_STARTED', 'BUSINESS_EXIT', 'INHERITANCE', 'GIFT_RECEIVED', 'LOAN_OPENED', 'LOAN_CLOSED', 'LARGE_INVESTMENT', 'LARGE_REDEMPTION', 'INCOME_CHANGE', 'OTHER'];

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
function Select({ name, options, defaultValue }: { name: string; options: Array<string | [string, string]>; defaultValue?: string }) {
  return (
    <select name={name} className="input" defaultValue={defaultValue}>
      {options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o.replace(/_/g, ' ')];
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}
function Check({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-200">
      <input type="checkbox" name={name} className="accent-gold-500" /> {label}
    </label>
  );
}

/** Adds an asset with category-specific detail fields (d_* names are read by addAsset). */
export function AddAssetForm({ clientId, canVerify }: { clientId: string; canVerify: boolean }) {
  const [category, setCategory] = useState<AssetCategory>('REAL_ESTATE');
  return (
    <ActionForm action={addAsset} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Category">
          <select name="category" className="input" value={category} onChange={(e) => setCategory(e.target.value as AssetCategory)}>
            {CATEGORIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subtype">
          <input name="subtype" className="input" placeholder="e.g. Residential plot, Pvt Ltd equity" />
        </Field>
        <Field label="Title *">
          <input name="title" className="input" required minLength={2} placeholder="Short identifying title" />
        </Field>
      </div>
      {category === 'REAL_ESTATE' ? (
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="City"><input name="d_city" className="input" /></Field>
          <Field label="Survey number"><input name="d_survey_number" className="input" /></Field>
          <Field label="Registration ref"><input name="d_registration_ref" className="input" /></Field>
          <div className="flex items-end pb-2"><Check name="d_rental" label="Rental income" /></div>
        </div>
      ) : null}
      {category === 'BUSINESS_INTEREST' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="CIN"><input name="d_cin" className="input" /></Field>
          <Field label="Role (director / shareholder / partner)"><input name="d_role" className="input" /></Field>
        </div>
      ) : null}
      {category === 'MUTUAL_FUND' || category === 'FINANCIAL_INVESTMENT' || category === 'SECURITY' ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Folio / demat"><input name="d_folio" className="input" /></Field>
          <Field label="AMC / issuer"><input name="d_amc" className="input" /></Field>
          <Field label="Scheme / instrument"><input name="d_scheme" className="input" /></Field>
        </div>
      ) : null}
      {category === 'VEHICLE' ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Registration no."><input name="d_registration_no" className="input" /></Field>
          <Field label="Make"><input name="d_make" className="input" /></Field>
          <Field label="Model"><input name="d_model" className="input" /></Field>
        </div>
      ) : null}
      {category === 'DEPOSIT' || category === 'INSURANCE' || category === 'RETIREMENT' ? (
        <Field label="Maturity on" className="md:w-1/3"><input name="d_maturity_on" type="date" className="input" /></Field>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Value low (INR)"><input name="valueLow" type="number" min={0} className="input" /></Field>
        <Field label="Value mid (INR)"><input name="valueMid" type="number" min={0} className="input" /></Field>
        <Field label="Value high (INR)"><input name="valueHigh" type="number" min={0} className="input" /></Field>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Valuation basis"><Select name="valuationBasis" options={BASES} /></Field>
        <Field label="Valuation date"><input name="valuationDate" type="date" className="input" /></Field>
        <Field label="Pricing source"><input name="pricingSource" className="input" placeholder="Registry, guideline table, broker quote" /></Field>
        <Field label="Methodology"><input name="valuationMethod" className="input" placeholder="How the range was derived" /></Field>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Liquidity"><Select name="liquidity" options={['ILLIQUID', 'SEMI_LIQUID', 'LIQUID']} /></Field>
        <Field label="Evidence class">
          <Select name="evidenceClass" options={EVIDENCE.filter(([v]) => canVerify || v !== 'VERIFIED')} />
        </Field>
        <Field label="Confidence"><Select name="confidence" options={CONFIDENCE} /></Field>
        <Field label="Ownership scope"><Select name="ownershipScope" options={SCOPES} /></Field>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Ownership %"><input name="ownershipPct" type="number" min={0} max={100} step="0.01" className="input" placeholder="100" /></Field>
        <Field label="Acquired on"><input name="acquiredOn" type="date" className="input" /></Field>
        <Field label="Source key"><input name="sourceKey" className="input" placeholder="ANALYST, REGISTRY, MCA, CAMS" /></Field>
        <div className="flex flex-col justify-end gap-2 pb-2">
          <Check name="inherited" label="Inherited" />
          <Check name="encumbered" label="Encumbered / charged" />
        </div>
      </div>
      <p className="text-[11px] text-ink-400">
        VERIFIED may only be set by senior roles; other roles record OFFICIAL_PUBLIC_RECORD or AUTHORIZED_THIRD_PARTY with a source. Family-linked scope keeps the asset out of personal net worth. Possible associations are never counted.
      </p>
      <button className="btn btn-primary btn-sm" type="submit">Add asset</button>
    </ActionForm>
  );
}

export function AddLiabilityForm({ clientId, realEstate }: { clientId: string; realEstate: Array<{ id: string; title: string }> }) {
  return (
    <ActionForm action={addLiability} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Type *"><Select name="type" options={LIABILITY_TYPES} /></Field>
        <Field label="Lender"><input name="lender" className="input" /></Field>
        <Field label="Original amount (INR)"><input name="original" type="number" min={0} className="input" /></Field>
        <Field label="Outstanding (INR)"><input name="outstanding" type="number" min={0} className="input" /></Field>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Monthly obligation (INR)"><input name="monthly" type="number" min={0} className="input" /></Field>
        <Field label="Interest rate %"><input name="rate" type="number" min={0} step="0.01" className="input" /></Field>
        <Field label="Opened on"><input name="openedOn" type="date" className="input" /></Field>
        <Field label="Maturity on"><input name="maturityOn" type="date" className="input" /></Field>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Collateral"><input name="collateral" className="input" /></Field>
        <Field label="Linked property">
          <select name="linkedAssetId" className="input" defaultValue="">
            <option value="">None</option>
            {realEstate.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Repayment status"><Select name="repaymentStatus" options={REPAYMENT} /></Field>
        <Field label="Client role"><Select name="role" options={ROLES} /></Field>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Evidence class"><Select name="evidenceClass" options={EVIDENCE.filter(([v]) => v !== 'VERIFIED' && v !== 'POSSIBLE_ASSOCIATION')} /></Field>
        <Field label="Confidence"><Select name="confidence" options={CONFIDENCE} /></Field>
        <Field label="Source key"><input name="sourceKey" className="input" placeholder="ANALYST, CIBIL, LENDER" /></Field>
        <div className="flex items-end pb-2"><Check name="secured" label="Secured" /></div>
      </div>
      <p className="text-[11px] text-ink-400">Linking a property marks it as encumbered and records the mortgage chain. Guarantor roles are shown separately and never added to personal debt.</p>
      <button className="btn btn-primary btn-sm" type="submit">Add liability</button>
    </ActionForm>
  );
}

export function AddWealthEventForm({ clientId }: { clientId: string }) {
  return (
    <ActionForm action={addWealthEvent} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Occurred on *"><input name="occurredOn" type="date" className="input" required /></Field>
        <Field label="Event type"><Select name="eventType" options={EVENT_TYPES} /></Field>
        <Field label="Title *" className="md:col-span-2"><input name="title" className="input" required minLength={2} /></Field>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Amount (INR)"><input name="amount" type="number" min={0} className="input" /></Field>
        <Field label="Evidence class"><Select name="evidenceClass" options={EVIDENCE.filter(([v]) => v !== 'VERIFIED')} /></Field>
        <Field label="Source key"><input name="sourceKey" className="input" placeholder="ANALYST, REGISTRY" /></Field>
        <Field label="Evidence note"><input name="evidenceNote" className="input" placeholder="Document ref, registry no." /></Field>
      </div>
      <button className="btn btn-sm" type="submit">Add event</button>
    </ActionForm>
  );
}

export function AddFamilyLinkForm({ clientId }: { clientId: string }) {
  return (
    <ActionForm action={addFamilyLink} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Name *"><input name="name" className="input" required minLength={2} /></Field>
        <Field label="Relation"><Select name="relation" options={['SPOUSE', 'FATHER', 'MOTHER', 'SON', 'DAUGHTER', 'BROTHER', 'SISTER', 'HUF', 'FAMILY_TRUST', 'FAMILY_COMPANY', 'OTHER']} /></Field>
        <Field label="Evidence class"><Select name="evidenceClass" options={EVIDENCE.filter(([v]) => v !== 'VERIFIED' && v !== 'DERIVED_ESTIMATE')} /></Field>
        <Field label="Confidence"><Select name="confidence" options={CONFIDENCE} /></Field>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Entitlement"><Select name="entitlement" options={['NONE_KNOWN', 'BENEFICIAL_OWNER', 'INHERITANCE_EXPECTED', 'TRUST_BENEFICIARY', 'HUF_COPARCENER', 'JOINT_HOLDER']} /></Field>
        <Field label="Note"><input name="note" className="input" placeholder="Basis for the link" /></Field>
      </div>
      <button className="btn btn-sm" type="submit">Add family link</button>
    </ActionForm>
  );
}
