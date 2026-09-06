'use client';
import { useState } from 'react';
import type { ActionResult } from '@/lib/actions';
import type { PropertyPreferencesRow } from '@/lib/wealth/types';
import { ActionForm } from '@/components/ui/action-form';

type Action = (fd: FormData) => Promise<ActionResult>;

export function PreferencesForm({ clientId, pp, action }: { clientId: string; pp: PropertyPreferencesRow | null; action: Action }) {
  const chk = (name: string, opts: string[], selected: string[]) => (
    <div className="flex flex-wrap gap-2 text-xs">{opts.map((o) => <label key={o} className="flex items-center gap-1"><input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} />{o.replace(/_/g, ' ')}</label>)}</div>
  );
  return (
    <ActionForm action={action} resetOnSuccess={false}>
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-2 text-xs">
        <label><span className="label">Buyer type</span><select name="buyerType" className="input py-1" defaultValue={pp?.buyer_type ?? 'MIXED_UNKNOWN'}><option value="END_USER">End-use buyer</option><option value="INVESTOR">Property investor</option><option value="MIXED_UNKNOWN">Mixed / unknown</option></select></label>
        <label><span className="label">Basis for buyer type</span><input name="buyerTypeBasis" className="input py-1" defaultValue={pp?.buyer_type_basis ?? ''} placeholder="e.g. Client stated on call 2026-07-20" /></label>
        <label><span className="label">Purpose</span><select name="purpose" className="input py-1" defaultValue={pp?.purpose ?? ''}><option value="">Not stated</option><option>SELF_USE</option><option>INVESTMENT</option><option>BOTH</option></select></label>
        <div className="grid grid-cols-2 gap-2"><label><span className="label">Budget min</span><input name="budgetMin" type="number" className="input py-1" defaultValue={pp?.budget_min ?? ''} /></label><label><span className="label">Budget max</span><input name="budgetMax" type="number" className="input py-1" defaultValue={pp?.budget_max ?? ''} /></label></div>
        <label><span className="label">Cities (comma)</span><input name="cities" className="input py-1" defaultValue={pp?.cities.join(', ') ?? ''} /></label>
        <label><span className="label">Localities (comma)</span><input name="localities" className="input py-1" defaultValue={pp?.localities.join(', ') ?? ''} /></label>
        <div><span className="label">Property types</span>{chk('propertyTypes', ['PLOT', 'LAND', 'VILLA', 'APARTMENT', 'COMMERCIAL', 'FARM'], pp?.property_types ?? [])}</div>
        <div className="grid grid-cols-2 gap-2"><label><span className="label">Plot size min (sq ft)</span><input name="sizeMin" type="number" className="input py-1" defaultValue={pp?.plot_size_min_sqft ?? ''} /></label><label><span className="label">max</span><input name="sizeMax" type="number" className="input py-1" defaultValue={pp?.plot_size_max_sqft ?? ''} /></label></div>
        <div><span className="label">Facing (only if explicitly stated)</span>{chk('facing', ['North', 'East', 'South', 'West'], pp?.facing ?? [])}</div>
        <div className="grid grid-cols-2 gap-2"><label><span className="label">Road width min (ft)</span><input name="roadWidth" type="number" className="input py-1" defaultValue={pp?.road_width_min_ft ?? ''} /></label><label className="flex items-end gap-1 pb-2"><input type="checkbox" name="corner" defaultChecked={!!pp?.corner_preferred} /> Corner preferred</label></div>
        <label className="flex items-center gap-1"><input type="checkbox" name="approvalRequired" defaultChecked={pp?.approval_required ?? true} /> Approved layout (DTCP/CMDA) required</label>
        <div><span className="label">Proximity</span>{chk('proximity', ['HIGHWAY', 'AIRPORT', 'IT_CORRIDOR', 'INDUSTRIAL', 'EDUCATION', 'RETIREMENT', 'METRO'], pp?.proximity ?? [])}</div>
        <div className="grid grid-cols-2 gap-2"><label><span className="label">Horizon</span><input name="horizon" className="input py-1" defaultValue={pp?.horizon ?? ''} placeholder="5-7 years" /></label><label><span className="label">Financing</span><select name="financing" className="input py-1" defaultValue={pp?.financing ?? ''}><option value="">Unknown</option><option>CASH</option><option>LOAN</option><option>MIXED</option></select></label></div>
        <label><span className="label">Source of this information</span><input name="source" className="input py-1" placeholder="e.g. WhatsApp 2026-07-20 / meeting" /></label>
        <label className="flex items-center gap-1"><input type="checkbox" name="declared" defaultChecked={!!pp?.declared_at} /> Declared by the client (otherwise stored as analyst-provided)</label>
      </div>
      <button className="btn btn-primary mt-2">Save requirements</button>
    </ActionForm>
  );
}

export function SiteVisitForm({ clientId, projects, plots, staff, action }: { clientId: string; projects: Array<{ id: string; name: string }>; plots: Array<{ id: string; label: string; projectId: string }>; staff: Array<{ user_id: string; full_name: string }>; action: Action }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn btn-sm mt-2" onClick={() => setOpen(true)}>Recommend / schedule site visit</button>;
  return (
    <ActionForm action={action} className="mt-2 rounded border border-white/10 bg-ink-900 p-3" onDone={() => setOpen(false)}>
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <label><span className="label">Project</span><select name="projectId" className="input py-1" value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label><span className="label">Date & time</span><input name="scheduledAt" type="datetime-local" className="input py-1" /></label>
        <div className="sm:col-span-2"><span className="label">Plots</span><div className="flex flex-wrap gap-2">{plots.filter((p) => p.projectId === projectId).map((p) => <label key={p.id} className="flex items-center gap-1"><input type="checkbox" name="plotIds" value={p.id} />{p.label}</label>)}</div></div>
        <label><span className="label">Relationship manager</span><select name="rmId" className="input py-1"><option value="">Me</option>{staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}</select></label>
        <label><span className="label">Property representative</span><select name="repId" className="input py-1"><option value="">None</option>{staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}</select></label>
        <label><span className="label">Client attendees (one per line)</span><textarea name="attendees" className="input h-14 py-1" /></label>
        <label><span className="label">Itinerary (one step per line)</span><textarea name="itinerary" className="input h-14 py-1" /></label>
        <label className="flex items-center gap-1"><input type="checkbox" name="pickup" /> Pickup required</label>
        <label><span className="label">Pickup point</span><input name="pickupPoint" className="input py-1" /></label>
        <label><span className="label">Meeting point</span><input name="meetingPoint" className="input py-1" /></label>
      </div>
      <button className="btn btn-primary mt-2">Create site visit</button>
    </ActionForm>
  );
}

export function FeedbackForm({ id, action }: { id: string; action: Action }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn btn-sm mt-1" onClick={() => setOpen(true)}>Capture site-visit feedback</button>;
  return (
    <ActionForm action={action} className="mt-1 rounded border border-white/10 bg-ink-900 p-2" onDone={() => setOpen(false)}>
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-1.5 text-xs sm:grid-cols-2">
        <label><span className="label">Liked (one per line)</span><textarea name="liked" className="input h-12 py-1" /></label>
        <label><span className="label">Disliked</span><textarea name="disliked" className="input h-12 py-1" /></label>
        <label><span className="label">Preferred plot numbers (one per line)</span><textarea name="preferredPlots" className="input h-12 py-1" /></label>
        <label><span className="label">Questions</span><textarea name="questions" className="input h-12 py-1" /></label>
        <label><span className="label">Objections</span><textarea name="objections" className="input h-12 py-1" /></label>
        <label><span className="label">Price reaction</span><input name="priceReaction" className="input py-1" /></label>
        <label><span className="label">Location reaction</span><input name="locationReaction" className="input py-1" /></label>
        <label><span className="label">Road-width preference (ft)</span><input name="roadWidthPref" type="number" className="input py-1" /></label>
        <label><span className="label">Plot-size reaction</span><input name="plotSizeReaction" className="input py-1" /></label>
        <label><span className="label">Amenities comment</span><input name="amenities" className="input py-1" /></label>
        <label><span className="label">Decision timeline</span><input name="decisionTimeline" className="input py-1" /></label>
        <label><span className="label">Follow-up date</span><input name="followUpDate" type="date" className="input py-1" /></label>
      </div>
      <button className="btn btn-primary btn-sm mt-2">Save feedback (updates preferences from explicit feedback only)</button>
    </ActionForm>
  );
}

export function LandownerForm({ clientId, lo, action }: { clientId: string; lo: Record<string, unknown> | null; action: Action }) {
  const v = (k: string) => (lo?.[k] === undefined || lo?.[k] === null ? '' : Array.isArray(lo[k]) ? (lo[k] as string[]).join(', ') : String(lo[k]));
  const stages = ['LEAD', 'OWNERSHIP_VERIFICATION', 'DOCUMENT_COLLECTION', 'TITLE_REVIEW', 'EC', 'ACCESS_REVIEW', 'PLANNING', 'LOCATION', 'VALUATION', 'DEVELOPMENT_POTENTIAL', 'COMMERCIAL', 'DECISION', 'LEGAL', 'EXECUTION'];
  return (
    <ActionForm action={action} resetOnSuccess={false} className="mt-2">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-1.5 text-xs sm:grid-cols-2">
        <label><span className="label">Stage</span><select name="stage" className="input py-1" defaultValue={v('stage') || 'LEAD'}>{stages.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></label>
        <label><span className="label">Land location</span><input name="location" className="input py-1" defaultValue={v('land_location')} /></label>
        <label><span className="label">Survey numbers (comma)</span><input name="surveyNumbers" className="input py-1" defaultValue={v('survey_numbers')} /></label>
        <label><span className="label">Extent (acres)</span><input name="extent" type="number" step="0.01" className="input py-1" defaultValue={v('extent_acres')} /></label>
        <label><span className="label">Co-owners (comma)</span><input name="coOwners" className="input py-1" defaultValue={v('co_owners')} /></label>
        <label><span className="label">Title documents (comma)</span><input name="titleDocs" className="input py-1" defaultValue={v('title_documents')} /></label>
        <label><span className="label">Patta status</span><input name="patta" className="input py-1" defaultValue={v('patta_status')} /></label>
        <label><span className="label">EC status</span><input name="ec" className="input py-1" defaultValue={v('ec_status')} /></label>
        <label><span className="label">Approval potential</span><input name="approvalPotential" className="input py-1" defaultValue={v('approval_potential')} /></label>
        <label><span className="label">Access</span><input name="access" className="input py-1" defaultValue={v('access')} /></label>
        <label><span className="label">Road frontage (ft)</span><input name="frontage" type="number" className="input py-1" defaultValue={v('road_frontage_ft')} /></label>
        <label><span className="label">Current use</span><input name="currentUse" className="input py-1" defaultValue={v('current_use')} /></label>
        <label><span className="label">Expected price (INR)</span><input name="expectedPrice" type="number" className="input py-1" defaultValue={v('expected_price')} /></label>
        <label><span className="label">Timeline</span><input name="timeline" className="input py-1" defaultValue={v('timeline')} /></label>
        <label className="flex items-center gap-1"><input type="checkbox" name="negotiable" defaultChecked={lo?.negotiable === true} /> Negotiable</label>
        <label><span className="label">Reason for sale (only if volunteered)</span><input name="reason" className="input py-1" defaultValue={v('reason_for_sale')} /></label>
      </div>
      <button className="btn btn-primary btn-sm mt-2">Save landowner profile</button>
    </ActionForm>
  );
}
