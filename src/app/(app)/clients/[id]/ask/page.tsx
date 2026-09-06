import { loadClient } from '@/lib/db/load-client';
import { Panel } from '@/components/ui/panel';
import { AskPanel } from '@/components/engagement/ask-panel';

export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await loadClient(id, 'ask');
  return (
    <Panel title="Natural-language investigation & relationship-manager assistant" right={<span className="text-[11px] text-ink-400">Structured data only - every answer cites sources</span>}>
      <AskPanel clientId={id} />
    </Panel>
  );
}
