// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PromoOverlayInput } from '../preload/index.d';
import {
  PROMO_TEMPLATES,
  TEMPLATE_FONTS,
  TEMPLATE_SPECS,
  TemplateInputError,
  fontFaces,
  graphemes,
  parseTemplateInput,
  previewHtml,
  templateFit,
  templateHtml,
  writeTemplateProject,
  type PromoTemplateId,
} from './promo-templates';

const ASSETS = join(__dirname, '..', '..', '..', 'backend', 'assets');
const VIETNAMESE = 'Ưu đãi Đặc biệt: giảm 50% — ầẩẫậ ềểễệ ồổỗộ ờởỡợ ừửữự ỳỷỹỵ';

const valid = {
  template: 'glow_title',
  title: 'TROPICAL',
  subtitle: 'Phong cách nhiệt đới',
  color: '#FFFFFF',
  glow: '#ffd400',
  duration: 4,
  width: 1080,
  height: 1920,
};

/** A valid request for every template, used by the purity checks. */
const fixture = (template: PromoTemplateId) => ({
  ...valid,
  template,
  title: VIETNAMESE.slice(0, 40),
  subtitle: VIETNAMESE.slice(0, 30),
  lines: TEMPLATE_SPECS[template].lines
    ? ['0909 123 456', '27 Nguyễn Huệ, Q.1', 'nysan.vn']
    : undefined,
  logoId: TEMPLATE_SPECS[template].logo ? '0123456789abcdef.png' : undefined,
});
const html = (template: PromoTemplateId) =>
  templateHtml(parseTemplateInput(fixture(template)), {
    fontsCss: '<link rel="stylesheet" href="fonts.css">',
    logoSrc: 'logo.png',
  });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const field = (raw: unknown) => {
  try {
    parseTemplateInput(raw);
  } catch (error) {
    return error instanceof TemplateInputError ? error.field : 'other';
  }
  return null;
};

describe('parseTemplateInput', () => {
  it('accepts a valid request, normalizes colours and composes accents', () => {
    expect(parseTemplateInput(valid)).toMatchObject({ color: '#ffffff', duration: 4, lines: [] });
    const decomposed = 'Việt'; // "Việt" with combining marks
    expect(parseTemplateInput({ ...valid, title: decomposed }).title).toBe('Việt');
  });

  it.each([
    [{ ...valid, template: 'gsap_title' }, 'template'],
    [{ ...valid, title: '   ' }, 'title'],
    [{ ...valid, title: 'x'.repeat(81) }, 'title'],
    [{ ...valid, color: 'red' }, 'color'],
    [{ ...valid, glow: '#fff;background:url(https://x.test/a.png)' }, 'glow'],
    [{ ...valid, duration: 0.2 }, 'duration'],
    [{ ...valid, duration: Number.NaN }, 'duration'],
    [{ ...valid, width: 1081 }, 'width'],
    [{ ...valid, height: 9000 }, 'height'],
    [{ ...valid, template: 'contact_card', lines: ['a', 'b', 'c', 'd'] }, 'lines'],
    [{ ...valid, template: 'contact_card', lines: 'a' }, 'lines'],
    [{ ...valid, template: 'logo_reveal' }, 'logo'],
    [{ ...valid, template: 'logo_reveal', logoId: '../../secret.png' }, 'logo'],
    [{ ...valid, template: 'logo_reveal', logoId: '0123456789abcdef.svg' }, 'logo'],
    [{ ...valid, template: 'logo_reveal', logoId: 'https://x.test/l.png' }, 'logo'],
    [null, 'input'],
  ])('rejects %j', (raw, expected) => {
    expect(field(raw)).toBe(expected);
  });

  it('drops fields a template does not use', () => {
    const parsed = parseTemplateInput({ ...valid, lines: ['x'], logoId: '0123456789abcdef.png' });
    expect(parsed.lines).toEqual([]);
    expect(parsed.logoId).toBeNull();
  });

  it('lets a logo reveal go without a title', () => {
    expect(
      parseTemplateInput({
        ...valid,
        template: 'logo_reveal',
        title: '',
        logoId: '0123456789abcdef.png',
      }).title,
    ).toBe('');
  });
});

describe('graphemes', () => {
  it('keeps every Vietnamese letter whole, even when decomposed', () => {
    expect(graphemes('Việt')).toEqual(['V', 'i', 'ệ', 't']);
    expect(graphemes('Việt')).toHaveLength(4);
  });
});

describe('templateHtml', () => {
  it.each(PROMO_TEMPLATES)('%s escapes user text so it cannot add markup', (template) => {
    const page = templateHtml(
      parseTemplateInput({
        ...fixture(template),
        title: '<img src=x onerror=1>',
        subtitle: '"a" & \'b\'',
        lines: TEMPLATE_SPECS[template].lines ? ['<b>x</b>'] : undefined,
      }),
      { fontsCss: '', logoSrc: 'logo.png' },
    );
    expect(page).not.toMatch(/<img src=x|<b>x/);
  });

  it.each(PROMO_TEMPLATES)('%s declares one composition with the requested size', (template) => {
    expect(html(template)).toMatch(
      /data-composition-id="promo-overlay" data-start="0" data-duration="4" data-width="1080" data-height="1920"/,
    );
  });

  it.each(PROMO_TEMPLATES)('%s never paints the page background', (template) => {
    expect(html(template)).toContain('html,body{margin:0;padding:0;background:transparent}');
  });

  // Chrome loads the template outside the Node network guard, so the source
  // itself must never reference a remote resource, and every family it names
  // must be one the template ships.
  it.each(PROMO_TEMPLATES)('%s has no remote URL and only its own fonts', (template) => {
    const page = html(template);
    const faces = fontFaces(template, (id) => `fonts/${id}.ttf`);
    expect(`${page}\n${faces}`).not.toMatch(/https?:|\/\/[a-z]|@import/i);
    expect(page).not.toMatch(/gsap/i);
    const shipped = new Set(TEMPLATE_SPECS[template].fonts.map((id) => TEMPLATE_FONTS[id].family));
    const named = [...page.matchAll(/"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((name) => Object.values(TEMPLATE_FONTS).some((font) => font.family === name));
    for (const name of named) expect(shipped).toContain(name);
    for (const match of page.matchAll(
      /font(?:-family)?:[^;}]*?(?:\d+(?:\.\d+)?px(?:\/[\d.]+)?\s+)?([^;}]+)/g,
    )) {
      const families = match[1].split(',').map((part) => part.trim());
      for (const family of families) {
        if (family.startsWith('"')) expect(shipped).toContain(family.replace(/"/g, ''));
        else expect(family).not.toMatch(/^(sans-serif|serif|system-ui|monospace|cursive)$/);
      }
    }
  });

  it('types the search query one whole letter at a time', () => {
    const page = templateHtml(
      parseTemplateInput({ ...valid, template: 'search_bar', title: 'Việt' }),
      {
        fontsCss: '',
      },
    );
    expect([...page.matchAll(/<span class="k"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1])).toEqual([
      'V',
      'i',
      'ệ',
      't',
    ]);
  });

  it('finishes typing before the overlay fades out, however long the text', () => {
    const page = templateHtml(
      parseTemplateInput({ ...valid, template: 'search_bar', title: 'x'.repeat(80), duration: 2 }),
      { fontsCss: '' },
    );
    const delays = [...page.matchAll(/class="k" style="animation-delay:([\d.]+)s/g)].map((m) =>
      Number(m[1]),
    );
    expect(Math.max(...delays)).toBeLessThanOrEqual(2 - 0.5);
  });

  it('lists every contact line', () => {
    const page = html('contact_card');
    expect(page).toContain('0909 123 456');
    expect(page).toContain('27 Nguyễn Huệ, Q.1');
    expect(page.match(/class="row"/g)).toHaveLength(3);
  });
});

describe('position', () => {
  it.each([
    ['top_left', 'flex-start', 'flex-start', 'left'],
    ['bottom_right', 'flex-end', 'flex-end', 'right'],
    ['middle_left', 'center', 'flex-start', 'left'],
    ['top_center', 'flex-start', 'center', 'center'],
    ['center', 'center', 'center', 'center'],
  ])('%s places the column', (position, justify, align, text) => {
    const page = templateHtml(parseTemplateInput({ ...valid, position }), { fontsCss: '' });
    expect(page).toContain(`align-items:${align};justify-content:${justify}`);
    expect(page).toContain(`text-align:${text}`);
  });

  it('defaults to the centre and refuses anything off the grid', () => {
    expect(parseTemplateInput(valid).position).toBe('center');
    expect(field({ ...valid, position: 'middle' })).toBe('position');
    expect(field({ ...valid, position: 'top_left;color:red' })).toBe('position');
  });
});

describe('layout', () => {
  const longest =
    'Ưu đãi khai trương đặc biệt giảm giá toàn bộ sản phẩm nội thất nhiệt đới cao cấp tháng'.slice(
      0,
      80,
    );
  const shapes = [
    [1080, 1920],
    [1080, 1080],
    [1920, 1080],
  ] as const;
  it.each(PROMO_TEMPLATES.flatMap((template) => shapes.map(([w, h]) => [template, w, h] as const)))(
    '%s fits the frame at %ix%i with every field at its longest',
    (template, width, height) => {
      const input = parseTemplateInput({
        ...fixture(template),
        title: longest,
        subtitle: longest,
        lines: TEMPLATE_SPECS[template].lines ? [longest, longest, longest] : undefined,
        width,
        height,
      });
      const fit = templateFit(input);
      expect(fit.height).toBeLessThanOrEqual(fit.available + 1);
    },
  );

  it('keeps a short keyword on one line and lets a long one wrap at a readable size', () => {
    const word = (title: string) =>
      Number(
        /#word\{font:900 (\d+)px/.exec(
          templateHtml(parseTemplateInput({ ...valid, template: 'keyword', title }), {
            fontsCss: '',
          }),
        )![1],
      );
    // One line of "QUY TRÌNH" in 1080 wide: about box / (letters x glyph width).
    expect(word('Quy trình')).toBeGreaterThan(1080 * 0.1);
    expect(word(longest)).toBeGreaterThanOrEqual(Math.round(1080 * 0.05));
  });

  it('keeps short text at its full size', () => {
    const page = templateHtml(parseTemplateInput({ ...valid, title: 'SALE', subtitle: '' }), {
      fontsCss: '',
    });
    expect(page).toContain(`font:900 ${Math.round(1080 * 0.13)}px/1.05`);
  });

  it('sets a long title smaller than a short one', () => {
    const size = (title: string) =>
      Number(
        /#title\{font:900 (\d+)px/.exec(
          templateHtml(parseTemplateInput({ ...valid, title, width: 1080, height: 1080 }), {
            fontsCss: '',
          }),
        )![1],
      );
    expect(size(longest)).toBeLessThan(size('SALE'));
  });
});

describe('bundled fonts', () => {
  it('match the hashes recorded in LICENSE-NOTICE.md', () => {
    const notice = readFileSync(join(ASSETS, '..', '..', 'LICENSE-NOTICE.md'), 'utf8');
    for (const font of Object.values(TEMPLATE_FONTS)) {
      if (!font.source.startsWith('promo-fonts/')) continue;
      const name = font.source.split('/').pop()!;
      const hash = createHash('sha256')
        .update(readFileSync(join(ASSETS, font.source)))
        .digest('hex');
      const row = notice.split(/\r?\n/).find((line) => line.includes(`\`${name}\``));
      expect(row, name).toBeDefined();
      expect(row).toContain(hash);
    }
  });

  it.each(Object.entries(TEMPLATE_FONTS))('%s ships with its licence', (_id, font) => {
    const dir = join(ASSETS, font.source, '..');
    expect(readdirSync(dir)).toContain(font.source.split('/').pop());
    expect(readdirSync(dir).some((name) => name.endsWith('OFL.txt'))).toBe(true);
  });
});

describe('writeTemplateProject', () => {
  it.each(PROMO_TEMPLATES)('%s writes its page, fonts and logo only', (template) => {
    const root = mkdtempSync(join(tmpdir(), 'promo-template-'));
    dirs.push(root);
    const project = join(root, 'project');
    const logo = TEMPLATE_SPECS[template].logo
      ? { bytes: new Uint8Array([1, 2, 3]), extension: 'png' }
      : undefined;
    writeTemplateProject(project, parseTemplateInput(fixture(template)), ASSETS, logo);
    const expected = ['fonts', 'fonts.css', 'index.html', ...(logo ? ['logo.png'] : [])];
    expect(readdirSync(project).sort()).toEqual(expected.sort());
    const fonts = TEMPLATE_SPECS[template].fonts.map((id) =>
      TEMPLATE_FONTS[id].source.split('/').pop(),
    );
    expect(readdirSync(join(project, 'fonts')).sort()).toEqual(fonts.sort());
    const css = readFileSync(join(project, 'fonts.css'), 'utf8');
    for (const id of TEMPLATE_SPECS[template].fonts) {
      expect(css).toContain(`font-weight:${TEMPLATE_FONTS[id].weight}`);
    }
  });

  it('refuses a logo reveal without its logo', () => {
    const root = mkdtempSync(join(tmpdir(), 'promo-template-'));
    dirs.push(root);
    expect(() =>
      writeTemplateProject(join(root, 'p'), parseTemplateInput(fixture('logo_reveal')), ASSETS),
    ).toThrow(TemplateInputError);
  });
});

describe('previewHtml', () => {
  it('is self-contained: fonts and logo inline, nothing relative or remote', () => {
    const page = previewHtml(parseTemplateInput(fixture('logo_reveal')), ASSETS, {
      bytes: new Uint8Array([1, 2, 3]),
      extension: 'png',
    });
    expect(page).toContain('src="data:image/png;base64,AQID"');
    expect(page).toMatch(/url\("data:font\/ttf;base64,/);
    expect(page).not.toMatch(/https?:|href="|fonts\//);
  });
});

describe('preload contract', () => {
  it('lists the same templates the renderer can request', () => {
    const fromPreload: Record<PromoOverlayInput['template'], true> = {
      glow_title: true,
      handwriting: true,
      search_bar: true,
      contact_card: true,
      logo_reveal: true,
      keyword: true,
    };
    expect(Object.keys(fromPreload).sort()).toEqual([...PROMO_TEMPLATES].sort());
  });
});
