import type { FlowItem, FlowRegion, PageFlow, Placement } from "./flow.js";

/**
 * Lays a document's pages out again after their content changed height.
 *
 * The rules, which are the whole of what "reflow" means here:
 *
 *   1. Regions stack. A region that grew pushes the regions below it down.
 *   2. An item that no longer fits above the body's bottom leaves its column.
 *      It goes to the head of the next column of its region; out of the last
 *      column, it goes to the next page, ahead of that page's own content.
 *   3. Everything below a region that overflowed leaves the page with it, in
 *      reading order.
 *   4. Content never moves to an earlier page. A page that ends short -- the
 *      last page of a chapter -- is where a cascade stops, and it is not
 *      refilled from the page after it, because nothing in the file says
 *      whether that break was forced.
 *
 * Laying out a page nothing was pushed onto, whose content did not change,
 * returns every item to where the file drew it. That identity is what lets an
 * untouched page be drawn straight from its raster.
 */

export interface PagePlan {
  page: number;
  placements: Placement[];
}

export interface Reflow {
  /** A plan for every page the edits reach. A page with no plan is unchanged. */
  plans: Map<number, PagePlan>;
  /** The last page that holds content, which may be past the document's end. */
  lastPage: number;
  /** Pages the cascade reached but could not lay out, because they have not
   *  been analysed. The layout is incomplete until they are. */
  missing: number[];
  /** Pages a cascade stopped short of because they are past the horizon: not
   *  analysed, and nobody is looking that far yet. The layout is incomplete
   *  there too, but nothing is being asked for. */
  deferred: number[];
}

/** Rounding slack, in page units. Positions are sums of measured heights. */
const EPSILON = 0.01;
/** Two column sets are the same layout when their widths agree this closely. */
const SHAPE_TOLERANCE = 6;
/** Far more pages than any cascade should append; reaching it is a bug. */
const MAX_APPENDED_PAGES = 500;

/**
 * @param flowOf  The flow of any page, including pages past the document's
 *                end (which are empty). `null` when it is not known yet.
 * @param origins Pages whose content changed, i.e. where cascades start.
 * @param horizon The last page worth analysing for the sake of a cascade. A
 *                long document's pages are mostly full, so one added line can
 *                push a line off every page to the end of a chapter; there is
 *                no reason to read all of those for a reader looking at one.
 */
export function reflowDocument(
  flowOf: (page: number) => PageFlow | null,
  origins: number[],
  documentPages: number,
  horizon = Infinity,
): Reflow {
  const plans = new Map<number, PagePlan>();
  const missing: number[] = [];
  const deferred: number[] = [];
  let lastPage = documentPages;

  for (const origin of [...new Set(origins)].sort((a, b) => a - b)) {
    if (plans.has(origin)) continue;
    let carried: FlowRegion[] = [];
    for (let page = origin; page === origin || carried.length > 0; page++) {
      if (page > documentPages + MAX_APPENDED_PAGES) {
        throw new Error(`PDF reflow did not terminate: still carrying content at page ${page}`);
      }
      const flow = flowOf(page);
      if (!flow) {
        // The page that was edited is always wanted; what it pushes onto
        // later pages is wanted as far as the horizon.
        (page === origin || page <= horizon ? missing : deferred).push(page);
        break;
      }
      const { placements, overflow } = layoutPage(flow, carried);
      plans.set(page, { page, placements });
      lastPage = Math.max(lastPage, page);
      carried = overflow;
    }
  }

  return { plans, lastPage, missing, deferred };
}

/** One page: what stays on it, and what leaves for the next. */
export function layoutPage(
  flow: PageFlow,
  carried: FlowRegion[],
): { placements: Placement[]; overflow: FlowRegion[] } {
  const regions = joinCarried(carried, flow.regions);
  const placements: Placement[] = [];
  let cursor = flow.body.top + (carried.length > 0 ? 0 : flow.lead);

  for (let index = 0; index < regions.length; index++) {
    const region = regions[index];
    const top = index === 0 ? cursor : cursor + region.gapBefore;
    // A page must take at least one item, or a single item taller than the
    // body would be carried forever.
    const filled = fillRegion(region, flow.body.bottom - top, placements.length === 0);
    for (const placed of filled.placed) {
      const column = region.columns[placed.column];
      placements.push({
        item: placed.item,
        x: column.x,
        y: top + placed.offset,
        width: column.width,
      });
    }
    cursor = top + filled.height;
    if (filled.rest) {
      return { placements, overflow: [filled.rest, ...regions.slice(index + 1)] };
    }
  }

  return { placements, overflow: [] };
}

interface PlacedItem {
  item: FlowItem;
  column: number;
  /** Below the region's top. */
  offset: number;
}

/** Fill a region's columns in order, each taking what the one before it could
 *  not hold. What the last column cannot hold is the region's remainder. */
function fillRegion(
  region: FlowRegion,
  limit: number,
  mustPlaceFirst: boolean,
): { placed: PlacedItem[]; height: number; rest: FlowRegion | null } {
  const placed: PlacedItem[] = [];
  let displaced: FlowItem[] = [];
  let height = 0;

  region.columns.forEach((column, columnIndex) => {
    const items = displaced.length > 0 ? [...displaced, ...column.items] : column.items;
    let cursor = displaced.length > 0 ? 0 : column.lead;
    let taken = 0;
    for (; taken < items.length; taken++) {
      const item = items[taken];
      const itemTop = taken === 0 ? cursor : cursor + item.gapBefore;
      const forced = mustPlaceFirst && placed.length === 0;
      if (itemTop + item.height - item.trailing > limit + EPSILON && !forced) break;
      placed.push({ item, column: columnIndex, offset: itemTop });
      cursor = itemTop + item.height;
    }
    displaced = items.slice(taken);
    if (taken > 0) height = Math.max(height, cursor);
  });

  if (displaced.length === 0) return { placed, height, rest: null };
  return { placed, height, rest: tailRegion(region, displaced) };
}

/** What a region could not hold, as a region of the same shape whose first
 *  column carries it. */
function tailRegion(region: FlowRegion, items: FlowItem[]): FlowRegion {
  return {
    gapBefore: region.gapBefore,
    columns: region.columns.map((column, index) => ({
      ...column,
      lead: 0,
      items: index === 0 ? items : [],
    })),
  };
}

/** Put carried regions ahead of a page's own. A carried tail continues into
 *  the page's first region when the two are the same layout, so a line pushed
 *  off the foot of one page becomes the first line of the next rather than a
 *  block of its own above it. */
function joinCarried(carried: FlowRegion[], own: FlowRegion[]): FlowRegion[] {
  if (carried.length === 0) return own;
  const tail = carried[carried.length - 1];
  const first = own[0];
  if (!first || !isTail(tail) || !sameShape(tail, first)) return [...carried, ...own];

  const joined: FlowRegion = {
    gapBefore: tail.gapBefore,
    columns: first.columns.map((column, index) =>
      index === 0
        ? { ...column, lead: 0, items: [...tail.columns[0].items, ...column.items] }
        : column,
    ),
  };
  return [...carried.slice(0, -1), joined, ...own.slice(1)];
}

function isTail(region: FlowRegion): boolean {
  return region.columns.every((column, index) => index === 0 || column.items.length === 0);
}

function sameShape(a: FlowRegion, b: FlowRegion): boolean {
  if (a.columns.length !== b.columns.length) return false;
  // Two single columns are the same layout whatever their measured widths: a
  // page of short lines measures narrower than a page of full ones.
  if (a.columns.length === 1) return true;
  return a.columns.every(
    (column, index) => Math.abs(column.width - b.columns[index].width) <= SHAPE_TOLERANCE,
  );
}
