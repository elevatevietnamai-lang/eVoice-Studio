import { optimize, type CustomPlugin, type XastElement } from 'svgo';

/**
 * Cleans and shrinks an SVG before it reaches a scene: an imported file, an
 * AI-written one or a saved scene's asset (promo-scenes.ts runs every SVG
 * asset through here when a scene is read).
 *
 * The scene's sandbox already blocks every request, so this is about keeping
 * scene files tidy and inert, not the last line of defence: scripts, event
 * handlers, `<foreignObject>` and any link that leaves the file (href other
 * than `#id` or `data:`, `url(…)` to anything but `#id` or `data:`) go.
 */

const LOCAL_REF = /^\s*(?:#|data:)/i;
const URL_FUNC = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const DROP = new Set(['script', 'foreignObject', 'iframe', 'embed', 'object', 'audio', 'video']);

function cleanUrls(value: string): string {
  return value.replace(URL_FUNC, (whole, _quote: string, target: string) =>
    LOCAL_REF.test(target) ? whole : 'none',
  );
}

const inert: CustomPlugin = {
  name: 'evoiceInert',
  fn: () => ({
    element: {
      enter: (node: XastElement, parent) => {
        if (DROP.has(node.name)) {
          parent.children = parent.children.filter((child) => child !== node);
          return;
        }
        for (const name of Object.keys(node.attributes)) {
          const value = node.attributes[name];
          const lower = name.toLowerCase();
          if (lower.startsWith('on')) delete node.attributes[name];
          else if ((lower === 'href' || lower.endsWith(':href')) && !LOCAL_REF.test(value)) {
            delete node.attributes[name];
          } else if (/url\(/i.test(value)) node.attributes[name] = cleanUrls(value);
        }
      },
    },
    text: {
      enter: (node, parent) => {
        if (parent.type === 'element' && parent.name === 'style') node.value = cleanUrls(node.value);
      },
    },
    cdata: {
      enter: (node, parent) => {
        if (parent.type === 'element' && parent.name === 'style') node.value = cleanUrls(node.value);
      },
    },
  }),
};

export class SvgError extends Error {}

/** The cleaned SVG text; throws SvgError when the input is not an SVG. */
export function cleanSvg(source: string): string {
  if (!/<svg[\s>]/i.test(source)) throw new SvgError('not_svg');
  let result: string;
  try {
    result = optimize(source, {
      multipass: true,
      plugins: [
        {
          name: 'preset-default',
          params: {
            // Ids are what scenes animate by (svgo 4 keeps the viewBox).
            overrides: { cleanupIds: false },
          },
        },
        'removeScripts',
        inert,
      ],
    }).data;
  } catch (error) {
    throw new SvgError(error instanceof Error ? error.message : String(error));
  }
  if (!/<svg[\s>]/i.test(result)) throw new SvgError('not_svg');
  return result;
}

/** Base64 form, for scene assets. */
export function cleanSvgBase64(base64: string): string {
  return Buffer.from(cleanSvg(Buffer.from(base64, 'base64').toString('utf8')), 'utf8').toString(
    'base64',
  );
}
