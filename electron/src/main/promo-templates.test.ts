// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FONTS_CSS,
  PROMO_TEMPLATES,
  TEMPLATE_FONTS,
  TemplateInputError,
  parseTemplateInput,
  templateHtml,
  writeTemplateProject,
} from './promo-templates';

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
  it('accepts a valid request and normalizes colours', () => {
    expect(parseTemplateInput(valid)).toMatchObject({ color: '#ffffff', duration: 4 });
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
    [null, 'input'],
  ])('rejects %j', (raw, expected) => {
    expect(field(raw)).toBe(expected);
  });
});

describe('templateHtml', () => {
  it('escapes user text so it cannot add markup', () => {
    const html = templateHtml(
      parseTemplateInput({ ...valid, title: '<img src=x onerror=1>', subtitle: '"a" & \'b\'' }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=1&gt;');
    expect(html).toContain('&quot;a&quot; &amp; &#39;b&#39;');
  });

  it('declares one composition with the requested size and length', () => {
    const html = templateHtml(parseTemplateInput({ ...valid, width: 1920, height: 1080 }));
    expect(html).toMatch(
      /data-composition-id="promo-overlay" data-start="0" data-duration="4" data-width="1920" data-height="1080"/,
    );
  });

  it('never paints the page background, so the overlay keeps its alpha', () => {
    const html = templateHtml(parseTemplateInput(valid));
    expect(html).toContain('html,body{margin:0;padding:0;background:transparent}');
  });

  // Chrome loads the template outside the Node network guard, so the source
  // itself must never reference a remote resource. User text may contain a URL;
  // that is plain escaped text, so the check uses neutral input.
  it.each(PROMO_TEMPLATES)('%s has no remote URL and only bundled font families', (template) => {
    const html = templateHtml(parseTemplateInput({ ...valid, template }));
    const source = `${html}\n${FONTS_CSS}`;
    expect(source).not.toMatch(/https?:\/\//i);
    expect(source).not.toMatch(/@import/i);
    const families = new Set(TEMPLATE_FONTS.map((font) => font.family));
    for (const match of html.matchAll(/font-family:\s*([^;}]+)/g)) {
      for (const family of match[1].split(',')) {
        expect(families).toContain(family.trim().replace(/^["']|["']$/g, ''));
      }
    }
    expect(html).not.toMatch(/\bfont:/);
    expect(html).not.toMatch(/gsap/i);
  });
});

describe('writeTemplateProject', () => {
  it('writes the page, the font sheet and every bundled font', () => {
    const root = mkdtempSync(join(tmpdir(), 'promo-template-'));
    dirs.push(root);
    const fonts = join(root, 'fonts-src');
    mkdirSync(fonts);
    for (const { file } of TEMPLATE_FONTS) writeFileSync(join(fonts, file), 'font');
    const project = join(root, 'project');
    writeTemplateProject(project, parseTemplateInput(valid), fonts);
    expect(readdirSync(project).sort()).toEqual(['fonts', 'fonts.css', 'index.html']);
    expect(readdirSync(join(project, 'fonts'))).toEqual(TEMPLATE_FONTS.map((f) => f.file));
    expect(readFileSync(join(project, 'index.html'), 'utf8')).toContain('href="fonts.css"');
  });

  it('ships the fonts it declares in the backend assets', () => {
    const backendFonts = join(__dirname, '..', '..', '..', 'backend', 'assets', 'fonts');
    const present = readdirSync(backendFonts);
    for (const { file } of TEMPLATE_FONTS) expect(present).toContain(file);
  });
});
