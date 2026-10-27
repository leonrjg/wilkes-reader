import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PdfScrollAnchor } from "./readerPositions.js";

/** The keyboard shortcuts every reader shares. There are two scopes, because
 *  the keys differ in how much else on the screen wants them:
 *
 *   - Zoom (Cmd/Ctrl with `+`, `-`, `0`) is listened for on the window, so it
 *   works wherever focus is. Nothing else in a host claims those chords.
 *   - Page stepping (Left/Right arrows) is listened for on the reader itself, so
 *   it only fires while focus is inside it. Bare arrows are what every list,
 *   tab strip and text field in the host uses too. */

export interface ZoomShortcuts {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

export function useZoomShortcuts(shortcuts: ZoomShortcuts): void {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        latest.current.zoomIn();
      } else if (event.key === "-") {
        event.preventDefault();
        latest.current.zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        latest.current.resetZoom();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** How close to a page's top, as a fraction of its height, still counts as at
 *  that top. Landing a page on the viewport top leaves sub-pixel residue, which
 *  would otherwise read as the foot of the page before and step back to it. */
const PAGE_EDGE = 0.01;

/** The page one step from the reader's place. Forward is the next page's top.
 *  Back is the current page's own top when the reader is part-way down it, and
 *  the previous page's top when it is already at the top. */
export function steppedPage(
  anchor: Pick<PdfScrollAnchor, "page" | "offsetRatio">,
  direction: 1 | -1,
  pageCount: number,
): number {
  const atNextTop = anchor.offsetRatio >= 1 - PAGE_EDGE;
  const page = atNextTop ? anchor.page + 1 : anchor.page;
  const partWay = !atNextTop && anchor.offsetRatio > PAGE_EDGE;
  const target = direction === 1 ? page + 1 : partWay ? page : page - 1;
  return Math.min(pageCount, Math.max(1, target));
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

/** The reader root's `onKeyDown` for page stepping. A page reader makes its
 *  scroll container focusable so a click on the document puts focus here. */
export function pageStepKeyDown(stepPage: (direction: 1 | -1) => void) {
  return (event: ReactKeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (isTextEntry(event.target)) return;
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : null;
    if (direction === null) return;
    event.preventDefault();
    stepPage(direction);
  };
}
