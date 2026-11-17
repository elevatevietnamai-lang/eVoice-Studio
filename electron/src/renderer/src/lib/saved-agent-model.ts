import type { RepairAgentId } from '../../../preload/index.d';
import { apiJson } from '@/lib/api/client';
import { queryClient } from '@/lib/query';

/** CLI agents whose model is chosen in Settings > LLM providers (the same saved value). */
const AGENT_PROVIDER: Partial<Record<RepairAgentId, string>> = { agy: 'agy-cli' };

/** The model saved for this agent's LLM provider, so dub translation uses the Gemini model picked there. */
export async function savedAgentModel(agent: RepairAgentId): Promise<string> {
  const providerId = AGENT_PROVIDER[agent];
  if (!providerId) return '';
  try {
    const catalogue = await queryClient.fetchQuery({
      queryKey: ['llm-providers'],
      queryFn: ({ signal }) =>
        apiJson<{ providers: Array<{ id: string; model: string }> }>(
          '/api/settings/llm-providers',
          { signal },
        ),
      staleTime: 30_000,
    });
    const model = catalogue.providers.find((item) => item.id === providerId)?.model?.trim() || '';
    return /^[a-zA-Z0-9][\w./:@+-]*$/.test(model) && model.length <= 200 ? model : '';
  } catch {
    // The CLI's own default model still translates.
    return '';
  }
}
