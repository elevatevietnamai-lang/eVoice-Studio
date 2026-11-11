import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

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
