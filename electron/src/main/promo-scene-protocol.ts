import { randomBytes } from 'node:crypto';
import { app, protocol, webContents, type WebContents } from 'electron';
import { SCENE_CSP } from './promo-scenes';

/**
 * The scheme the custom-scene preview loads from.
 *
 * A `srcdoc`, `blob:` or `data:` frame inherits the app page's Content
 * Security Policy, which blocks the scene's inline scripts and allows the
 * backend and a few web hosts. A page on its own scheme gets only the policy
 * sent here: no network, no files, no frames. The renderer embeds it in an
 * `<iframe sandbox="allow-scripts">` (no same origin, no popups, no top
 * navigation) and its own CSP lets frames load from this scheme alone.
 *
 * On top of that, main refuses any navigation that would take a preview frame
 * somewhere else (`location=`, `<meta refresh>`), and turns off WebRTC UDP for
 * the window that shows a preview, since CSP does not cover WebRTC.
 */

export const SCENE_SCHEME = 'promo-scene';
const HOST = 'preview';
export const SCENE_PREVIEW_ORIGIN = `${SCENE_SCHEME}://${HOST}`;

/** Registered with the app scheme, before `app.whenReady()` (protocol.ts). */
export const SCENE_SCHEME_PRIVILEGES = {
  scheme: SCENE_SCHEME,
  privileges: { standard: true, secure: true },
} as const;

const KEEP = 6;

/** The last few preview pages, by unguessable token. */
export class ScenePreviews {
  private readonly pages = new Map<string, string>();

  add(html: string): string {
    const token = randomBytes(12).toString('hex');
    this.pages.set(token, html);
    while (this.pages.size > KEEP) this.pages.delete(this.pages.keys().next().value!);
    return `${SCENE_PREVIEW_ORIGIN}/${token}`;
  }

  get(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== `${SCENE_SCHEME}:` || parsed.hostname !== HOST) return null;
    return this.pages.get(parsed.pathname.replace(/^\//, '')) ?? null;
  }
}

export const sceneResponseHeaders = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': SCENE_CSP,
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

/** True when a navigation must be refused: a preview frame leaving its scheme. */
export function blocksFrameNavigation(currentUrl: string, targetUrl: string): boolean {
  if (!currentUrl.startsWith(`${SCENE_SCHEME}:`)) return false;
  return !targetUrl.startsWith(`${SCENE_PREVIEW_ORIGIN}/`);
}

function guard(contents: WebContents): void {
  contents.on('will-frame-navigate', (event) => {
    const target = event.url;
    if (target.startsWith(`${SCENE_SCHEME}:`)) {
      contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    }
    if (event.isMainFrame) {
      // The app window itself never belongs on the preview scheme.
      if (target.startsWith(`${SCENE_SCHEME}:`)) event.preventDefault();
      return;
    }
    let current = '';
    try {
      current = event.frame?.url ?? '';
    } catch {
      current = '';
    }
    if (blocksFrameNavigation(current, target)) event.preventDefault();
  });
}

export function installScenePreviewProtocol(previews: ScenePreviews): void {
  protocol.handle(SCENE_SCHEME, (request) => {
    const html = request.method === 'GET' ? previews.get(request.url) : null;
    if (html === null) return new Response('Not found', { status: 404 });
    return new Response(html, { status: 200, headers: sceneResponseHeaders });
  });
  for (const contents of webContents.getAllWebContents()) guard(contents);
  app.on('web-contents-created', (_event, contents) => guard(contents));
}
