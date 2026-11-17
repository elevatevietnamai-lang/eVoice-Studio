import { beforeEach, expect, it, vi } from 'vitest';
import { apiJson } from '@/lib/api/client';
import { queryClient } from '@/lib/query';
import { savedAgentModel } from './dub-session';

vi.mock('@/lib/api/client', async (load) => ({
  ...(await load<typeof import('@/lib/api/client')>()),
  apiJson: vi.fn(),
}));

beforeEach(() => {
  queryClient.clear();
  vi.mocked(apiJson).mockReset();
});

it('translates with the Gemini model saved for the Antigravity provider', async () => {
  vi.mocked(apiJson).mockResolvedValue({
    providers: [
      { id: 'codex-cli', model: 'gpt-x' },
      { id: 'agy-cli', model: ' gemini-3.8-flash-low ' },
    ],
  });
  expect(await savedAgentModel('agy')).toBe('gemini-3.8-flash-low');
  expect(apiJson).toHaveBeenCalledWith('/api/settings/llm-providers', expect.anything());
});

it('leaves other agents and unusable values on the CLI default', async () => {
  vi.mocked(apiJson).mockResolvedValue({ providers: [{ id: 'agy-cli', model: '--yolo' }] });
  expect(await savedAgentModel('codex')).toBe('');
  expect(apiJson).not.toHaveBeenCalled();
  expect(await savedAgentModel('agy')).toBe('');
});

it('still translates when the backend cannot answer', async () => {
  vi.mocked(apiJson).mockRejectedValue(new Error('offline'));
  expect(await savedAgentModel('agy')).toBe('');
});
