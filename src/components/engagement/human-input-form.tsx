'use client';
import { useState } from 'react';
import { addHumanInput, verifyHumanInput } from '@/lib/actions-wealth';
import { ActionForm } from '@/components/ui/action-form';
import { HUMAN_CATEGORIES, HUMAN_SOURCE_TYPES } from '@/lib/wealth/human-input-constants';



export function HumanInputForm({ clientId }: { clientId: string }) {
  const [category, setCategory] = useState('PERSONAL_OBSERVATION');
  const [body, setBody] = useState('');
  const prompt = HUMAN_CATEGORIES.find((c) => c.key === category)?.prompt ?? '';
  return (
    <ActionForm action={addHumanInput} className="rounded-lg border border-dashed border-amber-400/40 bg-amber-400/[0.03] p-3" onDone={() => setBody('')}>
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label">Category</label>
          <select name="category" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {HUMAN_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Source type (who is asserting this?)</label>
          <select name="sourceType" className="input" defaultValue="FIRST_HAND_OBSERVATION">
            {HUMAN_SOURCE_TYPES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="label mt-2">{prompt}</label>
      <textarea name="body" className="input h-24 resize-none" required minLength={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Record it in plain words. This is stored as human context and never becomes a fact, a score input or a profile value." />
      <p className="mt-1 text-[11px] text-amber-300/80">
        {body.trim().length ? `${body.trim().length} characters. ` : ''}
        Claims, verification plan and follow-up questions are extracted after saving and shown on the item below.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <div>
          <label className="label">Attributed to (person / role)</label>
          <input name="attributedTo" className="input" placeholder="e.g. introducer R. Kumar" />
        </div>
        <div>
          <label className="label">Author confidence (not verification confidence)</label>
          <select name="authorConfidence" className="input" defaultValue="LOW">
            <option value="VERY_LOW">Very low</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
        </div>
        <div>
          <label className="label">Language</label>
          <select name="language" className="input" defaultValue="en">
            <option value="en">English</option>
            <option value="ta">Tamil</option>
            <option value="hi">Hindi</option>
          </select>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-200">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" name="firstHand" /> First-hand (I saw / heard it myself)
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" name="clientConfirmed" /> Client confirmed it directly
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" name="hasEvidence" /> Evidence exists (document / record)
        </label>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <input name="relatedCompany" className="input" placeholder="Related company (optional)" />
        <input name="relatedProperty" className="input" placeholder="Related property (optional)" />
        <input name="relatedTransaction" className="input" placeholder="Related transaction (optional)" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[11px] text-ink-400">Saved as UNVERIFIED human context. Influence on the financial profile: NONE.</span>
        <button className="btn btn-primary">Record human input</button>
      </div>
    </ActionForm>
  );
}

export function VerifyHumanInputButton({ id }: { id: string }) {
  return (
    <ActionForm action={verifyHumanInput} className="inline-block" confirm="Run an authorised verification search for the claims in this note? Only consented connectors are used; the original note is preserved unchanged.">
      <input type="hidden" name="id" value={id} />
      <button className="btn btn-sm btn-primary">Verify this information</button>
    </ActionForm>
  );
}
