import {
  caretRect,
  lineRects,
  placeCaretAtPoint,
  positionAtPoint,
  selectText,
  textLength,
  textOffsetOf,
} from "./editableText.js";

/**
 * Carrying the caret from one paragraph to the next, and to the text from the
 * space around it.
 *
 * A paragraph's lines are placed one by one over the page, and the paragraphs
 * of a page column by column, so what is next to what on screen is not what is
 * next to what in the document. An arrow key at the edge of a paragraph -- its
 * first or last line, its first or last character -- is therefore taken here
 * to the neighbouring paragraph, keeping its column as it would between two
 * lines of one.
 *
 * Only the text itself takes the pointer: the space between paragraphs, the
 * margins and the figures are the page's. A click there would otherwise take
 * the focus out of the text altogether; as in a word processor, it puts the
 * caret on the nearest line of the page instead, and a drag from there selects.
 */

/** Marks the element a paragraph's text is in. Their order in the document is
 *  reading order. */
export const PARAGRAPH_HOST = "data-pdf-edit-paragraph";

type Edge = "start" | "end";

/** A page's extent on screen, top to bottom, in client px. */
export interface PageExtent {
  top: number;
  bottom: number;
}

/** What a press on the page leaves to the browser: whatever is its own to
 *  click, and the text, where the browser places the caret itself. */
const NOT_BLANK = `[${PARAGRAPH_HOST}], a, button, input, textarea, select, [role="button"]`;

/**
 * Have a press on the page's blank space put the caret in the text: on the
 * nearest line of the page pressed, at the column pressed, or extending the
 * selection with Shift. Held and dragged, it selects from there. `pageAt` is
 * the extent of the page at a height on screen, if there is one.
 */
export function attachCaretPlacement(
  surface: HTMLElement,
  layer: HTMLElement,
  pageAt: (clientY: number) => PageExtent | null,
): () => void {
  const nearest = (x: number, y: number) => {
    const page = pageAt(y);
    const hosts = [...layer.querySelectorAll<HTMLElement>(`[${PARAGRAPH_HOST}]`)];
    return page && positionNear(hosts, x, y, page);
  };

  let stopDragging: (() => void) | null = null;
  const onMouseDown = (event: MouseEvent) => {
    // A modifier is a link to follow or a menu to open, not a place to type.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!(event.target instanceof Element) || event.target.closest(NOT_BLANK)) return;
    const at = nearest(event.clientX, event.clientY);
    // A page with no text on it -- or none read yet -- has nowhere to put it.
    if (!at) return;
    event.preventDefault();
    layer.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    if (event.shiftKey && selection.anchorNode && layer.contains(selection.anchorNode)) {
      selection.extend(at.node, at.offset);
    } else {
      selection.collapse(at.node, at.offset);
    }
    const anchor = { node: selection.anchorNode ?? at.node, offset: selection.anchorOffset };

    stopDragging?.();
    const onMove = (move: MouseEvent) => {
      const to = nearest(move.clientX, move.clientY);
      if (to) selection.setBaseAndExtent(anchor.node, anchor.offset, to.node, to.offset);
    };
    const stop = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", stop);
      stopDragging = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stop);
    stopDragging = stop;
  };

  surface.addEventListener("mousedown", onMouseDown);
  return () => {
    surface.removeEventListener("mousedown", onMouseDown);
    stopDragging?.();
  };
}

/** The text position nearest a point, on the lines of `hosts` that are on
 *  `page`, at the point's column -- or at the end of the line nearer the
 *  point, if the point is beside it.
 *
 *  Nearest as a word processor means it: a paragraph is as near as its
 *  nearest line is high or low of the point, however far short of the point a
 *  line ends -- past the end of a short last line is still under it. Only
 *  outside the width its lines span does how far the point is to one side
 *  count as well. */
function positionNear(
  hosts: HTMLElement[],
  x: number,
  y: number,
  page: PageExtent,
): { node: Node; offset: number } | null {
  let best: { host: HTMLElement; line: DOMRect; distance: number } | null = null;
  for (const host of hosts) {
    const lines = lineRects(host).filter((line) => {
      const middle = (line.top + line.bottom) / 2;
      return middle >= page.top && middle <= page.bottom;
    });
    if (lines.length === 0) continue;
    const left = Math.min(...lines.map((line) => line.left));
    const right = Math.max(...lines.map((line) => line.right));
    const aside = Math.max(left - x, 0, x - right);
    for (const line of lines) {
      const distance = Math.hypot(aside, Math.max(line.top - y, 0, y - line.bottom));
      // Ties -- lines of a paragraph level with the point -- go to the line
      // the point is nearest the end of.
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance && alongOf(line, x) < alongOf(best.line, x))
      ) {
        best = { host, line, distance };
      }
    }
  }
  if (!best) return null;
  const { host, line } = best;
  // Half a pixel inside the line: the nearest place to its edge is the edge.
  const column = Math.min(Math.max(x, line.left + 0.5), line.right - 0.5);
  return positionAtPoint(host, column, (line.top + line.bottom) / 2);
}

/** How far to one side of a line a column is. */
const alongOf = (line: DOMRect, x: number) => Math.max(line.left - x, 0, x - line.right);

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
