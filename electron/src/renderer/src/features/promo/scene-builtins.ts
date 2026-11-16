import type { TFunction } from 'i18next';
import { starterScene, type PromoScene, type PromoSceneParam } from './scene-model';

/**
 * Scenes that ship with the app. Their words come from the locale catalog, so
 * a built-in opens in the user's language; the user edits a copy. Sizes are
 * in `vmin`, so one scene fits 9:16, 1:1 and 16:9 alike, and every motion is
 * a CSS animation, which the render seeks frame by frame. Fonts are the
 * bundled Inter and Oswald (both cover Vietnamese).
 */
export const BUILTIN_SCENES = [
  'starter',
  'lower_third',
  'countdown',
  'price',
  'ticker',
  'cta',
  'intro',
  'outro',
  'slide',
] as const;
export type BuiltinScene = (typeof BUILTIN_SCENES)[number];
/** Built-ins that fill the frame: meant as a shot of their own; the rest are overlays. */
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

/** Motions every built-in shares. */
const KEYFRAMES = `@keyframes fade-up { from { opacity: 0; transform: translateY(5vmin); } to { opacity: 1; transform: none; } }
@keyframes grow { from { transform: scaleX(0); } to { transform: none; } }
@keyframes pop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
@keyframes leave { to { opacity: 0; } }`;

/** Shared by the full-frame scenes: a painted stage and a hidden empty logo. */
const FRAME_CSS = `.frame {
  position: absolute; inset: 0; overflow: hidden;
  background: {{background}}; color: {{color}};
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 0 8vmin; box-sizing: border-box;
}
img[src=""] { display: none; }
${KEYFRAMES}`;

/** Overlays fade out over their last .4 s, so a cut never chops them. */
const OVERLAY_CSS = `${KEYFRAMES}
.out { animation: leave .4s calc({{duration}}s - .4s) ease-in forwards; }
.shade { text-shadow: 0 .3vmin 1.6vmin rgba(0, 0, 0, .5); }`;

const LOWER_THIRD_HTML = `<div class="lt out">
  <div class="bar"></div>
  <div class="plate">
    <p class="name">{{name}}</p>
    <p class="role">{{role}}</p>
  </div>
</div>`;

const LOWER_THIRD_CSS = `${OVERLAY_CSS}
.lt { position: absolute; left: 6vmin; bottom: 14vmin; display: flex; align-items: stretch; gap: 2vmin; }
.bar { width: 1.4vmin; background: {{accent}}; transform-origin: bottom;
  animation: rise .5s cubic-bezier(.2,.8,.2,1) both; }
.plate { background: {{background}}; color: {{color}}; padding: 2.2vmin 4vmin 2.4vmin;
  clip-path: inset(0 100% 0 0); animation: wipe .7s .25s cubic-bezier(.7,0,.2,1) forwards; }
.name { margin: 0; font: 700 6vmin/1.1 "Oswald"; text-transform: uppercase; letter-spacing: .02em; }
.role { margin: .8vmin 0 0; font: 500 3.6vmin/1.2 "Inter"; opacity: .8; }
.role:empty { display: none; }
@keyframes rise { from { transform: scaleY(0); } to { transform: none; } }
@keyframes wipe { to { clip-path: inset(0 0 0 0); } }`;

/** Five digits in a strip, stepped one per fifth of the scene. */
const COUNTDOWN_HTML = `<div class="cd out">
  <p class="caption shade">{{caption}}</p>
  <div class="window"><div class="strip shade"><span>5</span><span>4</span><span>3</span><span>2</span><span>1</span></div></div>
  <div class="track"><div class="fill"></div></div>
</div>`;

const COUNTDOWN_CSS = `${OVERLAY_CSS}
.cd { position: absolute; left: 0; right: 0; top: 50%; margin-top: -24vmin; text-align: center; color: {{color}}; }
.caption { margin: 0 0 2vmin; font: 600 4.4vmin/1.2 "Inter"; text-transform: uppercase; letter-spacing: .12em;
  animation: fade-up .5s ease-out both; }
.caption:empty { visibility: hidden; }
.window { height: 30vmin; overflow: hidden; }
.strip { animation: count {{duration}}s steps(5, jump-none) both; }
.strip span { display: block; height: 30vmin; font: 700 30vmin/30vmin "Oswald"; color: {{accent}}; }
.track { position: relative; width: 40vmin; height: 1.2vmin; margin: 3vmin auto 0; }
.track::before { content: ""; position: absolute; inset: 0; background: {{color}}; opacity: .25; }
.fill { position: relative; height: 100%; background: {{accent}}; transform-origin: left;
  animation: drain {{duration}}s linear both; }
@keyframes count { to { transform: translateY(-80%); } }
@keyframes drain { from { transform: none; } to { transform: scaleX(0); } }`;

const PRICE_HTML = `<div class="price">
  <span class="badge">{{badge}}</span>
  <p class="product">{{product}}</p>
  <p class="amounts"><s class="old">{{old_price}}</s><b class="new">{{new_price}}</b></p>
</div>`;

const PRICE_CSS = `${OVERLAY_CSS}
.price { position: absolute; right: 6vmin; bottom: 14vmin; max-width: 72vmin; padding: 4vmin 5vmin;
  border-radius: 3vmin; background: {{background}}; color: {{color}}; transform-origin: bottom right;
  animation: pop .6s cubic-bezier(.2,1.3,.4,1) both, leave .4s calc({{duration}}s - .4s) ease-in forwards; }
.badge { position: absolute; top: -4vmin; left: -4vmin; padding: 1.4vmin 2.6vmin; border-radius: 99vmin;
  background: {{accent}}; color: #ffffff; font: 800 4.6vmin/1 "Inter";
  animation: stamp .5s .45s cubic-bezier(.2,1.4,.4,1) both; }
.product { margin: 0 0 1.4vmin; font: 600 4.2vmin/1.2 "Inter"; opacity: .85; }
.amounts { margin: 0; display: flex; align-items: baseline; flex-wrap: wrap; gap: 3vmin; }
.old { font: 500 4.6vmin/1 "Inter"; opacity: .55; }
.new { font: 700 10vmin/1 "Oswald"; color: {{accent}}; animation: fade-up .5s .3s ease-out both; }
.badge:empty, .product:empty, .old:empty { display: none; }
@keyframes stamp { from { opacity: 0; transform: rotate(-8deg) scale(.3); } to { transform: rotate(-8deg); } }`;

/** Four copies of the text; moving by half the track loops seamlessly. */
const TICKER_HTML = `<div class="ticker">
  <span class="tag">{{tag}}</span>
  <div class="lane">
    <div class="track"><span>{{text}}</span><span>{{text}}</span><span>{{text}}</span><span>{{text}}</span></div>
  </div>
</div>`;

const TICKER_CSS = `${OVERLAY_CSS}
.ticker { position: absolute; left: 0; right: 0; bottom: 8vmin; display: flex; height: 9vmin;
  background: {{background}}; color: {{color}}; font: 600 4.4vmin/9vmin "Inter";
  animation: slide-up .5s cubic-bezier(.2,.8,.2,1) both, leave .4s calc({{duration}}s - .4s) ease-in forwards; }
.tag { flex: none; padding: 0 3vmin; background: {{accent}}; color: {{background}};
  font: 700 4.4vmin/9vmin "Oswald"; text-transform: uppercase; letter-spacing: .04em; }
.tag:empty { display: none; }
.lane { flex: 1; overflow: hidden; white-space: nowrap; }
.track { display: inline-flex; animation: scroll 12s linear infinite; }
.track span { padding-left: 8vmin; }
@keyframes slide-up { from { transform: translateY(120%); } to { transform: none; } }
@keyframes scroll { to { transform: translateX(-50%); } }`;

const CTA_HTML = `<div class="cta out">
  <div class="button">{{cta}}<span class="arrow">&rarr;</span></div>
  <p class="sub shade">{{sub}}</p>
</div>`;

const CTA_CSS = `${OVERLAY_CSS}
.cta { position: absolute; left: 0; right: 0; bottom: 16vmin; text-align: center; }
.button { display: inline-flex; align-items: center; gap: 2.4vmin; padding: 3vmin 6vmin; border-radius: 99vmin;
  background: {{accent}}; color: {{background}}; font: 800 6vmin/1 "Inter";
  animation: pop .6s cubic-bezier(.2,1.3,.4,1) both, pulse 1.2s .8s ease-in-out infinite; }
.arrow { display: inline-block; animation: nudge .9s .8s ease-in-out infinite; }
.sub { margin: 2.6vmin 0 0; font: 600 4vmin/1.2 "Inter"; color: {{color}}; animation: fade-up .5s .4s ease-out both; }
.sub:empty { display: none; }
@keyframes pulse { 50% { transform: scale(1.06); } }
@keyframes nudge { 50% { transform: translateX(1.4vmin); } }`;

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
  const label = (key: string) => t(`promo.scene_label_${key}`);
  const word = (key: string) => t(`promo.scene_default_${key}`);
  switch (id) {
    case 'lower_third':
      return {
        ...base,
        name: t('promo.scene_builtin_lower_third'),
        html: LOWER_THIRD_HTML,
        css: LOWER_THIRD_CSS,
        params: [
          text('name', label('name'), word('name')),
          text('role', label('role'), word('role')),
          color('background', label('background'), '#111111'),
          ink,
          accent,
        ],
        duration: 5,
      };
    case 'countdown':
      return {
        ...base,
        name: t('promo.scene_builtin_countdown'),
        html: COUNTDOWN_HTML,
        css: COUNTDOWN_CSS,
        params: [text('caption', label('caption'), word('countdown')), ink, accent],
        duration: 5,
      };
    case 'price':
      return {
        ...base,
        name: t('promo.scene_builtin_price'),
        html: PRICE_HTML,
        css: PRICE_CSS,
        params: [
          text('product', label('product'), word('product')),
          text('old_price', label('old_price'), word('old_price')),
          text('new_price', label('new_price'), word('new_price')),
          text('badge', label('badge'), word('badge')),
          color('background', label('background'), '#ffffff'),
          color('color', label('color'), '#111111'),
          color('accent', label('accent'), '#e11d48'),
        ],
        duration: 5,
      };
    case 'ticker':
      return {
        ...base,
        name: t('promo.scene_builtin_ticker'),
        html: TICKER_HTML,
        css: TICKER_CSS,
        params: [
          text('text', label('text'), word('ticker')),
          text('tag', label('tag'), word('ticker_tag')),
          color('background', label('background'), '#111111'),
          ink,
          accent,
        ],
        duration: 8,
      };
    case 'cta':
      return {
        ...base,
        name: t('promo.scene_builtin_cta'),
        html: CTA_HTML,
        css: CTA_CSS,
        params: [
          text('cta', label('cta'), word('cta')),
          text('sub', label('subtitle'), word('cta_sub')),
          color('background', label('button_text'), '#111111'),
          ink,
          accent,
        ],
        duration: 4,
      };
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
