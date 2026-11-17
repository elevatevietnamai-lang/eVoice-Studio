import { afterEach, describe, expect, it, vi } from 'vitest';

const apiJson = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiJson: (...args: unknown[]) => apiJson(...args) }));

import { queryClient } from '@/lib/query';
import { saveAgentModel, savedAgentModel, validModelId } from './saved-agent-model';

afterEach(() => {
  localStorage.clear();
  apiJson.mockReset();
  queryClient.clear();
});

describe('saved agent model', () => {
  it('keeps a CLI model on this computer and reads it back for runs', async () => {
    expect(await savedAgentModel('claude')).toBe('');
    await saveAgentModel('claude', 'sonnet');
    expect(await savedAgentModel('claude')).toBe('sonnet');
    await saveAgentModel('claude', '');
    expect(await savedAgentModel('claude')).toBe('');
    expect(apiJson).not.toHaveBeenCalled();
  });

  it('saves Gemini in its LLM provider, the value Settings shows', async () => {
    apiJson.mockResolvedValue({ providers: [{ id: 'agy-cli', model: 'gemini-4-hydrogen-medium' }] });
    await saveAgentModel('agy', 'gemini-4-hydrogen-medium');
    expect(apiJson).toHaveBeenCalledWith(
      '/api/settings/llm-providers/agy-cli',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(JSON.parse(apiJson.mock.calls[0][1].body)).toEqual({
      model: 'gemini-4-hydrogen-medium',
      make_active: false,
      activate_if_unset: false,
    });
    expect(await savedAgentModel('agy')).toBe('gemini-4-hydrogen-medium');
  });

  it('never passes a value that is not a model id to a CLI', async () => {
    expect(validModelId('--dangerously-skip-permissions')).toBe(false);
    expect(validModelId(':default')).toBe(false);
    localStorage.setItem('voicestudio.agent-model.codex', '--yolo');
    expect(await savedAgentModel('codex')).toBe('');
    await expect(saveAgentModel('codex', '-x')).rejects.toThrow();
  });
});
