import childProcess from 'node:child_process';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { normalize } from 'node:path';

/**
 * Chrome flags that keep the page itself offline. Page scripts run inside
 * Chrome, outside this process's guard: a refusing proxy fails every
 * non-loopback request and navigation (Chrome always bypasses the proxy for
 * loopback, where the producer serves the project and drives the browser),
 * the resolver answers no name but localhost, and WebRTC may not send UDP
 * outside the proxy. The page's own CSP (promo-scenes.ts) is a second layer.
 */
export const CHROME_OFFLINE_FLAGS = [
  '--proxy-server=http://127.0.0.1:9',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
] as const;

const samePath = (a: string, b: string) => {
  const left = normalize(a);
  const right = normalize(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
};

/**
 * Appends CHROME_OFFLINE_FLAGS to every launch of `chromePath` in this
 * process. Puppeteer starts Chrome with `child_process.spawn`; patching it
 * (and syncing the ESM named exports) reaches every copy of Puppeteer the
 * producer may load. `launches()` counts the patched starts, so a producer
 * that stopped using spawn shows up as zero instead of an unguarded render.
 */
export function installChromeOfflineFlags(chromePath: string): {
  launches: () => number;
  remove: () => void;
} {
  const original = childProcess.spawn;
  let launches = 0;
  childProcess.spawn = function guardedSpawn(this: unknown, command: unknown, ...rest: unknown[]) {
    if (typeof command === 'string' && samePath(command, chromePath)) {
      launches += 1;
      const args = Array.isArray(rest[0]) ? (rest[0] as string[]) : [];
      const options = Array.isArray(rest[0]) ? rest[1] : rest[0];
      return (original as (...a: unknown[]) => unknown).call(
        this,
        command,
        [
          ...args.filter(
            (arg) => !/^--(proxy-server|host-resolver-rules|proxy-bypass-list)=/.test(arg),
          ),
          ...CHROME_OFFLINE_FLAGS,
        ],
        options,
      );
    }
    return (original as (...a: unknown[]) => unknown).call(this, command, ...rest);
  } as typeof childProcess.spawn;
  syncBuiltinESMExports();
  return {
    launches: () => launches,
    remove: () => {
      childProcess.spawn = original;
      syncBuiltinESMExports();
    },
  };
}

/**
 * Keeps the animated-template renderer on this machine (CLAUDE.md, Local-first).
 *
 * HyperFrames fetches Google Fonts for families without a local `@font-face`,
 * and inlines remote stylesheets, scripts and images. Some of that goes through
 * `globalThis.fetch`, some through undici with its own dispatcher, so the guard
 * sits at the socket: every TCP connection opens through
 * `net.Socket.prototype.connect`. Name lookups and `fetch` are guarded too, so
 * an attempt is recorded even when it would fail before reaching a socket.
 *
 * Only loopback hosts and local pipes are allowed: Puppeteer talks to Chrome
 * over 127.0.0.1 or a pipe, and the producer serves the project from a
 * loopback file server. Every blocked attempt is reported, because the
 * producer swallows font and stylesheet failures and renders a fallback.
 */

export interface BlockedAttempt {
  kind: 'socket' | 'dns' | 'fetch';
  target: string;
}

export function isLoopbackHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (net.isIPv4(name)) return name.startsWith('127.');
  if (net.isIPv6(name)) return name === '::1' || name.startsWith('::ffff:127.');
  return false;
}

/** Host of a `connect(...)` call, or null for a local pipe or Unix socket. */
export function connectTarget(args: unknown[]): string | null {
  let first = args[0];
  // net.connect() hands the socket its normalized [options, callback] pair.
  if (Array.isArray(first)) first = first[0];
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null;
  if (first && typeof first === 'object') {
    const options = first as { path?: unknown; host?: unknown; hostname?: unknown };
    if (typeof options.path === 'string') return null;
    const host = options.host ?? options.hostname;
    return typeof host === 'string' && host ? host : 'localhost';
  }
  return typeof args[1] === 'string' && args[1] ? args[1] : 'localhost';
}

function urlAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'file:' || url.protocol === 'data:' || url.protocol === 'blob:') return true;
  return (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.hostname);
}

function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === 'object' && 'url' in input) return String(input.url);
  return String(input);
}

/** Installs the guard for this process. The returned function removes it. */
export function installNetworkGuard(onBlocked: (attempt: BlockedAttempt) => void): () => void {
  const originalConnect = net.Socket.prototype.connect;
  const originalLookup = dns.lookup;
  const originalPromisesLookup = dns.promises.lookup;
  const originalFetch = globalThis.fetch;

  const refused = (target: string) =>
    Object.assign(new Error(`network access blocked: ${target}`), { code: 'ECONNREFUSED' });

  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    const host = connectTarget(args);
    if (host !== null && !isLoopbackHost(host)) {
      onBlocked({ kind: 'socket', target: host });
      const error = refused(host);
      process.nextTick(() => this.destroy(error));
      return this;
    }
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;

  dns.lookup = function guardedLookup(hostname: string, ...rest: unknown[]) {
    if (!isLoopbackHost(hostname)) {
      onBlocked({ kind: 'dns', target: hostname });
      const callback = rest[rest.length - 1];
      const error = Object.assign(refused(hostname), { code: 'ENOTFOUND' });
      if (typeof callback === 'function') process.nextTick(() => callback(error));
      return undefined;
    }
    return (originalLookup as (...a: unknown[]) => unknown).call(dns, hostname, ...rest);
  } as typeof dns.lookup;

  dns.promises.lookup = async function guardedPromisesLookup(hostname: string, ...rest: unknown[]) {
    if (!isLoopbackHost(hostname)) {
      onBlocked({ kind: 'dns', target: hostname });
      throw Object.assign(refused(hostname), { code: 'ENOTFOUND' });
    }
    return (originalPromisesLookup as (...a: unknown[]) => Promise<unknown>).call(
      dns.promises,
      hostname,
      ...rest,
    );
  } as typeof dns.promises.lookup;

  if (originalFetch) {
    globalThis.fetch = async function guardedFetch(input, init) {
      const url = requestUrl(input);
      if (!urlAllowed(url)) {
        let target = url;
        try {
          target = new URL(url).host || url;
        } catch {
          // Unparseable: report it as given.
        }
        onBlocked({ kind: 'fetch', target });
        throw new TypeError(`network access blocked: ${target}`);
      }
      return originalFetch(input, init);
    } as typeof fetch;
  }
  syncBuiltinESMExports();

  return () => {
    net.Socket.prototype.connect = originalConnect;
    dns.lookup = originalLookup;
    dns.promises.lookup = originalPromisesLookup;
    if (originalFetch) globalThis.fetch = originalFetch;
    syncBuiltinESMExports();
  };
}
