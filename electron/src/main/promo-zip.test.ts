// @vitest-environment node
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readZip, safeEntryName, writeZip, ZipError } from './promo-zip';

const limits = { maxEntries: 10, maxEntryBytes: 1024, maxTotalBytes: 2048 };
const enc = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ZipError) return error.code;
    throw error;
  }
  return 'none';
}

/** A zip with one entry whose header fields can be forged. */
function forged(
  name: string,
  data: Uint8Array,
  opts: { method?: number; size?: number; flags?: number; madeBy?: number; mode?: number } = {},
): Uint8Array {
  const method = opts.method ?? 8;
  const body = method === 8 ? deflateRawSync(data) : Buffer.from(data);
  const nameBytes = Buffer.from(name, 'utf8');
  const size = opts.size ?? data.length;
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(((opts.madeBy ?? 0) << 8) | 20, 4);
  central.writeUInt16LE(opts.flags ?? 0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(((opts.mode ?? 0) << 16) >>> 0, 38);
  const offset = 30 + nameBytes.length + body.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([local, nameBytes, body, central, nameBytes, end]));
}

describe('promo zip', () => {
  it('round-trips what it writes', () => {
    const files = new Map([
      ['index.html', enc('<h1>Hi</h1>'.repeat(20))],
      ['assets/logo.png', new Uint8Array([1, 2, 3, 4])],
    ]);
    const back = readZip(writeZip(files), limits);
    expect([...back.keys()]).toEqual(['index.html', 'assets/logo.png']);
    expect(Buffer.from(back.get('index.html')!).toString()).toBe('<h1>Hi</h1>'.repeat(20));
    expect([...back.get('assets/logo.png')!]).toEqual([1, 2, 3, 4]);
  });

  it.each([
    '../evil.html',
    'assets/../../evil',
    '/etc/passwd',
    'C:/Windows/evil',
    'c:evil',
    'assets\\evil.png',
    'a/b/c.png',
    '.hidden',
    'assets/.htaccess',
    'name with space.png',
    '',
  ])('refuses the unsafe name %j', (name) => {
    expect(safeEntryName(name)).toBeNull();
    expect(code(() => readZip(forged(name || 'x/', enc('x')), limits))).toMatch(/unsafe_name|none/);
  });

  it('refuses traversal and absolute entries when reading', () => {
    expect(code(() => readZip(forged('../evil.html', enc('x')), limits))).toBe('unsafe_name');
    expect(code(() => readZip(forged('/abs.html', enc('x')), limits))).toBe('unsafe_name');
  });

  it('refuses symbolic links, encryption and unknown methods', () => {
    expect(
      code(() => readZip(forged('link.png', enc('/etc'), { madeBy: 3, mode: 0o120777 }), limits)),
    ).toBe('symlink');
    expect(code(() => readZip(forged('a.png', enc('x'), { flags: 1 }), limits))).toBe('encrypted');
    expect(code(() => readZip(forged('a.png', enc('x'), { method: 12 }), limits))).toBe(
      'unsupported_method',
    );
  });

  it('stops a zip bomb at the declared size', () => {
    const bomb = new Uint8Array(1024 * 1024); // 1 MiB of zeros deflates to ~1 KiB
    // Declared small: inflating past it is refused without inflating it all.
    expect(code(() => readZip(forged('a.png', bomb, { size: 100 }), limits))).toBe('corrupt');
    // Declared honestly: over the per-entry cap.
    expect(code(() => readZip(forged('a.png', bomb), limits))).toBe('entry_too_large');
  });

  it('caps the entry count and the total size', () => {
    const many = new Map<string, Uint8Array>();
    for (let i = 0; i < 11; i += 1) many.set(`f${i}.txt`, enc('x'));
    expect(code(() => readZip(writeZip(many), limits))).toBe('too_many_entries');
    const big = new Map<string, Uint8Array>();
    for (let i = 0; i < 3; i += 1) big.set(`f${i}.txt`, new Uint8Array(1000));
    expect(code(() => readZip(writeZip(big), limits))).toBe('too_large');
  });

  it('refuses names that collide when case is ignored', () => {
    const files = new Map([
      ['Logo.png', enc('a')],
      ['logo.png', enc('b')],
    ]);
    expect(code(() => readZip(writeZip(files), limits))).toBe('duplicate_name');
  });

  it('rejects data that is not a zip', () => {
    expect(code(() => readZip(enc('<html></html>'), limits))).toBe('not_zip');
  });
});
