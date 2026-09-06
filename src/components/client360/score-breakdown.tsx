import type { ProfileScore } from '@/lib/canonical/types';
import { EvidenceDrawer } from '@/components/ui/evidence';

export function ScoreBreakdown({ score, runId }: { score: ProfileScore; runId: string | null }) {
  return (
    <div className="mt-2">
      <ul className="space-y-2">
        {score.components.map((c) => (
          <li key={c.key}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-200">
                {c.label} <span className="text-ink-500">x{Math.round(c.weight * 100)}%</span>
              </span>
              <span className="mono text-ink-100">{c.score === null ? 'N/A' : c.score}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-white/[0.06]">
              <div className={`h-full ${c.score === null ? 'bg-ink-600' : c.score >= 75 ? 'bg-verified' : c.score >= 50 ? 'bg-info' : 'bg-warn'}`} style={{ width: `${c.score ?? 0}%` }} />
            </div>
            <div className="mt-1 flex items-start justify-between gap-2 text-[11px] text-ink-400">
              <span>{c.rationale}</span>
              {c.evidence.length ? <EvidenceDrawer runId={runId} evidence={c.evidence} title={c.label} /> : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
        {score.disclaimer} Config <span className="mono">{score.configVersion}</span>.
      </p>
    </div>
  );
}
