import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { HelpHint, TitleWithHelp } from './help-hint';
import { Switch } from './ui/switch';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

it('keeps the explanation out of the page until the ? is opened', async () => {
  render(<TitleWithHelp title="Steps" help="More steps take longer." />);
  expect(screen.queryByText('More steps take longer.')).toBeNull();
  const trigger = screen.getByRole('button', { name: 'common.help_for:Steps' });
  expect(trigger.getAttribute('type')).toBe('button');
  fireEvent.click(trigger);
  expect(await screen.findByText('More steps take longer.')).toBeTruthy();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByText('More steps take longer.')).toBeNull());
});

it('leaves the switch beside it to its own label', () => {
  function Row() {
    const [on, setOn] = useState(false);
    return (
      <div>
        <span>
          <label htmlFor="adg">ADG</label>
          <HelpHint label="ADG">Lowers guidance where it distorts.</HelpHint>
        </span>
        <Switch id="adg" checked={on} onCheckedChange={setOn} />
      </div>
    );
  }
  render(<Row />);
  const toggle = screen.getByRole('switch', { name: 'ADG' });
  fireEvent.click(screen.getByText('ADG'));
  expect(toggle.getAttribute('aria-checked')).toBe('true');
});
