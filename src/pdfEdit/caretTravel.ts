import { caretRect, lineRects, placeCaretAtPoint, selectText, textLength, textOffsetOf } from "./editableText.js";

/**
 * Carrying the caret from one paragraph to the next.
 *
 * A paragraph's lines are placed one by one over the page, and the paragraphs
 * of a page column by column, so what is next to what on screen is not what is
 * next to what in the document. An arrow key at the edge of a paragraph -- its
 * first or last line, its first or last character -- is therefore taken here
 * to the neighbouring paragraph, keeping its column as it would between two
 * lines of one.
 */

/** Marks the element a paragraph's text is in. Their order in the document is
 *  reading order. */
export const PARAGRAPH_HOST = "data-pdf-edit-paragraph";

type Edge = "start" | "end";

export function travelOnArrow(event: KeyboardEvent, layer: HTMLElement | null): void {
  if (!layer || event.defaultPrevented) return;
  // With a modifier an arrow extends a selection or jumps by word or line,
  // and all of those are the browser's within one paragraph.
  if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode) return;
  const { anchorNode } = selection;
  const host = (anchorNode instanceof Element ? anchorNode : anchorNode.parentElement)?.closest<HTMLElement>(
    `[${PARAGRAPH_HOST}]`,
  );
  if (!host) return;

  const hosts = [...layer.querySelectorAll<HTMLElement>(`[${PARAGRAPH_HOST}]`)];
  const index = hosts.indexOf(host);
  const offset = textOffsetOf(host, selection.anchorNode, selection.anchorOffset);

  let destination: HTMLElement | undefined;
  let edge: Edge;
  let column: number | null = null;
  if (event.key === "ArrowLeft" && offset === 0) {
    destination = hosts[index - 1];
    edge = "end";
  } else if (event.key === "ArrowRight" && offset >= textLength(host)) {
    destination = hosts[index + 1];
    edge = "start";
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    const caret = caretRect();
    const lines = lineRects(host);
    if (!caret || lines.length === 0) return;
    const middle = (caret.top + caret.bottom) / 2;
    const up = event.key === "ArrowUp";
    if (up ? middle > lines[0].bottom : middle < lines[lines.length - 1].top) return;
    destination = hosts[index + (up ? -1 : 1)];
    edge = up ? "end" : "start";
    column = caret.left;
  } else {
    return;
  }
  if (!destination) return;

  event.preventDefault();
  enter(destination, edge, column);
}

/** Put the caret in a paragraph: at its first or last character, or -- coming
 *  from the line above or below -- at the given column of its nearest line. */
function enter(host: HTMLElement, edge: Edge, column: number | null): void {
  const lines = lineRects(host);
  const line = edge === "start" ? lines[0] : lines[lines.length - 1];
  const placed =
    column !== null &&
    line !== undefined &&
    placeCaretAtPoint(
      host,
      Math.min(Math.max(column, line.left + 1), line.right - 1),
      (line.top + line.bottom) / 2,
    );
  if (!placed) {
    const offset = edge === "start" ? 0 : textLength(host);
    selectText(host, offset, offset);
  }
  revealCaret(host);
}

/** Scroll the caret into view. `scrollIntoView` on the element would not do:
 *  a paragraph can be taller than the viewport, or sized to nothing with its
 *  lines placed absolutely. */
function revealCaret(host: HTMLElement): void {
  const caret = caretRect();
  const scroller = scrollParent(host);
  if (!caret || !scroller) return;
  const bounds = scroller.getBoundingClientRect();
  const margin = caret.height * 2;
  if (caret.top < bounds.top + margin) {
    scroller.scrollTop -= bounds.top + margin - caret.top;
  } else if (caret.bottom > bounds.bottom - margin) {
    scroller.scrollTop += caret.bottom - (bounds.bottom - margin);
  }
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
  }
  return null;
}
