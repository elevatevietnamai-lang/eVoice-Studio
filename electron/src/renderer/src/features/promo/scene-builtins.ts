import type { TFunction } from 'i18next';
import { starterScene, type PromoScene, type PromoSceneParam } from './scene-model';

/**
 * Scenes that ship with the app. Their words come from the locale catalog, so
 * a built-in opens in the user's language; the user edits a copy. Sizes are
 * in `vmin`, so one scene fits 9:16, 1:1 and 16:9 alike, and every motion is
 * a CSS animation, which the render seeks frame by frame. Fonts are the
 * bundled Inter and Oswald (both cover Vietnamese).
 */
export const BUILTIN_SCENES = ['starter', 'intro', 'outro', 'slide'] as const;
export type BuiltinScene = (typeof BUILTIN_SCENES)[number];
/** Built-ins that fill the frame: meant as a shot of their own. */
export const FULL_FRAME_SCENES: readonly BuiltinScene[] = ['intro', 'outro', 'slide'];

export interface BuiltinOptions {
  /** The brand logo's promo media id, for scenes that show a logo. */
  logoId?: string | null;
}

const text = (key: string, label: string, value: string): PromoSceneParam => ({
  key,
  type: 'text',
  label,
  value,
});
const color = (key: string, label: string, value: string): PromoSceneParam => ({
  key,
  type: 'color',
  label,
  value,
});
const image = (key: string, label: string, value: string | null | undefined): PromoSceneParam => ({
  key,
  type: 'image',
  label,
  value: value ?? '',
});

/** Shared by the full-frame scenes: a painted stage and a hidden empty logo. */
const FRAME_CSS = `.frame {
  position: absolute; inset: 0; overflow: hidden;
  background: {{background}}; color: {{color}};
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 0 8vmin; box-sizing: border-box;
}
img[src=""] { display: none; }
@keyframes fade-up { from { opacity: 0; transform: translateY(5vmin); } to { opacity: 1; transform: none; } }
@keyframes grow { from { transform: scaleX(0); } to { transform: none; } }
@keyframes pop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
@keyframes leave { to { opacity: 0; } }`;

const INTRO_HTML = `<div class="frame">
  <div class="glow"></div>
  <img class="logo" src="{{logo}}" alt="">
  <h1 class="brand">{{brand}}</h1>
  <div class="bar"></div>
  <p class="tagline">{{tagline}}</p>
</div>`;

const INTRO_CSS = `${FRAME_CSS}
.frame { animation: leave .5s calc({{duration}}s - .5s) ease-in forwards; }
.glow {
  position: absolute; width: 120vmin; height: 120vmin; border-radius: 50%;
  background: radial-gradient(circle, {{accent}} 0%, transparent 60%);
  animation: glow 1.6s cubic-bezier(.2,.8,.2,1) both;
}
@keyframes glow { from { opacity: 0; transform: scale(.6); } to { opacity: .22; transform: none; } }
.logo { position: relative; max-width: 36vmin; max-height: 22vmin; object-fit: contain;
  margin-bottom: 4vmin; animation: pop .9s cubic-bezier(.2,1.2,.4,1) both; }
.brand { position: relative; margin: 0; font: 700 13vmin/1 "Oswald"; text-transform: uppercase;
  letter-spacing: .04em; animation: fade-up .8s .25s cubic-bezier(.2,.8,.2,1) both; }
.bar { position: relative; width: 24vmin; height: 1.2vmin; margin: 3.5vmin 0; background: {{accent}};
  transform-origin: left; animation: grow .6s .7s ease-out both; }
.tagline { position: relative; margin: 0; font: 500 4.6vmin/1.3 "Inter"; opacity: .9;
  animation: fade-up .8s .9s ease-out both; }`;

const OUTRO_HTML = `<div class="frame">
  <img class="logo" src="{{logo}}" alt="">
  <h1 class="cta">{{cta}}</h1>
  <p class="contact">{{contact}}</p>
  <div class="line"></div>
</div>`;

const OUTRO_CSS = `${FRAME_CSS}
.logo { max-width: 40vmin; max-height: 24vmin; object-fit: contain; margin-bottom: 5vmin;
  animation: pop .8s cubic-bezier(.2,1.2,.4,1) both; }
.cta { margin: 0; font: 900 10vmin/1.05 "Inter"; animation: fade-up .8s .2s cubic-bezier(.2,.8,.2,1) both; }
.contact { margin: 4vmin 0 0; padding: 2vmin 4vmin; border-radius: 99vmin; background: {{accent}};
  color: {{background}}; font: 700 4.4vmin/1.2 "Inter"; animation: pop .7s .6s cubic-bezier(.2,1.3,.4,1) both; }
.line { position: absolute; left: 0; right: 0; bottom: 0; height: 1.4vmin; background: {{accent}};
  transform-origin: left; animation: grow {{duration}}s linear both; }`;

const SLIDE_HTML = `<div class="frame slide">
  <h1 class="heading">{{heading}}</h1>
  <ul class="points">
    <li>{{point_1}}</li>
    <li>{{point_2}}</li>
    <li>{{point_3}}</li>
  </ul>
</div>`;

const SLIDE_CSS = `${FRAME_CSS}
.slide { align-items: flex-start; text-align: left; padding: 0 10vmin; }
.heading { margin: 0 0 6vmin; font: 700 9vmin/1.05 "Oswald"; text-transform: uppercase;
  border-left: 2vmin solid {{accent}}; padding-left: 3.5vmin; animation: fade-up .7s cubic-bezier(.2,.8,.2,1) both; }
.points { list-style: none; margin: 0; padding: 0; display: grid; gap: 3.5vmin; }
.points li { position: relative; padding-left: 7vmin; font: 600 5.2vmin/1.25 "Inter";
  animation: fade-up .6s cubic-bezier(.2,.8,.2,1) both; }
.points li::before { content: ""; position: absolute; left: 0; top: .45em; width: 3vmin; height: 3vmin;
  border-radius: 50%; background: {{accent}}; }
.points li:nth-child(1) { animation-delay: .5s; }
.points li:nth-child(2) { animation-delay: .9s; }
.points li:nth-child(3) { animation-delay: 1.3s; }
.points li:empty { display: none; }`;

export function builtinScene(
  id: BuiltinScene,
  t: TFunction,
  options: BuiltinOptions = {},
): PromoScene {
  const background = color('background', t('promo.scene_label_background'), '#0b0b0b');
  const ink = color('color', t('promo.scene_label_color'), '#ffffff');
  const accent = color('accent', t('promo.scene_label_accent'), '#ffd400');
  const logo = image('logo', t('promo.scene_label_logo'), options.logoId);
  const base = { id: null, js: '', assets: [] };
  switch (id) {
    case 'starter':
      return starterScene({
        name: t('promo.scene_builtin_starter'),
        title: t('promo.scene_default_title'),
        subtitle: t('promo.scene_default_subtitle'),
        titleLabel: t('promo.scene_label_title'),
        subtitleLabel: t('promo.scene_label_subtitle'),
        colorLabel: t('promo.scene_label_color'),
      });
    case 'intro':
      return {
        ...base,
        name: t('promo.scene_builtin_intro'),
        html: INTRO_HTML,
        css: INTRO_CSS,
        params: [
          text('brand', t('promo.scene_label_brand'), t('promo.scene_default_brand')),
          text('tagline', t('promo.scene_label_tagline'), t('promo.scene_default_tagline')),
          logo,
          background,
          ink,
          accent,
        ],
        duration: 3,
      };
    case 'outro':
      return {
        ...base,
        name: t('promo.scene_builtin_outro'),
        html: OUTRO_HTML,
        css: OUTRO_CSS,
        params: [
          text('cta', t('promo.scene_label_cta'), t('promo.scene_default_cta')),
          text('contact', t('promo.scene_label_contact'), t('promo.scene_default_contact')),
          logo,
          background,
          ink,
          accent,
        ],
        duration: 4,
      };
    case 'slide':
      return {
        ...base,
        name: t('promo.scene_builtin_slide'),
        html: SLIDE_HTML,
        css: SLIDE_CSS,
        params: [
          text('heading', t('promo.scene_label_heading'), t('promo.scene_default_heading')),
          ...[1, 2, 3].map((number) =>
            text(
              `point_${number}`,
              t('promo.scene_label_point', { number }),
              t(`promo.scene_default_point_${number}`),
            ),
          ),
          background,
          ink,
          accent,
        ],
        duration: 5,
      };
  }
}
