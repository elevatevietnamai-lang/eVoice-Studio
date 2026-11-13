/**
 * VietQR (NAPAS EMVCo) payload for a bank-account transfer, built on this computer: no image
 * service is contacted. Any Vietnamese banking or wallet app that scans VietQR reads it.
 */
function field(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as EMVCo requires for tag 63. */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function vietQrPayload({
  bin,
  account,
  note,
}: {
  /** NAPAS bank identifier, e.g. 970416 for ACB. */
  bin: string;
  account: string;
  /** Optional transfer note (ASCII, at most 25 characters). */
  note?: string;
}): string {
  const beneficiary = field('00', bin) + field('01', account);
  const merchant = field('00', 'A000000727') + field('01', beneficiary) + field('02', 'QRIBFTTA');
  let payload =
    field('00', '01') +
    field('01', '11') +
    field('38', merchant) +
    field('53', '704') +
    field('58', 'VN');
  if (note) payload += field('62', field('08', note.slice(0, 25)));
  payload += '6304';
  return payload + crc16(payload);
}
