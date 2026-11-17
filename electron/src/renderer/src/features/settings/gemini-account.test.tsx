import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { GeminiAccount } from './gemini-account';

const signedIn = {
  installed: true,
  state: 'signedIn' as const,
  models: [
    { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
  ],
};

function bridge(status: unknown) {
  const repair = {
    geminiStatus: vi.fn(async () => status),
    geminiLoginStart: vi.fn(async () => ({ url: 'https://accounts.google.com/o/oauth2/auth?x=1' })),
    geminiLoginSubmit: vi.fn(async () => signedIn),
    geminiLoginCancel: vi.fn(async () => {}),
  };
  (window as unknown as { voicestudio: unknown }).voicestudio = { repair };
  return repair;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { voicestudio?: unknown }).voicestudio;
});

it('shows a signed-in account and saves the picked Gemini model', async () => {
  bridge(signedIn);
  const pick = vi.fn();
  render(<GeminiAccount model="" onPickModel={pick} />);
  expect(await screen.findByText('settings.gemini_signed_in')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /settings.gemini_sign_in/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Gemini 3.8 Flash (Low)' }));
  expect(pick).toHaveBeenCalledWith('gemini-3.8-flash-low');
});

it('signs in with Google through a pasted code', async () => {
  const repair = bridge({ installed: true, state: 'signedOut', models: [] });
  render(<GeminiAccount model="" onPickModel={() => {}} />);
  expect(await screen.findByText('settings.gemini_signed_out')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /settings.gemini_sign_in/ }));
  const input = await screen.findByRole('textbox', { name: 'settings.gemini_code' });
  fireEvent.change(input, { target: { value: ' 4/0AbCd ' } });
  fireEvent.click(screen.getByRole('button', { name: 'settings.gemini_finish_login' }));
  await waitFor(() => expect(repair.geminiLoginSubmit).toHaveBeenCalledWith('4/0AbCd'));
  expect(await screen.findByText('settings.gemini_signed_in')).toBeInTheDocument();
});

it('never tells a user whose check failed to sign in again', async () => {
  bridge({ installed: true, state: 'unknown', models: [] });
  render(<GeminiAccount model="" onPickModel={() => {}} />);
  expect(await screen.findByText('settings.gemini_unknown')).toBeInTheDocument();
  expect(screen.queryByText('settings.gemini_signed_out')).toBeNull();
});

it('cancels a pending sign-in when the card closes', async () => {
  const repair = bridge({ installed: true, state: 'signedOut', models: [] });
  const view = render(<GeminiAccount model="" onPickModel={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /settings.gemini_sign_in/ }));
  await screen.findByRole('textbox', { name: 'settings.gemini_code' });
  view.unmount();
  expect(repair.geminiLoginCancel).toHaveBeenCalled();
});

it('renders nothing outside the desktop app', () => {
  const { container } = render(<GeminiAccount model="" onPickModel={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
