import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

import { tokenize } from './code-editor';
import { emptyDraft } from './promo-model';
import { SceneEditor } from './scene-editor';
import {
  assetName,
  assetProblem,
  newParam,
  sceneShot,
  starterScene,
  undeclaredKeys,
  validKey,
} from './scene-model';
import {
  isScenePreviewUrl,
  SCENE_FRAME_SANDBOX,
  ScenePreview,
  STUCK_AFTER_MS,
} from './scene-preview';

const starter = starterScene({
  name: 'S',
  title: 'T',
  subtitle: 'U',
  titleLabel: 'Title',
  subtitleLabel: 'Line',
  colorLabel: 'Color',
});

afterEach(() => {
  cleanup();
  delete (window as { voicestudio?: unknown }).voicestudio;
  vi.useRealTimers();
});

describe('scene model', () => {
  it('finds {{keys}} that are not params yet', () => {
    expect(undeclaredKeys({ ...starter, html: '{{title}} {{price}} {{width}} {{ Bad }}' })).toEqual(
      ['price'],
    );
  });

  it('picks a free, valid key for a new param', () => {
    expect(newParam(starter, 'text', 'title').key).toBe('title_2');
    expect(newParam(starter, 'text', 'price').key).toBe('price');
    expect(newParam(starter, 'color').value).toBe('#ffffff');
    expect(validKey('duration')).toBe(false);
    expect(validKey('9x')).toBe(false);
    expect(validKey('price_2')).toBe(true);
  });

  it('cleans file names and refuses what main would refuse', () => {
    expect(assetName('../../Logo final (2).PNG')).toBe('Logo-final-2-.PNG');
    expect(assetProblem(starter, 'run.exe', 10)).toBe('type');
    expect(assetProblem(starter, 'big.png', 5 * 1024 * 1024)).toBe('size');
    expect(assetProblem({ ...starter, assets: [{ name: 'a.png', data: '' }] }, 'A.png', 1)).toBe(
      'name',
    );
    expect(assetProblem(starter, 'ok.woff2', 1000)).toBeNull();
  });

  it('turns a rendered scene into a shot as long as the scene', () => {
    const media = {
      id: 'a.mp4',
      kind: 'video' as const,
      name: 'scene.mp4',
      duration: 6,
      width: 1080,
      height: 1920,
      url: '/x',
    };
    expect(sceneShot(media, 'k', 6)).toMatchObject({ duration: 6, motion: 'none', fit: 'cover' });
  });
});

describe('tokenize', () => {
  it.each([
    ['html', '<h1 class="a">{{title}}</h1><!-- c -->'],
    ['css', '.a{color:#fff;font:900 2em "Inter"} /* c */ @keyframes x{}'],
    ['js', 'const a = "x"; // c\nscene.onFrame((t) => 1.5 * t)'],
  ] as const)('keeps every character of %s', (language, code) => {
    const tokens = tokenize(code, language);
    expect(tokens.map((token) => token.text).join('')).toBe(code);
    expect(tokens.some((token) => token.kind !== 'plain')).toBe(true);
  });

  it('marks params in HTML', () => {
    expect(tokenize('<b>{{price}}</b>', 'html')).toContainEqual({
      text: '{{price}}',
      kind: 'param',
    });
  });
});

describe('ScenePreview', () => {
  it('runs scripts with no origin, popups, forms or top navigation', () => {
    expect(SCENE_FRAME_SANDBOX).toBe('allow-scripts');
    render(
      <ScenePreview
        url="promo-scene://preview/abc123"
        duration={2}
        width={1080}
        height={1920}
        boxWidth={180}
      />,
    );
    const frame = screen.getByTitle('promo.scene_preview');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toBe('promo-scene://preview/abc123');
  });

  it('never frames a page from anywhere else', () => {
    for (const url of [
      'https://example.com',
      'data:text/html,x',
      'promo-scene://other/abc',
      'javascript:alert(1)',
    ]) {
      expect(isScenePreviewUrl(url)).toBe(false);
    }
    const { container } = render(
      <ScenePreview
        url="https://example.com"
        duration={2}
        width={100}
        height={100}
        boxWidth={100}
      />,
    );
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('replaces a page that stopped answering with a notice', async () => {
    vi.useFakeTimers();
    render(
      <ScenePreview
        url="promo-scene://preview/abc"
        duration={30}
        width={100}
        height={100}
        boxWidth={100}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(STUCK_AFTER_MS + 600);
    });
    expect(screen.getByRole('status')).toHaveTextContent('promo.scene_stuck');
    expect(document.querySelector('iframe')).toBeNull();
  });
});

function bridge(overrides: Record<string, unknown> = {}) {
  const scenes = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    save: vi.fn(async (scene: object) => ({
      ok: true,
      scene: { ...scene, id: '0123456789abcdef' },
    })),
    remove: vi.fn(async () => {}),
    importFile: vi.fn(async () => ({ ok: false, code: 'cancelled' })),
    exportFile: vi.fn(async () => ({ ok: true })),
    preview: vi.fn(async (_request: unknown) => ({
      ok: true,
      url: 'promo-scene://preview/aa',
      problems: [],
    })),
    render: vi.fn(async (_request: unknown, _fps: number) => ({
      ok: true,
      media: {
        id: 'x.mp4',
        kind: 'video',
        name: 'scene.mp4',
        duration: 4,
        width: 1080,
        height: 1920,
        url: '/m',
      },
    })),
    ...overrides,
  };
  (window as { voicestudio?: unknown }).voicestudio = {
    promo: {
      scenes,
      browserState: vi.fn(async () => ({ state: 'ready', executablePath: '/x' })),
      onBrowserState: () => () => {},
      onRenderProgress: () => () => {},
      cancelRender: vi.fn(),
    },
  };
  return scenes;
}

describe('SceneEditor', () => {
  const props = () => ({
    draft: emptyDraft(),
    busy: false,
    onBusy: vi.fn(),
    onAddOverlay: vi.fn(),
    onAddShot: vi.fn(),
  });

  it('says scenes need the desktop app in a browser', () => {
    render(<SceneEditor {...props()} />);
    expect(screen.getByText('promo.scene_desktop_only')).toBeTruthy();
  });

  it('previews through main and adds a rendered shot', async () => {
    const scenes = bridge();
    const p = props();
    render(<SceneEditor {...p} />);
    await waitFor(() => expect(scenes.preview).toHaveBeenCalled());
    expect(scenes.preview.mock.calls[0][0]).toMatchObject({ width: 1080, height: 1920 });
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    fireEvent.click(screen.getByText('promo.scene_add_shot'));
    await waitFor(() => expect(p.onAddShot).toHaveBeenCalled());
    expect(scenes.render.mock.calls[0][0]).toMatchObject({ mode: 'shot' });
    expect(p.onAddShot.mock.calls[0][0]).toMatchObject({ duration: 4, motion: 'none' });
  });

  it('shows what blocks a scene and does not render it', async () => {
    const scenes = bridge({
      preview: vi.fn(async () => ({
        ok: false,
        code: 'scene_problems',
        problems: [{ code: 'remote_url', detail: 'https://x.example/a.png' }],
      })),
    });
    render(<SceneEditor {...props()} />);
    await waitFor(() => expect(screen.getByText(/promo.scene_problem_remote_url/)).toBeTruthy());
    expect(
      (screen.getByText('promo.scene_add_overlay').closest('button') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(scenes.render).not.toHaveBeenCalled();
  });

  it('saves the scene and lists it', async () => {
    const scenes = bridge();
    render(<SceneEditor {...props()} />);
    await waitFor(() => expect(scenes.preview).toHaveBeenCalled());
    fireEvent.click(screen.getByText('promo.scene_save'));
    await waitFor(() => expect(scenes.save).toHaveBeenCalled());
    expect(scenes.save.mock.calls[0][0]).toMatchObject({
      id: null,
      name: 'promo.scene_builtin_starter',
    });
    await waitFor(() => expect(screen.getByText('promo.scene_saved')).toBeTruthy());
  });
});
