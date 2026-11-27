import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import satori from 'satori';
import { fetchLogo, PromoRenderError, type PromoMediaResult, type PromoRenderDeps } from './promo-render';
import { packageDir } from './promo-scene-runtime';
import { logoDataUri } from './promo-scenes';
import { LOGO_ID, TEMPLATE_FONTS, type FontId, type TemplateLogo } from './promo-templates';

/**
 * Still images for a promo (a video thumbnail, an ad poster, a square post),
 * drawn without a browser: Satori lays a template out as SVG with the bundled
 * fonts, resvg turns it into a PNG. Both run as code and WebAssembly inside
 * this process, so a still needs no Chrome download and no network.
 */

export const STILL_TEMPLATES = {
  thumbnail: { width: 1280, height: 720 },
  poster: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
} as const;
export type StillTemplate = keyof typeof STILL_TEMPLATES;

export interface StillInput {
  template: StillTemplate;
  title: string;
  subtitle: string;
  /** A short tag in a pill (“NEW”, “-30%”), or ''. */
  badge: string;
  background: string;
  accent: string;
  color: string;
  /** Promo media id of a PNG, JPEG or WebP logo, or null. */
  logoId: string | null;
}

export class StillInputError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`invalid_still:${field}`);
    this.field = field;
  }
}

const COLOR = /^#[0-9a-f]{6}$/i;
const LIMITS = { title: 80, subtitle: 140, badge: 24 } as const;

function text(value: unknown, field: keyof typeof LIMITS): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new StillInputError(field);
  const clean = value.replace(/\p{Cc}/gu, ' ').trim().normalize('NFC');
  if ([...clean].length > LIMITS[field]) throw new StillInputError(field);
  return clean;
}

function color(value: unknown, field: string): string {
  if (typeof value !== 'string' || !COLOR.test(value)) throw new StillInputError(field);
  return value.toLowerCase();
}

/** Validates an untrusted still request (from the renderer or an agent). */
export function parseStillInput(raw: unknown): StillInput {
  if (!raw || typeof raw !== 'object') throw new StillInputError('input');
  const input = raw as Record<string, unknown>;
  if (typeof input.template !== 'string' || !(input.template in STILL_TEMPLATES)) {
    throw new StillInputError('template');
  }
  let logoId: string | null = null;
  if (input.logoId !== undefined && input.logoId !== null && input.logoId !== '') {
    if (typeof input.logoId !== 'string' || !LOGO_ID.test(input.logoId)) {
      throw new StillInputError('logoId');
    }
    if (!/\.(png|jpe?g|webp)$/i.test(input.logoId)) throw new StillInputError('logoId');
    logoId = input.logoId;
  }
  const title = text(input.title, 'title');
  if (!title) throw new StillInputError('title');
  return {
    template: input.template as StillTemplate,
    title,
    subtitle: text(input.subtitle, 'subtitle'),
    badge: text(input.badge, 'badge'),
    background: color(input.background, 'background'),
    accent: color(input.accent, 'accent'),
    color: color(input.color, 'color'),
    logoId,
  };
}

// ── Layout ──────────────────────────────────────────────────────────────────

/** A Satori element: the shape JSX compiles to, written out as data. */
export interface StillNode {
  type: string;
  props: { style?: Record<string, unknown>; children?: StillChild | StillChild[]; src?: string };
}
type StillChild = StillNode | string;

const el = (
  type: string,
  style: Record<string, unknown>,
  children?: StillChild | StillChild[],
  extra: Record<string, unknown> = {},
): StillNode => ({ type, props: { style, children, ...extra } });

/** The template's element tree, at its own size. */
export function stillTree(input: StillInput, logo?: string): StillNode {
  const { width, height } = STILL_TEMPLATES[input.template];
  const unit = Math.min(width, height) / 100;
  const wide = width > height;
  const align = wide ? 'flex-start' : 'center';
  const titleSize = unit * (wide ? 11 : input.template === 'poster' ? 13 : 11);
  const parts: StillChild[] = [];
  if (logo) {
    parts.push(
      el('img', { height: unit * 14, objectFit: 'contain', marginBottom: unit * 5 }, undefined, {
        src: logo,
      }),
    );
  }
  if (input.badge) {
    parts.push(
      el(
        'div',
        {
          display: 'flex',
          background: input.accent,
          color: input.background,
          fontFamily: 'Inter',
          fontWeight: 700,
          fontSize: unit * 4.2,
          padding: `${unit * 1.2}px ${unit * 3}px`,
          borderRadius: unit * 5,
          marginBottom: unit * 4,
          letterSpacing: unit * 0.2,
        },
        input.badge,
      ),
    );
  }
  parts.push(
    el(
      'div',
      {
        display: 'flex',
        fontFamily: 'Oswald',
        fontSize: titleSize,
        lineHeight: 1.05,
        color: input.color,
        textAlign: wide ? 'left' : 'center',
        textTransform: 'uppercase',
        maxWidth: width * (wide ? 0.72 : 0.84),
      },
      input.title,
    ),
  );
  parts.push(
    el('div', {
      display: 'flex',
      width: unit * 16,
      height: unit * 1.4,
      background: input.accent,
      borderRadius: unit,
      margin: `${unit * 4}px 0`,
    }),
  );
  if (input.subtitle) {
    parts.push(
      el(
        'div',
        {
          display: 'flex',
          fontFamily: 'Inter',
          fontSize: unit * 5,
          lineHeight: 1.3,
          color: input.color,
          opacity: 0.85,
          textAlign: wide ? 'left' : 'center',
          maxWidth: width * (wide ? 0.6 : 0.84),
        },
        input.subtitle,
      ),
    );
  }
  return el(
    'div',
    {
      display: 'flex',
      position: 'relative',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: align,
      width,
      height,
      padding: unit * 9,
      background: input.background,
      overflow: 'hidden',
    },
    [
      el('div', {
        display: 'flex',
        position: 'absolute',
        width: unit * 90,
        height: unit * 90,
        borderRadius: unit * 45,
        background: input.accent,
        opacity: 0.18,
        right: -unit * 30,
        top: -unit * 30,
      }),
      el('div', {
        display: 'flex',
        position: 'absolute',
        width: unit * 50,
        height: unit * 50,
        borderRadius: unit * 25,
        background: input.accent,
        opacity: 0.12,
        left: -unit * 18,
        bottom: -unit * 18,
      }),
      el('div', { display: 'flex', flexDirection: 'column', alignItems: align }, parts),
    ],
  );
}

// ── Drawing ─────────────────────────────────────────────────────────────────

let resvgReady: Promise<void> | null = null;

function loadResvg(): Promise<void> {
  resvgReady ??= initWasm(
    readFileSync(join(packageDir('@resvg/resvg-wasm'), 'index_bg.wasm')),
  ).catch((error: unknown) => {
    // initWasm refuses a second call; that one already succeeded.
    if (error instanceof Error && /already initialized/i.test(error.message)) return;
    resvgReady = null;
    throw error;
  });
  return resvgReady;
}

const STILL_FONTS: { id: FontId; name: string; weight: 400 | 700 }[] = [
  { id: 'inter', name: 'Inter', weight: 400 },
  { id: 'inter', name: 'Inter', weight: 700 },
  { id: 'oswald', name: 'Oswald', weight: 700 },
];

/** The SVG Satori draws for the template, with the bundled fonts. */
export async function stillSvg(input: StillInput, assetsDir: string, logo?: string): Promise<string> {
  const { width, height } = STILL_TEMPLATES[input.template];
  const fonts = STILL_FONTS.map((font) => ({
    name: font.name,
    weight: font.weight,
    style: 'normal' as const,
    data: readFileSync(join(assetsDir, TEMPLATE_FONTS[font.id].source)),
  }));
  return satori(stillTree(input, logo) as never, { width, height, fonts });
}

/** A PNG of the template. */
export async function stillPng(
  input: StillInput,
  assetsDir: string,
  logo?: TemplateLogo,
): Promise<Uint8Array> {
  const svg = await stillSvg(input, assetsDir, logo ? logoDataUri(logo) : undefined);
  await loadResvg();
  const resvg = new Resvg(svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } });
  try {
    return resvg.render().asPng();
  } finally {
    resvg.free();
  }
}

/** Draws a still and stores it with the promo media, like a rendered overlay. */
export async function renderStill(
  input: StillInput,
  deps: Pick<PromoRenderDeps, 'baseUrl' | 'headers' | 'fetchImpl' | 'assetsDir'>,
): Promise<PromoMediaResult> {
  const logo = input.logoId ? await fetchLogo(deps, input.logoId) : undefined;
  const png = await stillPng(input, deps.assetsDir, logo);
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), `${input.template}.png`);
  const res = await (deps.fetchImpl ?? fetch)(`${deps.baseUrl}/promo/media`, {
    method: 'POST',
    headers: deps.headers,
    body: form,
  });
  if (!res.ok) throw new PromoRenderError('upload_failed', `status ${res.status}`);
  return (await res.json()) as PromoMediaResult;
}
