import type { RepairAgentId } from '../../../preload/index.d';
import { apiJson } from '@/lib/api/client';
import { queryClient } from '@/lib/query';

/** CLI agents whose model is chosen in Settings > LLM providers (the same saved value). */
const AGENT_PROVIDER: Partial<Record<RepairAgentId, string>> = { agy: 'agy-cli' };
const PROVIDERS_ENDPOINT = '/api/settings/llm-providers';
const localKey = (agent: RepairAgentId) => `voicestudio.agent-model.${agent}`;

/** Model ids every agent CLI accepts after `--model`; anything else is dropped. */
export function validModelId(model: string): boolean {
  return model === '' || (/^[a-zA-Z0-9][\w./:@+-]*$/.test(model) && model.length <= 200);
}

/**
 * The model saved for an agent, used by Ask VoiceStudio Agent and Translate with Agent alike.
 * Gemini keeps it in its LLM provider (Settings shows and edits the same value); the other CLIs
 * keep it on this computer. Empty means the CLI's own default.
 */
export async function savedAgentModel(agent: RepairAgentId): Promise<string> {
  const providerId = AGENT_PROVIDER[agent];
  if (!providerId) {
    try {
      const model = localStorage.getItem(localKey(agent))?.trim() ?? '';
      return validModelId(model) ? model : '';
    } catch {
      return '';
    }
  }
  try {
    const catalogue = await queryClient.fetchQuery({
      queryKey: ['llm-providers'],
      queryFn: ({ signal }) =>
        apiJson<{ providers: Array<{ id: string; model: string }> }>(PROVIDERS_ENDPOINT, {
          signal,
        }),
      staleTime: 30_000,
    });
    const model = catalogue.providers.find((item) => item.id === providerId)?.model?.trim() || '';
    return validModelId(model) ? model : '';
  } catch {
    // The CLI's own default model still runs.
    return '';
  }
}

/** Saves the model for an agent where `savedAgentModel` reads it. */
export async function saveAgentModel(agent: RepairAgentId, model: string): Promise<void> {
  if (!validModelId(model)) throw new Error('Invalid agent model');
  const providerId = AGENT_PROVIDER[agent];
  if (!providerId) {
    try {
      if (model) localStorage.setItem(localKey(agent), model);
      else localStorage.removeItem(localKey(agent));
    } catch {
      // Without storage the choice lasts for this run only.
    }
    return;
  }
  await apiJson(`${PROVIDERS_ENDPOINT}/${encodeURIComponent(providerId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, make_active: false, activate_if_unset: false }),
  });
  await queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
}
