import type { TFunction } from 'i18next';
import { starterScene, type PromoScene } from './scene-model';

/**
 * Scenes that ship with the app. Their text comes from the locale catalog, so
 * a built-in opens in the user's language; the user edits a copy.
 */
export const BUILTIN_SCENES = ['starter'] as const;
export type BuiltinScene = (typeof BUILTIN_SCENES)[number];

export function builtinScene(id: BuiltinScene, t: TFunction): PromoScene {
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
  }
}
