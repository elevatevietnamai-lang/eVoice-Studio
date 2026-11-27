import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SettingsRow, SettingsSection } from './settings-layout';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

it('puts a row explanation behind a ? beside its title, outside the group name', () => {
  render(
    <SettingsSection title="Network" help="Why the network matters.">
      <SettingsRow id="proxy" title="Proxy" help="Used for downloads." description="Connected">
        <button type="button">Save</button>
      </SettingsRow>
    </SettingsSection>,
  );
  // The explanation waits behind the "?"; the status line stays visible.
  expect(screen.queryByText('Used for downloads.')).toBeNull();
  expect(screen.queryByText('Why the network matters.')).toBeNull();
  expect(screen.getByText('Connected')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'common.help_for:Proxy' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'common.help_for:Network' })).toBeTruthy();
  // The "?" is beside the headings, so the names stay the titles alone.
  expect(screen.getByRole('group', { name: 'Proxy' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Network' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Proxy' })).toBeTruthy();
});
