/**
 * Records how the user last interacted, on `<html data-input-modality>`: `pointer` after a
 * mouse, pen or touch press, `keyboard` after a key (not a bare shortcut chord).
 *
 * Browsers decide `:focus-visible` with a heuristic that also fires when a popup hands focus
 * back to its trigger after a click (a Select, a menu, a dialog). `globals.css` uses this mark to
 * drop the focus ring in that case, so a clicked button or dropdown does not stay outlined, while
 * keyboard focus always keeps its ring.
 */
export function installInputModality(doc: Document = document): () => void {
  const root = doc.documentElement;
  const onPointer = () => {
    root.dataset.inputModality = 'pointer';
  };
  const onKey = (event: KeyboardEvent) => {
    // Ctrl/Cmd/Alt chords are shortcuts, not focus navigation.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    root.dataset.inputModality = 'keyboard';
  };
  doc.addEventListener('pointerdown', onPointer, true);
  doc.addEventListener('keydown', onKey, true);
  return () => {
    doc.removeEventListener('pointerdown', onPointer, true);
    doc.removeEventListener('keydown', onKey, true);
    delete root.dataset.inputModality;
  };
}
