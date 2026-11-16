/** Shared imports for the editor's unit tests. */
import type { TimelineElement } from '@/lib/opencut/vendor/timeline/types';
import { findElement, type EditorProject, type ElementRef } from './project';

export * from './timeline-ops';

export function findElementIn(project: EditorProject, ref: ElementRef): TimelineElement {
  const found = findElement(project, ref);
  if (!found) throw new Error('missing element');
  return found.element;
}
