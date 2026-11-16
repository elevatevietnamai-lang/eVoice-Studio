import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  open: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
  toDataURL: vi.fn(async (value: string) => 'data:image/png;base64,' + btoa(value)),
}));
vi.mock('@/components/bridge', () => ({
  getBridge: () => ({ files: { openExternal: mock.open } }),
}));
vi.mock('qrcode', () => ({ default: { toDataURL: mock.toDataURL } }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${Object.values(values).join(' ')}` : key,
  }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useSearch: () => ({}),
  useNavigate: () => mock.navigate,
}));
import { SupportSettings } from './support-settings';
import { DONATE, isSet } from './evoice-support';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('shows the eVoice Momo and bank details with copy buttons', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<SupportSettings />);
  expect(screen.getByText('supportEvoice.hero_title')).toBeInTheDocument();
  expect(screen.getByText(DONATE.momo.phone)).toBeInTheDocument();
  expect(screen.getByText(DONATE.bank.account)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'supportEvoice.copy supportEvoice.account' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(DONATE.bank.account));
  // No upstream donation channel is left on the page.
  for (const name of ['PayPal', 'Ko-fi', 'GitHub Sponsors'])
    expect(screen.queryByRole('link', { name })).toBeNull();
});

it('draws the bank transfer as a locally generated VietQR code', async () => {
  render(<SupportSettings />);
  const qr = await screen.findByRole('img', { name: `supportEvoice.qr_alt ${DONATE.bank.bank}` });
  expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  const payload = mock.toDataURL.mock.calls[0][0];
  expect(payload.startsWith('000201010211')).toBe(true);
  expect(payload).toContain('0006970416010812650311');
});

it('requests the Momo QR only when it is configured and shipped', () => {
  render(<SupportSettings />);
  const momo = screen.queryByRole('img', { name: 'supportEvoice.qr_alt Momo' });
  if (!isSet(DONATE.momo.qr)) {
    // An unset QR must not be requested: a 404 is a console error in the packaged app.
    expect(momo).toBeNull();
    return;
  }
  expect(momo).toHaveAttribute('src', DONATE.momo.qr);
  // Files under electron/public are served from the app root, so `/donate/x.png` must be shipped.
  const shipped = Object.keys(import.meta.glob('../../../../../public/donate/*', { eager: false }));
  expect(shipped.some((path) => path.endsWith(DONATE.momo.qr))).toBe(true);
});

it('hides the Momo QR when its image fails to load', () => {
  const momoConfig = DONATE.momo as { qr: string };
  const configured = momoConfig.qr;
  momoConfig.qr = '/donate/momo-qr.png';
  try {
    render(<SupportSettings />);
    const momo = screen.getByRole('img', { name: 'supportEvoice.qr_alt Momo' });
    fireEvent.error(momo);
    expect(screen.queryByRole('img', { name: 'supportEvoice.qr_alt Momo' })).toBeNull();
  } finally {
    momoConfig.qr = configured;
  }
});

it('lists only the contact links that are filled in and keeps the Pro page reachable', () => {
  render(<SupportSettings />);
  expect(screen.getByRole('link', { name: 'contact.website' })).toHaveAttribute(
    'href',
    'https://evoicestudio.elevatemarketing.vn',
  );
  for (const label of ['contact.feature_cta', 'contact.community_cta', 'contact.security_cta'])
    expect(screen.queryByRole('link', { name: label })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'supportPlans.get_pro' }));
  expect(mock.navigate).toHaveBeenCalledWith({ to: '/pro' });
});

it('offers PayPal amounts for supporters abroad, each opening its own PayPal.Me link', () => {
  render(<SupportSettings />);
  expect(screen.getByRole('link', { name: '$10' })).toHaveAttribute(
    'href',
    'https://paypal.me/vwilliam2402/10USD',
  );
  const other = screen.getByRole('link', { name: 'supportEvoice.paypal_any' });
  expect(other).toHaveAttribute('href', DONATE.paypal.url);
  fireEvent.click(screen.getByRole('link', { name: '$5' }));
  expect(mock.open).toHaveBeenCalledWith('https://paypal.me/vwilliam2402/5USD');
});
