import type { BoundingBox } from "../documentCoordinates.js";
import type { FlowItem, PageFlow } from "./flow.js";

/**
 * Where something on a page as the file has it is drawn now.
 *
 * Everything a host knows about a document it knows in the file's own
 * coordinates: a bookmark's highlight, a search hit, a link's rectangle, where
 * an outline entry points. While a document is being edited the lines those
 * lie on move -- down the page, onto the next -- and some are replaced
 * outright. This answers, for an area or a point of the original page, where
 * to draw it for it to still be on what it was on.
 */

/** An area of a page, in that page's units. */
export interface PageArea {
  page: number;
  rect: BoundingBox;
}

/** Where an item of the page is now, or null if it is drawn nowhere: an edit
 *  stands in for it. */
export type LocateItem = (itemId: string) => { page: number; x: number; y: number } | null;

/** Offsets this close are the same offset. */
const EPSILON = 0.01;

function slicesOf(flow: PageFlow): Array<{ item: FlowItem; rect: BoundingBox }> {
  const slices: Array<{ item: FlowItem; rect: BoundingBox }> = [];
  for (const region of flow.regions) {
    for (const column of region.columns) {
      for (const item of column.items) {
        if (item.content.kind === "slice") slices.push({ item, rect: item.content.rect });
      }
    }
  }
  return slices;
}

/**
 * An area of a page as the file drew it, as the areas it is drawn in now.
 *
 * It follows the lines it lay on: a part on a line that moved moves with it, a
 * part on a line that was replaced by an edit is gone, and an area on nothing
 * that flows -- a margin, a running head -- stays where it is.
 *
 * @param flow The page's flow as it was read from the file, before any edit.
 */
export function relocateArea(
  page: number,
  rect: BoundingBox,
  flow: PageFlow | null,
  locate: LocateItem,
): PageArea[] {
  const unmoved = [{ page, rect }];
  if (!flow) return unmoved;
  const bottom = rect.y + rect.height;
  const right = rect.x + rect.width;
  const under = slicesOf(flow).filter(
    ({ rect: strip }) =>
      strip.y < bottom && strip.y + strip.height > rect.y && strip.x < right && strip.x + strip.width > rect.x,
  );
  if (under.length === 0) return unmoved;

  const pieces: Array<PageArea & { dx: number; dy: number }> = [];
  let displaced = false;
  under.forEach(({ item, rect: strip }, index) => {
    const at = locate(item.id);
    if (!at) {
      displaced = true;
      return;
    }
    const dx = at.x - strip.x;
    const dy = at.y - strip.y;
    if (at.page !== page || Math.abs(dx) > EPSILON || Math.abs(dy) > EPSILON) displaced = true;
    // An area is usually a little taller than the ink it marks. Each line
    // takes the area's share of the space around it: to halfway to the next
    // line it covers, and at either end as far as the area itself goes.
    const above = under[index - 1]?.rect;
    const below = under[index + 1]?.rect;
    const top =
      above && above.y < strip.y ? (above.y + above.height + strip.y) / 2 : rect.y;
    const end =
      below && below.y > strip.y ? (strip.y + strip.height + below.y) / 2 : bottom;
    const piece = {
      page: at.page,
      dx,
      dy,
      rect: { x: rect.x + dx, y: top + dy, width: rect.width, height: end - top },
    };
    // Lines that moved together are still one area, the space between them
    // included.
    const last = pieces[pieces.length - 1];
    const together =
      last &&
      last.page === piece.page &&
      Math.abs(last.dx - dx) < EPSILON &&
      Math.abs(last.dy - dy) < EPSILON;
    if (together) {
      const y = Math.min(last.rect.y, piece.rect.y);
      const foot = Math.max(last.rect.y + last.rect.height, piece.rect.y + piece.rect.height);
      last.rect = { ...last.rect, y, height: foot - y };
    } else {
      pieces.push(piece);
    }
  });
  // Nothing it lay on went anywhere: it is exactly where it was.
  if (!displaced) return unmoved;
  return pieces.map(({ page: on, rect: area }) => ({ page: on, rect: area }));
}

/**
 * A height on a page as the file drew it -- where an outline entry or a link
 * points -- as the page and height that is at now: that of the first line at
 * or under it that is still drawn. Unchanged when there is none.
 */
export function relocateHeight(
  page: number,
  y: number,
  flow: PageFlow | null,
  locate: LocateItem,
): { page: number; y: number } {
  if (!flow) return { page, y };
  const below = slicesOf(flow)
    .filter(({ rect }) => rect.y + rect.height >= y)
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  for (const { item, rect } of below) {
    const at = locate(item.id);
    if (at) return { page: at.page, y: at.y + Math.max(0, y - rect.y) };
  }
  return { page, y };
}
