import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Reveal } from './index';

/**
 * Messages, errors and toggled panels used to pop in and vanish (`{error && <p role="alert">}`):
 * no enter, no exit, and the layout around them jumped. Reveal gives them both, by height.
 */
const sources = import.meta.glob(
  ['../../**/*.tsx', '!../../**/*.test.tsx', '!../../components/ui/**'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;

afterEach(cleanup);

it('mounts, then removes a conditional block through Reveal', async () => {
  const view = render(<Reveal>{true && <p role="alert">Failed</p>}</Reveal>);
  expect(screen.getByRole('alert')).toHaveTextContent('Failed');
  view.rerender(<Reveal>{false && <p role="alert">Failed</p>}</Reveal>);
  await waitFor(() => expect(screen.queryByText('Failed')).toBeNull());
});

it('renders nothing for an empty condition', () => {
  const { container } = render(<Reveal>{null}</Reveal>);
  expect(container).toBeEmptyDOMElement();
});

it('wraps every conditional error, alert and status block in Reveal', () => {
  expect(Object.keys(sources).length).toBeGreaterThan(100);
  const block =
    /\{\s*[^{}\n]{1,90}?\s*&&\s*\(?\s*<(?:Alert|PipelineFailure|SettingsActionError|ValidationWarnings|p|div)\b[^>]*role="alert"|\{\s*[^{}\n]{1,90}?\s*&&\s*\(?\s*<(?:Alert|PipelineFailure|SettingsActionError|ValidationWarnings)\b/g;
  const hits: string[] = [];
  for (const [file, source] of Object.entries(sources)) {
    for (const match of source.matchAll(block)) {
      const before = source.slice(0, match.index).trimEnd();
      if (!before.endsWith('<Reveal>') && !before.endsWith('='))
        hits.push(
          `${file.replace('../../', '')}:${source.slice(0, match.index).split('\n').length}`,
        );
    }
  }
  expect(hits).toEqual([]);
});
