/**
 * Animated titles (HyperFrames) for the editor, rendered by the desktop app's
 * Promo title renderer through its existing bridge into a transparent WebM
 * that sits on an overlay track. The form state and what the bridge receives.
 */
import type { PromoOverlayInput } from '../../../../preload/index.d';
import type { TimelineElement } from '@/lib/opencut/vendor/timeline/types';

export type TitleTemplate = PromoOverlayInput['template'];
export type TitlePosition = NonNullable<PromoOverlayInput['position']>;

/** Mirrors TEMPLATE_SPECS in main/promo-templates.ts: which templates need lines or a logo, and starting colours. */
export const TITLE_TEMPLATES: Record<TitleTemplate, { lines: boolean; logo: boolean; color: string; accent: string }> = {
  keyword: { lines: false, logo: false, color: '#ffffff', accent: '#ffffff' },
  glow_title: { lines: false, logo: false, color: '#ffffff', accent: '#ffd400' },
  handwriting: { lines: false, logo: false, color: '#ffffff', accent: '#ffd400' },
  search_bar: { lines: false, logo: false, color: '#202124', accent: '#1a73e8' },
  contact_card: { lines: true, logo: false, color: '#ffffff', accent: '#ffb000' },
  logo_reveal: { lines: false, logo: true, color: '#ffffff', accent: '#ffd400' },
};
export const TITLE_TEMPLATE_IDS = Object.keys(TITLE_TEMPLATES) as TitleTemplate[];

/** Row by row, as the 3×3 picker shows them. */
export const TITLE_POSITIONS: readonly TitlePosition[] = [
  'top_left',
  'top_center',
  'top_right',
  'middle_left',
  'center',
  'middle_right',
  'bottom_left',
  'bottom_center',
  'bottom_right',
];

export const MIN_TITLE_SECONDS = 1;
export const MAX_TITLE_SECONDS = 15;
export const TITLE_LINES = 3;

export interface TitleForm {
  template: TitleTemplate;
  position: TitlePosition;
  title: string;
  subtitle: string;
  lines: string[];
  logoId: string | null;
  color: string;
  glow: string;
  seconds: number;
}

export function defaultTitleForm(template: TitleTemplate = 'glow_title'): TitleForm {
  const spec = TITLE_TEMPLATES[template];
  return {
    template,
    position: 'center',
    title: '',
    subtitle: '',
    lines: Array(TITLE_LINES).fill(''),
    logoId: null,
    color: spec.color,
    glow: spec.accent,
    seconds: 3,
  };
}

/** What still blocks a render: a logo for the logo reveal, text for the rest. */
export function titleProblem(form: TitleForm): 'logo' | 'text' | null {
  if (TITLE_TEMPLATES[form.template].logo) return form.logoId ? null : 'logo';
  return form.title.trim() ? null : 'text';
}

/** The bridge input for a project canvas of `size`. */
export function titleInput(form: TitleForm, size: { width: number; height: number }): PromoOverlayInput {
  const spec = TITLE_TEMPLATES[form.template];
  return {
    template: form.template,
    position: form.position,
    title: form.title.trim(),
    subtitle: form.subtitle.trim(),
    ...(spec.lines ? { lines: form.lines.map((line) => line.trim()).filter(Boolean).slice(0, TITLE_LINES) } : {}),
    ...(spec.logo && form.logoId ? { logoId: form.logoId } : {}),
    color: form.color,
    glow: form.glow,
    duration: Math.min(MAX_TITLE_SECONDS, Math.max(MIN_TITLE_SECONDS, form.seconds)),
    width: size.width,
    height: size.height,
  };
}

/** Param on an overlay clip holding the form it was rendered from, so it can be edited and rendered again. */
export const TITLE_PARAM = 'title.form';

export function titleFormOf(element: TimelineElement): TitleForm | null {
  const raw = element.params[TITLE_PARAM];
  if (typeof raw !== 'string') return null;
  try {
    const saved = JSON.parse(raw) as Partial<TitleForm>;
    if (!saved.template || !TITLE_TEMPLATES[saved.template]) return null;
    return { ...defaultTitleForm(saved.template), ...saved, lines: [...(saved.lines ?? []), '', '', ''].slice(0, TITLE_LINES) };
  } catch {
    return null;
  }
}

/** Bridge error codes the editor explains; the rest show their code. */
export const KNOWN_TITLE_ERRORS = new Set([
  'busy',
  'browser_missing',
  'local_backend_required',
  'ffmpeg_unavailable',
  'network_blocked',
  'logo_missing',
  'logo_too_large',
  'invalid_input',
]);
