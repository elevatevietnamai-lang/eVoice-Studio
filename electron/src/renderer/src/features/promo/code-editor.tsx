import { useRef } from 'react';

/**
 * A plain textarea with light syntax colour: the text is drawn twice, once
 * coloured in a `<pre>` underneath and once in the transparent textarea on
 * top that the user types in. Tokens are rendered as React text, never as
 * HTML, so code in the editor can never run in the app.
 */

export type CodeLanguage = 'html' | 'css' | 'js';
export type TokenKind = 'plain' | 'comment' | 'string' | 'tag' | 'keyword' | 'number' | 'param';
export interface Token {
  text: string;
  kind: TokenKind;
}

const PATTERNS: Record<CodeLanguage, [TokenKind, RegExp][]> = {
  html: [
    ['comment', /<!--[\s\S]*?(?:-->|$)/y],
    ['param', /\{\{\s*[a-z][a-z0-9_]*\s*\}\}/y],
    ['tag', /<\/?[A-Za-z][\w:-]*|\/?>/y],
    ['string', /"[^"]*"?|'[^']*'?/y],
  ],
  css: [
    ['comment', /\/\*[\s\S]*?(?:\*\/|$)/y],
    ['param', /\{\{\s*[a-z][a-z0-9_]*\s*\}\}/y],
    ['string', /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y],
    ['keyword', /@[a-z-]+|[a-z-]+(?=\s*:)/y],
    ['number', /#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+(?:px|em|rem|%|s|ms|vh|vw|vmin|vmax|deg)?/y],
  ],
  js: [
    ['comment', /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y],
    ['string', /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?/y],
    [
      'keyword',
      /\b(?:const|let|var|function|return|if|else|for|while|of|in|new|this|true|false|null|undefined|class|=>|import|export)\b/y,
    ],
    ['number', /\b\d*\.?\d+\b/y],
  ],
};

/** Splits code into coloured runs; joined back, the runs are the input. */
export function tokenize(code: string, language: CodeLanguage): Token[] {
  const tokens: Token[] = [];
  const patterns = PATTERNS[language];
  let plain = '';
  let at = 0;
  outer: while (at < code.length) {
    for (const [kind, pattern] of patterns) {
      pattern.lastIndex = at;
      const match = pattern.exec(code);
      if (match && match[0].length) {
        if (plain) tokens.push({ text: plain, kind: 'plain' });
        plain = '';
        tokens.push({ text: match[0], kind });
        at += match[0].length;
        continue outer;
      }
    }
    plain += code[at];
    at += 1;
  }
  if (plain) tokens.push({ text: plain, kind: 'plain' });
  return tokens;
}

const COLOR: Record<TokenKind, string> = {
  plain: '',
  comment: 'text-muted-foreground italic',
  string: 'text-emerald-600 dark:text-emerald-400',
  tag: 'text-sky-700 dark:text-sky-300',
  keyword: 'text-violet-700 dark:text-violet-300',
  number: 'text-amber-700 dark:text-amber-300',
  param: 'text-pink-700 dark:text-pink-300 font-semibold',
};

const SHARED =
  'm-0 whitespace-pre-wrap break-words p-2 font-mono text-xs leading-5 [tab-size:2] [overflow-wrap:anywhere]';

export function CodeEditor({
  value,
  language,
  label,
  disabled,
  onChange,
}: {
  value: string;
  language: CodeLanguage;
  label: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const pre = useRef<HTMLPreElement>(null);
  // After Escape, Tab moves focus on as usual (no keyboard trap).
  const leaving = useRef(false);
  return (
    <div className="relative h-64 overflow-hidden rounded-sm border border-border/60 bg-muted/20">
      <pre
        ref={pre}
        aria-hidden
        className={`${SHARED} pointer-events-none absolute inset-0 overflow-hidden`}
      >
        {tokenize(value, language).map((token, index) =>
          token.kind === 'plain' ? (
            token.text
          ) : (
            <span key={index} className={COLOR[token.kind]}>
              {token.text}
            </span>
          ),
        )}
        {/* Keeps the last empty line as tall as the textarea's. */}
        {'\n'}
      </pre>
      <textarea
        aria-label={label}
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className={`${SHARED} absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent text-transparent caret-foreground outline-none selection:bg-sky-500/30 focus-visible:ring-0`}
        onScroll={(event) => {
          if (pre.current) {
            pre.current.scrollTop = event.currentTarget.scrollTop;
            pre.current.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
        onKeyDown={(event) => {
          // Tab indents instead of leaving the editor; Escape then Tab still leaves.
          if (event.key === 'Escape') {
            leaving.current = true;
            return;
          }
          const plainTab =
            event.key === 'Tab' &&
            !event.shiftKey &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey;
          if (!plainTab || leaving.current) {
            leaving.current = false;
            return;
          }
          event.preventDefault();
          const target = event.currentTarget;
          const { selectionStart, selectionEnd } = target;
          const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
          onChange(next);
          requestAnimationFrame(() =>
            target.setSelectionRange(selectionStart + 2, selectionStart + 2),
          );
        }}
        onBlur={() => {
          leaving.current = false;
        }}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
