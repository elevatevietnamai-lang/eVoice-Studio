// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => ({
  protocol: null as null | ((request: Request) => Response | Promise<Response>),
  navigate: [] as ((event: unknown) => void)[],
  policy: vi.fn(),
}));

vi.mock('electron', () => {
  const contents = {
    on: (name: string, listener: (event: unknown) => void) => {
      if (name === 'will-frame-navigate') handlers.navigate.push(listener);
    },
    setWebRTCIPHandlingPolicy: handlers.policy,
  };
  return {
    app: { on: vi.fn() },
    protocol: {
      handle: (_scheme: string, handler: (request: Request) => Response) => {
        handlers.protocol = handler;
      },
    },
    webContents: { getAllWebContents: () => [contents] },
  };
});

const {
  blocksFrameNavigation,
  installScenePreviewProtocol,
  SCENE_PREVIEW_ORIGIN,
  SCENE_SCHEME,
  SCENE_SCHEME_PRIVILEGES,
  ScenePreviews,
} = await import('./promo-scene-protocol');
const { SCENE_CSP } = await import('./promo-scenes');

function navigation(url: string, frameUrl: string, isMainFrame = false) {
  const event = {
    url,
    isMainFrame,
    frame: { url: frameUrl },
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
  };
  for (const listener of handlers.navigate) listener(event);
  return event.prevented;
}

describe('scene preview protocol', () => {
  it('serves a stored page with its own no-network policy', async () => {
    const previews = new ScenePreviews();
    installScenePreviewProtocol(previews);
    const url = previews.add('<p>scene</p>');
    expect(url.startsWith(`${SCENE_PREVIEW_ORIGIN}/`)).toBe(true);
    const response = await handlers.protocol!(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(SCENE_CSP);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('<p>scene</p>');
  });

  it('answers 404 for unknown tokens, other hosts and other methods', async () => {
    const previews = new ScenePreviews();
    installScenePreviewProtocol(previews);
    const url = previews.add('<p>x</p>');
    const token = url.split('/').pop();
    for (const request of [
      new Request(`${SCENE_PREVIEW_ORIGIN}/0000`),
      new Request(`${SCENE_SCHEME}://other/${token}`),
      new Request(url, { method: 'POST', body: 'x' }),
    ]) {
      expect((await handlers.protocol!(request)).status).toBe(404);
    }
  });

  it('keeps only the last few pages', () => {
    const previews = new ScenePreviews();
    const first = previews.add('a');
    for (let i = 0; i < 6; i += 1) previews.add(String(i));
    expect(previews.get(first)).toBeNull();
  });

  it('refuses navigations that take a preview frame off its scheme', () => {
    const inside = `${SCENE_PREVIEW_ORIGIN}/abc`;
    expect(blocksFrameNavigation(inside, 'https://example.com/?leak=1')).toBe(true);
    expect(blocksFrameNavigation(inside, 'https://docs.google.com/forms')).toBe(true);
    expect(blocksFrameNavigation(inside, 'data:text/html,x')).toBe(true);
    expect(blocksFrameNavigation(inside, `${SCENE_PREVIEW_ORIGIN}/def`)).toBe(false);
    // Frames that are not previews are left alone.
    expect(blocksFrameNavigation('https://docs.google.com/x', 'https://docs.google.com/y')).toBe(
      false,
    );
    expect(navigation('https://example.com/', inside)).toBe(true);
    expect(navigation(`${SCENE_PREVIEW_ORIGIN}/next`, 'about:blank')).toBe(false);
    // The app window itself may never load the preview scheme.
    expect(navigation(`${SCENE_PREVIEW_ORIGIN}/x`, 'app://voicestudio/', true)).toBe(true);
  });

  it('turns off WebRTC UDP once a window loads a preview', () => {
    handlers.policy.mockClear();
    navigation(`${SCENE_PREVIEW_ORIGIN}/x`, 'about:blank');
    expect(handlers.policy).toHaveBeenCalledWith('disable_non_proxied_udp');
  });

  it('is registered without CSP bypass, fetch or CORS', () => {
    expect(SCENE_SCHEME_PRIVILEGES.privileges).toEqual({ standard: true, secure: true });
  });

  it('is the only extra frame source in the renderer policy', () => {
    const html = readFileSync(join(__dirname, '../renderer/index.html'), 'utf8');
    const frameSrc = /frame-src ([^;"]+)/.exec(html)![1].trim().split(/\s+/);
    expect(frameSrc).toContain(SCENE_PREVIEW_ORIGIN);
    expect(frameSrc.filter((source) => !source.startsWith('https://'))).toEqual([
      SCENE_PREVIEW_ORIGIN,
    ]);
    // Scripts in the app page stay restricted to its own bundle.
    expect(html).toMatch(/script-src 'self';/);
  });
});
