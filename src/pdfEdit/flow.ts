import type { BoundingBox } from "../documentCoordinates.js";

/**
 * A page, described as something that can be laid out again.
 *
 * A PDF page is a picture: it has no paragraphs, no columns and no notion that
 * one line follows another. Editing text in place needs all three, so this is
 * the model the editor reads a page *into* -- and the only thing the reflow
 * engine ever sees. Nothing in here knows about pdf.js, canvases or the DOM.
 *
 * The shape is the smallest one that reflows honestly:
 *
 *   page ─ regions, stacked top to bottom
 *            └ columns, side by side
 *                 └ items, stacked top to bottom
 *
 * An item is the unit that moves and is never cut: a line of text, a figure, a
 * rule. Everything is in the page's own units, origin top-left.
 */

/** What an item draws. */
export type FlowContent =
  /** A horizontal strip of a page as the file drew it. `locked` when the host
   *  says what is on it is not prose -- a formula, a table: it then moves as
   *  one piece and is not offered as text to edit. */
  | { kind: "slice"; page: number; rect: BoundingBox; locked?: boolean }
  /** `lines` consecutive line boxes of an edited paragraph, starting at `line`. */
  | { kind: "edit"; editId: string; line: number; lines: number };

export interface FlowItem {
  /** Stable across re-analysis, so an edit can name the items it replaced. */
  id: string;
  height: number;
  /** Space between the ink of the item above this one in its column and this
   *  item's top. Not applied to the first item of a column, whose place is the
   *  column's. */
  gapBefore: number;
  /** How much of the item's head is empty. A line box is taller than the ink
   *  of its line; at the head of a column it is the ink that goes where the
   *  column starts, and the box stands that much above it. */
  leading: number;
  /** How much of the item's foot is empty. The item after it is spaced from
   *  the ink, and a page is full when its ink reaches the bottom, not when the
   *  leading under its last line does: this much may hang past it. */
  trailing: number;
  content: FlowContent;
}

export interface FlowColumn {
  x: number;
  width: number;
  /** Where the column's first item sits below the region's top. Dropped when
   *  displaced content arrives ahead of it. */
  lead: number;
  items: FlowItem[];
  /** How much more the file could have set under the column's last item
   *  before the column had to stop. A statement about the file, which stays
   *  what it was however the column's items change. */
  room: number;
  /** What the column's first item needed to be set under another: its gap and
   *  its height. Also as the file had it. */
  opens: number;
}

export interface FlowRegion {
  /** Space above this region when another region precedes it on the page. */
  gapBefore: number;
  /** How tall the file made the region, where something under it on the page
   *  says so. Null for a page's last region, which runs to the body's foot. */
  depth: number | null;
  columns: FlowColumn[];
}

/** The vertical extent content may occupy on a page. */
export interface BodyFrame {
  top: number;
  bottom: number;
}

export interface PageFlow {
  page: number;
  width: number;
  height: number;
  body: BodyFrame;
  /** Where the first region sits below the body's top when nothing was pushed
   *  onto this page ahead of it. */
  lead: number;
  regions: FlowRegion[];
  /** Areas of this page that stay where they are: running heads, page numbers. */
  fixed: BoundingBox[];
  /** The colour of bare paper, as CSS. */
  background: string;
}

/** Where an item ended up. */
export interface Placement {
  item: FlowItem;
  x: number;
  y: number;
  width: number;
}
