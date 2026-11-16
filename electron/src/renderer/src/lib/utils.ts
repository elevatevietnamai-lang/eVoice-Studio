import { createCn } from 'cn/config';

/**
 * Class merging that knows the theme's type-scale tokens (DESIGN.md section 3). Without them
 * `text-label` reads as a colour: it would drop a `text-(--muted)` colour and keep `text-sm`.
 */
export const cn = createCn({
  extend: { classGroups: { 'font-size': [{ text: ['ui', 'label', 'caption', 'editor'] }] } },
});
