/**
 * eVoice Studio's own support details: where donations go and how to reach the team.
 * Edit this file to change them. A link left as '#' is not shown until it is filled in.
 */
export const DONATE = {
  momo: {
    phone: '0983863437',
    holder: 'VO THANH BINH',
    /** Optional QR exported from the Momo app; place the PNG at electron/public/donate/momo-qr.png. */
    qr: '/donate/momo-qr.png',
  },
  bank: {
    bank: 'ACB',
    /** NAPAS bank identifier used in the VietQR code. */
    bin: '970416',
    account: '12650311',
    holder: 'VO THANH BINH',
    note: 'Ung ho eVoice Studio',
  },
  /** For supporters outside Vietnam. Amount links use PayPal.Me's /<amount>USD form. */
  paypal: {
    url: 'https://paypal.me/vwilliam2402',
    amounts: [5, 10, 20],
  },
} as const;

export const EVOICE_LINKS = {
  website: 'https://evoicestudio.elevatemarketing.vn',
  feature: '#',
  community: '#',
  follow: '#',
  security: '#',
  email: '#',
} as const;

export const isSet = (href: string) => href !== '' && href !== '#';
