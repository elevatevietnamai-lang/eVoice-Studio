import { useSyncExternalStore } from 'react';
type Layout = {
  expandedLibraryContext?: string | null;
  editingProfileId?: string | null;
  panel: 'voice' | null;
  libraryOpen: boolean;
  libraryTab: 'voices' | 'takes';
  /** Shrink the sidebar to a rail when a workspace opens its own side panel on a narrow window. */
  autoCollapseSidebar: boolean;
  /** The current page's control panel is folded to its strip. Reopens on every navigation. */
  panelCollapsed: boolean;
};
const key = 'voicestudio.workspace-layout';
const defaults: Layout = {
  panel: null,
  libraryOpen: true,
  libraryTab: 'voices',
  autoCollapseSidebar: true,
  panelCollapsed: false,
};
function read(): Layout {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}');
    return {
      // Voice controls moved to a composer popover; a stored 'settings' pane is dropped.
      panel: value?.panel === 'voice' ? 'voice' : null,
      libraryOpen: typeof value?.libraryOpen === 'boolean' ? value.libraryOpen : true,
      libraryTab: value?.libraryTab === 'takes' ? 'takes' : 'voices',
      autoCollapseSidebar:
        typeof value?.autoCollapseSidebar === 'boolean' ? value.autoCollapseSidebar : true,
      panelCollapsed: false,
    };
  } catch {
    return defaults;
  }
}
let current = read();
const listeners = new Set<() => void>();
export function setWorkspace(patch: Partial<Layout>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(key, JSON.stringify(current));
  } catch {
    /* Session layout remains available. */
  }
  listeners.forEach((listener) => listener());
}
export function useWorkspace() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}

/**
 * How many control panels are mounted. The rail shows its panel toggle only while one is, so pages
 * without a panel (Settings, Saved, Calls) never show a toggle that does nothing.
 */
let mountedPanels = 0;
const panelListeners = new Set<() => void>();
export function registerPanel(): () => void {
  mountedPanels += 1;
  panelListeners.forEach((listener) => listener());
  return () => {
    mountedPanels -= 1;
    panelListeners.forEach((listener) => listener());
  };
}
export function usePanelMounted(): boolean {
  return useSyncExternalStore(
    (listener) => {
      panelListeners.add(listener);
      return () => {
        panelListeners.delete(listener);
      };
    },
    () => mountedPanels > 0,
  );
}
