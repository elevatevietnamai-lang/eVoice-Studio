import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: 'vi', resolvedLanguage: 'vi' },
  }),
}));

const apiJson = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiJson: (path: string, init?: RequestInit) => apiJson(path, init),
}));

import { ApiError } from '@/lib/api/client';
import { SceneWriter, writerErrorKey, type WriterProvider } from './scene-writer';

const READY: WriterProvider = {
  ready: true,
  reason: null,
  provider_id: 'ollama',
  display_name: 'Ollama',
  local: true,
  transport: 'openai',
};
const SCENE = {
  id: null,
  name: '',
  html: '<p>{{t}}</p>',
  css: '',
  js: '',
  params: [{ key: 't', type: 'text', label: 'T', value: 'Hi' }],
  assets: [],
  duration: 4,
};

beforeEach(() => apiJson.mockReset());
afterEach(cleanup);

const open = () => fireEvent.click(screen.getByText('promo.scene_ai_open'));

describe('SceneWriter', () => {
  it('asks nothing until opened, then names the provider before anything is sent', async () => {
    apiJson.mockResolvedValue(READY);
    render(<SceneWriter disabled={false} onScene={() => {}} />);
    expect(apiJson).not.toHaveBeenCalled();
    open();
    const line = await screen.findByTestId('scene-ai-destination');
    expect(line.textContent).toBe('promo.scene_ai_sends_local:{"provider":"Ollama"}');
    expect(apiJson).toHaveBeenCalledTimes(1);
    expect(apiJson.mock.calls[0][1]).toBeUndefined(); // a GET: nothing sent
  });

  it('says where a remote description goes', async () => {
    apiJson.mockResolvedValue({ ...READY, provider_id: 'groq', display_name: 'Groq', local: false });
    render(<SceneWriter disabled={false} onScene={() => {}} />);
    open();
    expect((await screen.findByTestId('scene-ai-destination')).textContent).toBe(
      'promo.scene_ai_sends_remote:{"provider":"Groq"}',
    );
  });

  it.each(['disabled', 'no_provider', 'unconfigured'] as const)(
    'offers no send button when the provider is %s',
    async (reason) => {
      apiJson.mockResolvedValue({ ...READY, ready: false, reason });
      render(<SceneWriter disabled={false} onScene={() => {}} />);
      open();
      await screen.findByText(new RegExp(`promo.scene_ai_not_ready_${reason}`));
      expect(screen.queryByText('promo.scene_ai_write')).toBeNull();
      expect(screen.queryByLabelText('promo.scene_ai_description')).toBeNull();
    },
  );

  it('sends the description with the shown provider and loads an unsaved draft', async () => {
    const onScene = vi.fn();
    apiJson.mockResolvedValueOnce(READY).mockResolvedValueOnce({ scene: SCENE });
    render(<SceneWriter disabled={false} onScene={onScene} />);
    open();
    const box = await screen.findByLabelText('promo.scene_ai_description');
    const write = screen.getByText('promo.scene_ai_write').closest('button')!;
    expect(write.disabled).toBe(true); // empty description
    fireEvent.change(box, { target: { value: '  a price tag  ' } });
    fireEvent.click(screen.getByText('promo.scene_ai_shape_shot'));
    fireEvent.click(write);
    await waitFor(() => expect(onScene).toHaveBeenCalled());
    const [path, init] = apiJson.mock.calls[1];
    expect(path).toBe('/promo/scene-writer');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      description: 'a price tag',
      provider_id: 'ollama',
      shape: 'shot',
      language: 'vi',
    });
    const loaded = onScene.mock.calls[0][0];
    expect(loaded.id).toBeNull();
    expect(loaded.name).toBe('promo.scene_ai_default_name');
    expect(screen.getByText('promo.scene_ai_done')).toBeTruthy();
  });

  it('rechecks the provider when it changed instead of sending elsewhere', async () => {
    apiJson
      .mockResolvedValueOnce(READY)
      .mockRejectedValueOnce(new ApiError(409, 'scene_writer:provider_changed'))
      .mockResolvedValueOnce({ ...READY, provider_id: 'groq', display_name: 'Groq', local: false });
    const onScene = vi.fn();
    render(<SceneWriter disabled={false} onScene={onScene} />);
    open();
    fireEvent.change(await screen.findByLabelText('promo.scene_ai_description'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByText('promo.scene_ai_write'));
    await screen.findByText('promo.scene_ai_error_provider_changed');
    expect(
      (await screen.findByTestId('scene-ai-destination')).textContent,
    ).toContain('Groq');
    expect(onScene).not.toHaveBeenCalled();
    expect(apiJson).toHaveBeenCalledTimes(3); // GET, refused POST, GET — no second POST
  });

  it('maps refusal codes to sentences', () => {
    expect(writerErrorKey(new ApiError(422, 'scene_writer:bad_reply'))).toBe(
      'promo.scene_ai_error_bad_reply',
    );
    expect(writerErrorKey(new ApiError(500, 'boom'))).toBe('promo.scene_ai_error_generic');
    expect(writerErrorKey(new Error('x'))).toBe('promo.scene_ai_error_generic');
  });
});
