import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { installAppIdentity } from './app-identity';

describe('installAppIdentity', () => {
  it('names Electron internals consistently', () => {
    const setName = vi.fn();
    const setPath = vi.fn();
    const getPath = vi.fn(() => join('/home', 'appdata'));

    installAppIdentity({ setName, setPath, getPath });

    expect(setName).toHaveBeenCalledOnce();
    expect(setName).toHaveBeenCalledWith('eVoice Studio');
  });

  it('keeps the existing data folder when the product name changes', () => {
    const setPath = vi.fn();

    installAppIdentity({
      setName: vi.fn(),
      setPath,
      getPath: () => join('/home', 'appdata'),
    });

    expect(setPath).toHaveBeenCalledWith('userData', join('/home', 'appdata', 'VoiceStudio'));
  });

  it('leaves an explicit --user-data-dir profile in place', () => {
    const setPath = vi.fn();

    installAppIdentity({
      setName: vi.fn(),
      setPath,
      getPath: () => join('/home', 'appdata'),
      commandLine: { hasSwitch: (name: string) => name === 'user-data-dir' },
    });

    expect(setPath).not.toHaveBeenCalled();
  });

  it('installs the identity before Electron begins ready initialization', () => {
    const entrypoint = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8');
    const identityInstall = entrypoint.indexOf('installAppIdentity(app);');
    const readyInitialization = entrypoint.indexOf('.whenReady()');

    expect(identityInstall).toBeGreaterThanOrEqual(0);
    expect(readyInitialization).toBeGreaterThan(identityInstall);
  });
});
