/**
 * AI executive summary.
 * Operates ONLY on the structured assessment (never the raw payload), must cite evidence keys,
 * and falls back to a deterministic template when no model key is configured.
 * The output is advisory; it never overrides verified source information.
 */
import type { Assessment, CanonicalProfile } from '@/lib/canonical/types';

export interface AiSummary {
  mode: 'MODEL' | 'DETERMINISTIC';
  model?: string;
  sentences: Array<{ text: string; evidence: string[] }>;
  generatedAt: string;
  disclaimer: string;
}

const DISCLAIMER = 'Assistive narrative generated from structured, authorised data only. Every sentence cites the summary lines or signals it is based on. It does not replace analyst judgement and cannot override verified source information.';

export function deterministicSummary(p: CanonicalProfile, a: Assessment): AiSummary {
  const s = Object.fromEntries(a.summary.map((l) => [l.key, l]));
  const out: AiSummary['sentences'] = [];
  const credit = p.credit?.score;
  const current = p.employment.records.find((r) => r.status === 'CURRENT');
  if (s.identity) out.push({ text: `Identity: ${s.identity.value.toLowerCase()} across ${a.identityChecks.filter((c) => c.status !== 'NOT_AVAILABLE').length} comparable checks.`, evidence: ['identity'] });
  if (credit && current) out.push({ text: `Credit score of ${credit} is ${credit >= 750 ? 'strong' : credit >= 700 ? 'good' : 'below the good band'} and current employment at ${current.employer.name} appears stable based on EPFO records since ${s.since?.value ?? 'the recorded joining date'}.`, evidence: ['credit', 'employment', 'since'] });
  else if (credit) out.push({ text: `Credit score of ${credit} is available; no current EPFO employment is on record, which is not negative on its own.`, evidence: ['credit', 'employment'] });
  else if (current) out.push({ text: `Current employment at ${current.employer.name} is recorded by EPFO; no bureau score was returned.`, evidence: ['employment', 'credit'] });
  else out.push({ text: 'Neither a current employment record nor a bureau score is available in this run.', evidence: ['employment', 'credit'] });
  const review = a.riskSignals.filter((x) => x.requiresReview && !['DISMISSED', 'RESOLVED'].includes(x.status));
  if (review.length) out.push({ text: `${review.length} signal${review.length > 1 ? 's' : ''} require${review.length > 1 ? '' : 's'} human review, the highest being ${review[0].severity.toLowerCase()}: ${review[0].title}.`, evidence: review.slice(0, 3).map((r) => `signal:${r.ruleKey}`) });
  else out.push({ text: 'No signals currently require human review.', evidence: ['risk'] });
  if (a.overall.missing.length) out.push({ text: `Not available in this run: ${a.overall.missing.slice(0, 4).join(', ')}${a.overall.missing.length > 4 ? ' and more' : ''}. Missing information is not treated as negative.`, evidence: ['confidence'] });
  out.push({ text: `Overall data confidence is ${a.overall.confidence.toLowerCase()} with ${Math.round(a.overall.completeness * 100)}% completeness and ${a.overall.freshness.toLowerCase()} freshness.`, evidence: ['confidence'] });
  return { mode: 'DETERMINISTIC', sentences: out, generatedAt: new Date().toISOString(), disclaimer: DISCLAIMER };
}

export async function generateSummary(p: CanonicalProfile, a: Assessment): Promise<AiSummary> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return deterministicSummary(p, a);
  const model = process.env.BENFILE_AI_MODEL ?? 'claude-sonnet-5';
  const facts = {
    summary: a.summary.map((l) => ({ key: l.key, label: l.label, value: l.value, assertion: l.assertion })),
    signals: a.riskSignals.filter((s) => !['DISMISSED', 'RESOLVED'].includes(s.status)).map((s) => ({ key: `signal:${s.ruleKey}`, severity: s.severity, title: s.title, requiresReview: s.requiresReview })),
    checks: a.identityChecks.map((c) => ({ key: `check:${c.key}`, label: c.label, status: c.status })),
    overall: a.overall,
    missing: a.overall.missing,
  };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        system:
          'You are an assistant to a financial-crime/KYC analyst. You receive ONLY structured, already-verified findings. Write 3-6 short sentences for an analyst. Rules: never invent facts; never mention anything absent from the input; treat missing data as "not available", never as negative; do not speculate about fraud; do not infer financial capacity from income and credit score. Return ONLY JSON: {"sentences":[{"text":"...","evidence":["<key from input>", ...]}]} where every sentence cites at least one input key.',
        messages: [{ role: 'user', content: JSON.stringify(facts) }],
      }),
    });
    if (!r.ok) throw new Error(`model ${r.status}`);
    const j = (await r.json()) as { content: Array<{ type: string; text?: string }> };
    const text = j.content.find((c) => c.type === 'text')?.text ?? '';
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { sentences: AiSummary['sentences'] };
    const allowed = new Set([...facts.summary.map((x) => x.key), ...facts.signals.map((x) => x.key), ...facts.checks.map((x) => x.key), 'confidence']);
    const sentences = parsed.sentences.filter((s) => s.evidence.some((e) => allowed.has(e))).slice(0, 6);
    if (!sentences.length) throw new Error('no cited sentences');
    return { mode: 'MODEL', model, sentences, generatedAt: new Date().toISOString(), disclaimer: DISCLAIMER };
  } catch {
    return deterministicSummary(p, a);
  }
}
