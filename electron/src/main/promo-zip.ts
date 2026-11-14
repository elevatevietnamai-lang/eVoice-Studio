import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * The small zip subset scene templates need, on Node's zlib (no dependency).
 *
 * Reading treats the archive as untrusted (an imported template, docs/electron-promo.md):
 * entry names never become disk paths, they are checked into a flat in-memory
 * map; the entry count, each declared size and each inflated size are capped
 * (inflation stops at the cap, so a zip bomb costs at most the cap); ZIP64,
 * encrypted entries, symbolic links, duplicate names and anything other than
 * stored or deflated entries are refused.
 */

export class ZipError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`zip:${code}`);
    this.code = code;
  }
}

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** End-of-central-directory record, plus a comment of at most 64 KiB. */
const EOCD_SEARCH = 22 + 0xffff;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

/**
 * A safe archive path: forward slashes, segments of letters, digits, `.`,
 * `_` and `-` only, never `.` or `..`, never absolute, at most two levels.
 * Returns null for anything else.
 */
export function safeEntryName(raw: string): string | null {
  if (!raw || raw.length > 120 || raw.includes('\\') || raw.includes('\0')) return null;
  if (raw.startsWith('/') || /^[a-z]:/i.test(raw)) return null;
  const parts = raw.split('/');
  if (parts.length > 2) return null;
  for (const part of parts) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(part) || part === '.' || part === '..') return null;
    if (part.startsWith('.')) return null;
  }
  return parts.join('/');
}

/** Entries of a zip as name → bytes. Directories are skipped. Throws ZipError. */
export function readZip(data: Uint8Array, limits: ZipLimits): Map<string, Uint8Array> {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let at = buf.length - 22; at >= Math.max(0, buf.length - EOCD_SEARCH); at -= 1) {
    if (buf.readUInt32LE(at) === EOCD) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('not_zip');
  const count = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff) throw new ZipError('zip64');
  if (count > limits.maxEntries) throw new ZipError('too_many_entries');
  if (dirOffset + dirSize > eocd) throw new ZipError('corrupt');

  const out = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  let total = 0;
  let at = dirOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > eocd || buf.readUInt32LE(at) !== CENTRAL) throw new ZipError('corrupt');
    const madeBy = buf.readUInt16LE(at + 4) >> 8;
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const expectedCrc = buf.readUInt32LE(at + 16);
    const compressed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const external = buf.readUInt32LE(at + 38);
    const localOffset = buf.readUInt32LE(at + 42);
    const rawName = buf.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    if (flags & 0x1) throw new ZipError('encrypted');
    if (compressed === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError('zip64');
    }
    // Unix mode lives in the high half of the external attributes (made by 3).
    const mode = madeBy === 3 ? external >>> 16 : 0;
    if ((mode & S_IFMT) === S_IFLNK) throw new ZipError('symlink');
    if (rawName.endsWith('/') || (mode & S_IFMT) === S_IFDIR) continue;
    const name = safeEntryName(rawName);
    if (!name) throw new ZipError('unsafe_name');
    const folded = name.toLowerCase();
    if (seen.has(folded)) throw new ZipError('duplicate_name');
    seen.add(folded);
    if (size > limits.maxEntryBytes) throw new ZipError('entry_too_large');
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError('too_large');

    if (localOffset + 30 > dirOffset || buf.readUInt32LE(localOffset) !== LOCAL) {
      throw new ZipError('corrupt');
    }
    const start =
      localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (start + compressed > dirOffset) throw new ZipError('corrupt');
    const body = buf.subarray(start, start + compressed);
    let bytes: Buffer;
    if (method === 0) {
      bytes = Buffer.from(body);
    } else if (method === 8) {
      try {
        // One byte over the declared size proves the header lied.
        bytes = inflateRawSync(body, { maxOutputLength: size + 1 });
      } catch {
        throw new ZipError('corrupt');
      }
    } else {
      throw new ZipError('unsupported_method');
    }
    if (bytes.length !== size) throw new ZipError('size_mismatch');
    if (crc32(bytes) !== expectedCrc) throw new ZipError('crc');
    out.set(name, new Uint8Array(bytes));
  }
  return out;
}

/** A deflated zip of `files` (names must already be safe). */
export function writeZip(files: Map<string, Uint8Array>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    if (safeEntryName(name) !== name) throw new ZipError('unsafe_name');
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data);
    const stored = deflated.length >= data.length;
    const body = stored ? Buffer.from(data) : deflated;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}
