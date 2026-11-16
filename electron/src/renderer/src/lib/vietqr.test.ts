import { expect, it } from 'vitest';
import { crc16, vietQrPayload } from './vietqr';

it('uses CRC-16/CCITT-FALSE', () => {
  expect(crc16('123456789')).toBe('29B1');
});

it('encodes a static account transfer with its checksum', () => {
  const payload = vietQrPayload({
    bin: '970416',
    account: '12650311',
    note: 'Ung ho eVoice Studio',
  });
  expect(payload.startsWith('000201010211')).toBe(true);
  expect(payload).toContain('0010A000000727');
  expect(payload).toContain('0006970416010812650311');
  expect(payload).toContain('0208QRIBFTTA');
  expect(payload).toContain('5303704');
  expect(payload).toContain('5802VN');
  expect(payload).toContain('62240820Ung ho eVoice Studio');
  expect(payload.slice(-8, -4)).toBe('6304');
  expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
});
