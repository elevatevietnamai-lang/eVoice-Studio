import { createContext } from 'react';

/**
 * Where page control panels render: the shell's second column, beside the rail and full height.
 * `undefined` (no provider, as in component tests) renders the panel in place; `null` means the
 * column has not mounted yet.
 */
export const PanelSlotContext = createContext<HTMLElement | null | undefined>(undefined);
