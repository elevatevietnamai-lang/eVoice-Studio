import { afterEach, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import {
  dubSession,
  researchDubVideo,
  researchErrorMessage,
  researchFrameTimes,
  stopDubResearch,
} from './dub-session';

vi.mock('@/lib/api/client', async (load) => ({
  ...(await load<typeof import('@/lib/api/client')>()),
  apiFetch: vi.fn(),
}));
vi.mock('@/lib/saved-agent-model', () => ({
  savedAgentModel: vi.fn().mockResolvedValue('gemini-4-hydrogen-medium'),
}));

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function withBridge(repair: Record<string, unknown>) {
  Object.defineProperty(window, 'voicestudio', {
    configurable: true,
    value: {
      repair: {
        stopTranslation: vi.fn().mockResolvedValue(undefined),
        onTranslationEvent: () => () => {},
        ...repair,
      },
    } as unknown as Window['voicestudio'],
  });
}

function videoJob() {
  dubSession.setState((current) => ({
    ...current,
    jobId: 'research-job',
    phase: 'editing',
    recovery: null,
    inputType: 'video',
    duration: 300,
    filename: 'comfyui-tutorial.mp4',
    sourceLang: 'zh',
    translationInstructions: 'Xưng "mình".',
    segments: [
      { id: 'a', start: 0.2, end: 0.9, text: 'Nếu tôi không nói', text_original: '如果我不说' },
      { id: 'b', start: 0.9, end: 2.3, text: '', text_original: '你看得出来吗' },
    ],
  }));
}

afterEach(() => {
  vi.mocked(apiFetch).mockReset();
  delete (window as Partial<Window>).voicestudio;
});

it('spreads the research frames across the video, away from its first and last frame', () => {
  expect(researchFrameTimes(300)).toEqual([30, 90, 150, 210, 270]);
  expect(researchFrameTimes(0)).toEqual([]);
  expect(researchFrameTimes(Number.NaN)).toEqual([]);
});

it('strips the Electron IPC wrapper from an agent error', () => {
  expect(
    researchErrorMessage(
      new Error("Error invoking remote method 'repair:research': Error: An agent is already running"),
    ),
  ).toBe('An agent is already running');
});

it('sends the source transcript and frames to the chosen agent and stores its brief', async () => {
  const research = vi.fn().mockResolvedValue({ agent: 'agy', brief: '# Chủ đề\nComfyUI' });
  withBridge({ research });
  vi.mocked(apiFetch).mockImplementation(
    async () => new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } }),
  );
  videoJob();

  await expect(researchDubVideo('agy', 'Vietnamese')).resolves.toBe('# Chủ đề\nComfyUI');

  expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(5);
  expect(vi.mocked(apiFetch).mock.calls[0][0]).toBe(
    '/dub/hardsub/frame/research-job?t=30&width=768',
  );
  const request = research.mock.calls[0][0];
  expect(request).toMatchObject({
    agent: 'agy',
    model: 'gemini-4-hydrogen-medium',
    title: 'comfyui-tutorial.mp4',
    sourceLanguage: 'zh',
    targetLanguage: 'Vietnamese',
    existingNotes: 'Xưng "mình".',
    transcript: [
      { start: 0.2, end: 0.9, text: '如果我不说' },
      { start: 0.9, end: 2.3, text: '你看得出来吗' },
    ],
  });
  expect(request.frames).toHaveLength(5);
  expect(request.frames[0]).toMatchObject({ seconds: 30 });
  expect(Array.from(request.frames[0].jpeg)).toEqual(Array.from(JPEG));
  expect(dubSession.state.translationInstructions).toBe('# Chủ đề\nComfyUI');
});

it('keeps the brief field when research is stopped or fails', async () => {
  let release: (value: unknown) => void = () => {};
  const research = vi.fn(
    (_request: { frames: unknown[] }) => new Promise((resolve) => (release = resolve)),
  );
  const stopTranslation = vi.fn().mockResolvedValue(undefined);
  withBridge({ research, stopTranslation });
  vi.mocked(apiFetch).mockRejectedValue(new Error('no frame'));
  videoJob();

  const running = researchDubVideo('codex', 'Vietnamese');
  await vi.waitFor(() => expect(research).toHaveBeenCalled());
  // Frames that cannot be read are skipped; the transcript still goes.
  expect(research.mock.calls[0][0].frames).toEqual([]);
  stopDubResearch();
  expect(stopTranslation).toHaveBeenCalled();
  release({ agent: 'codex', brief: 'late brief' });
  await expect(running).resolves.toBeNull();
  expect(dubSession.state.translationInstructions).toBe('Xưng "mình".');

  withBridge({
    research: vi
      .fn()
      .mockRejectedValue(
        new Error("Error invoking remote method 'repair:research': Error: Agent research timed out"),
      ),
  });
  await expect(researchDubVideo('codex', 'Vietnamese')).rejects.toThrow('Agent research timed out');
  expect(dubSession.state.translationInstructions).toBe('Xưng "mình".');
});
