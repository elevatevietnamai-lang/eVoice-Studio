// @vitest-environment node
import childProcess from 'node:child_process';
import dns from 'node:dns';
import { createServer, type AddressInfo, connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHROME_OFFLINE_FLAGS,
  connectTarget,
  installChromeOfflineFlags,
  installNetworkGuard,
  isLoopbackHost,
  type BlockedAttempt,
} from './promo-network-guard';

let remove: (() => void) | null = null;
afterEach(() => {
  remove?.();
  remove = null;
});

describe('isLoopbackHost', () => {
  it.each(['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.8.9.1', '::1', '[::1]'])(
    'allows %s',
    (host) => expect(isLoopbackHost(host)).toBe(true),
  );
  it.each(['fonts.googleapis.com', '10.0.0.1', '0.0.0.0', 'localhost.evil.test', '::ffff:8.8.8.8'])(
    'blocks %s',
    (host) => expect(isLoopbackHost(host)).toBe(false),
  );
});

describe('connectTarget', () => {
  it('reads every connect() calling form', () => {
    expect(connectTarget([{ host: 'example.test', port: 443 }])).toBe('example.test');
    expect(connectTarget([[{ host: 'example.test', port: 80 }, null]])).toBe('example.test');
    expect(connectTarget([443, 'example.test'])).toBe('example.test');
    expect(connectTarget([8080])).toBe('localhost');
    expect(connectTarget([{ port: 80 }])).toBe('localhost');
    expect(connectTarget([{ path: '\\\\.\\pipe\\chrome' }])).toBeNull();
    expect(connectTarget(['/tmp/devtools.sock'])).toBeNull();
  });
});

describe('installNetworkGuard', () => {
  it('records and refuses sockets, lookups and fetches to outside hosts', async () => {
    const blocked: BlockedAttempt[] = [];
    remove = installNetworkGuard((attempt) => blocked.push(attempt));

    const socketError = await new Promise<Error>((resolve) => {
      connect({ host: '93.184.216.34', port: 443 }).on('error', resolve);
    });
    expect(socketError.message).toContain('blocked');

    const lookupError = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      dns.lookup('fonts.googleapis.com', (error) => resolve(error)),
    );
    expect(lookupError?.code).toBe('ENOTFOUND');
    await expect(dns.promises.lookup('fonts.gstatic.com')).rejects.toThrow('blocked');
    await expect(fetch('https://fonts.googleapis.com/css2?family=Inter')).rejects.toThrow(
      'blocked',
    );

    expect(blocked).toEqual([
      { kind: 'socket', target: '93.184.216.34' },
      { kind: 'dns', target: 'fonts.googleapis.com' },
      { kind: 'dns', target: 'fonts.gstatic.com' },
      { kind: 'fetch', target: 'fonts.googleapis.com' },
    ]);
  });

  it('lets loopback traffic through', async () => {
    const server = createServer((socket) => socket.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const blocked: BlockedAttempt[] = [];
    remove = installNetworkGuard((attempt) => blocked.push(attempt));
    try {
      const reply = await new Promise<string>((resolve, reject) => {
        let data = '';
        connect({ host: '127.0.0.1', port })
          .on('data', (chunk) => (data += chunk))
          .on('end', () => resolve(data))
          .on('error', reject);
      });
      expect(reply).toBe('ok');
      expect(blocked).toEqual([]);
    } finally {
      server.close();
    }
  });

  it('restores the original functions when removed', () => {
    const original = dns.lookup;
    const undo = installNetworkGuard(() => {});
    expect(dns.lookup).not.toBe(original);
    undo();
    expect(dns.lookup).toBe(original);
  });
});

describe('installChromeOfflineFlags', () => {
  it('adds the offline flags to Chrome launches only, and counts them', () => {
    const calls: unknown[][] = [];
    const original = childProcess.spawn;
    childProcess.spawn = ((...args: unknown[]) => {
      calls.push(args);
      return {} as never;
    }) as typeof childProcess.spawn;
    const chrome = '/app/promo-browser/chrome-headless-shell';
    const guard = installChromeOfflineFlags(chrome);
    try {
      childProcess.spawn(chrome, ['--headless', '--proxy-server=http://evil:8080'], {});
      childProcess.spawn('/bin/ffmpeg', ['-i', 'x'], {});
      expect(calls[0][1]).toEqual(['--headless', ...CHROME_OFFLINE_FLAGS]);
      expect(calls[1][1]).toEqual(['-i', 'x']);
      expect(guard.launches()).toBe(1);
    } finally {
      guard.remove();
      childProcess.spawn = original;
    }
  });

  it('keeps the loopback bypass Chrome needs to reach the producer', () => {
    // `<-loopback>` would send 127.0.0.1 through the refusing proxy too.
    expect(CHROME_OFFLINE_FLAGS.join(' ')).not.toContain('<-loopback>');
    expect(CHROME_OFFLINE_FLAGS).toContain('--proxy-server=http://127.0.0.1:9');
  });
});
