import { GroupMenuPanel } from './workspace-menu';

/**
 * The second column: the page's control panel (portalled into the inner node), or the menu of the
 * rail group the user opened, laid over it so the content beside it never reflows.
 */
export function PanelColumn({ onSlot }: { onSlot: (element: HTMLElement | null) => void }) {
  return (
    <div data-panel-slot="" className="relative flex min-h-0 shrink-0">
      <div ref={onSlot} className="contents" />
      <GroupMenuPanel />
    </div>
  );
}
