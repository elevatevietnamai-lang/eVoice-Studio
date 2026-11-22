import { expect, it } from 'vitest';

const fs = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:fs'): {
        readFileSync(path: string, encoding: 'utf8'): string;
        readdirSync(path: string, options: { recursive: true }): string[];
      };
    };
  }
).process.getBuiltinModule('node:fs');

/**
 * DESIGN.md, "Action rows share one height": the buttons and button-styled links that sit side by
 * side in one row are the same height. Each one picks its own `size`, so a row drifts when one is
 * written with another size or a component bakes one in (the backend screen's 32 px Retry beside
 * the 28 px Fix). This reads every renderer view, finds the horizontal flex rows, and compares the
 * heights of the controls directly inside each (conditional children and fragments included).
 */

const root = 'src/renderer/src';
/** Button heights in px, from `components/ui/button.tsx`. */
const HEIGHT: Record<string, number> = {
  default: 32,
  icon: 32,
  sm: 28,
  'icon-sm': 28,
  xs: 24,
  'icon-xs': 24,
  lg: 36,
  'icon-lg': 36,
};
/** Components that render a Button with a size of their own when none is passed. */
const DEFAULT_SIZE: Record<string, string> = {
  Button: 'default',
  AgentFixButton: 'sm',
  AudioPreviewButton: 'icon-xs',
};
/**
 * Rows allowed to mix heights, with why. The Clone page's voice picker is the page's title, not an
 * action, and is taller than the Change link beside it on purpose.
 */
const EXEMPT = [{ file: 'features/clone/clone-page.tsx', className: 'h-12' }];

type Node = { name: string; attrs: string; children: Node[] };

const identifier = /[\w$.]/;

/** The JSX element tree of a file: tags only, comments stripped, generics and comparisons skipped. */
export function jsxTree(source: string): Node {
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '');
  const top: Node = { name: '#root', attrs: '', children: [] };
  const stack: Node[] = [top];
  let i = 0;
  while ((i = text.indexOf('<', i)) !== -1) {
    const next = text[i + 1] ?? '';
    if (next === '/') {
      const end = text.indexOf('>', i);
      if (end === -1) break;
      const name = text.slice(i + 2, end).trim();
      const at = stack.map((n) => n.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      i = end + 1;
      continue;
    }
    let p = i - 1;
    while (p >= 0 && /\s/.test(text[p])) p--;
    const before = p >= 0 ? text[p] : '(';
    if (!(next === '>' || /[A-Za-z]/.test(next)) || identifier.test(before) || !'(>{}?:&|,=;'.includes(before)) {
      i += 1;
      continue;
    }
    // Read the tag up to its closing ">", skipping strings and nested braces.
    let j = i + 1;
    let depth = 0;
    let quote = '';
    for (; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') {
        if (depth > 0 || c !== '`') quote = c;
      } else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const raw = text.slice(i + 1, j);
    const selfClosing = raw.endsWith('/');
    const name = raw.match(/^[\w.-]*/)?.[0] ?? '';
    const node: Node = { name, attrs: raw.slice(name.length), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = j + 1;
  }
  return top;
}

function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|\\{\\s*['"]([^'"]*)['"]\\s*\\}|\\{)`));
  if (!m) return undefined;
  return m[1] ?? m[2] ?? '#dynamic';
}

/** The control's height in px, or null when it is not a button or its size is set at runtime. */
export function heightOf(node: Node): number | null {
  const className = node.attrs.match(/className=(?:"[^"]*"|\{[\s\S]*?\}(?=\s|$))/)?.[0] ?? '';
  const variants = className.match(/buttonVariants\(\s*(\{[^}]*\})?\s*\)/);
  if (variants) {
    const size = variants[1]?.match(/size:\s*['"]([\w-]+)['"]/)?.[1] ?? 'default';
    return HEIGHT[size] ?? null;
  }
  if (!(node.name in DEFAULT_SIZE) || /\srender=/.test(node.attrs)) return null;
  const size = attr(node.attrs, 'size') ?? DEFAULT_SIZE[node.name];
  if (size === '#dynamic') return null;
  const override = className.match(/(?:^|[\s"'`])(?:h|size)-(\d+(?:\.5)?)(?=[\s"'`])/);
  if (override) return Number(override[1]) * 4;
  return HEIGHT[size] ?? null;
}

function isRow(node: Node): boolean {
  const className = attr(node.attrs, 'className') === undefined ? '' : node.attrs;
  return /\b(inline-)?flex\b/.test(className) && !/\bflex-col\b/.test(className);
}

function directControls(node: Node): Node[] {
  return node.children.flatMap((child) => (child.name === '' ? directControls(child) : [child]));
}

export function mixedRows(source: string): string[] {
  const found: string[] = [];
  const visit = (node: Node) => {
    if (node.name !== '' && isRow(node)) {
      const sized = directControls(node)
        .map((child) => ({ child, height: heightOf(child) }))
        .filter((entry): entry is { child: Node; height: number } => entry.height !== null);
      if (new Set(sized.map((entry) => entry.height)).size > 1)
        found.push(sized.map(({ child, height }) => `${child.name || 'link'} ${height}px`).join(', '));
    }
    node.children.forEach(visit);
  };
  visit(jsxTree(source));
  return found;
}

const views = fs
  .readdirSync(root, { recursive: true })
  .map((file) => file.replace(/\\/g, '/'))
  .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'));

it('finds the rows it checks', () => {
  // Fails loudly if the reader stops seeing JSX, instead of passing on nothing.
  const sample = `return (<div className="flex gap-2"><Button>Retry</Button>{ok && <AgentFixButton request="x" />}</div>);`;
  expect(mixedRows(sample)).toEqual(['Button 32px, AgentFixButton 28px']);
  const fixed = `return (<div className="flex gap-2"><Button size="sm">Retry</Button><AgentFixButton request="x" /></div>);`;
  expect(mixedRows(fixed)).toEqual([]);
  const column = `return (<div className="flex flex-col gap-2"><Button>Retry</Button><Button size="xs">x</Button></div>);`;
  expect(mixedRows(column)).toEqual([]);
});

it.each(views)('%s keeps each action row one height', (file) => {
  const source = fs.readFileSync(`${root}/${file}`, 'utf8');
  const rows = mixedRows(source).filter(
    (row) =>
      !EXEMPT.some(
        (exempt) => exempt.file === file && source.includes(exempt.className) && /\b48px\b/.test(row),
      ),
  );
  expect(rows).toEqual([]);
});
