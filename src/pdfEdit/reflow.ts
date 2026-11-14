import type { FlowColumn, FlowItem, FlowRegion, PageFlow, Placement } from "./flow.js";

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
 *   4. A column that ends with room to spare takes the items that follow it --
 *      from the next column, or from the head of the next page -- but only
 *      over a break the file made for want of room: one where the item after
 *      it would not have fit under the item before. A break the file made with
 *      room to spare was put there on purpose -- the end of a chapter, a
 *      balanced pair of columns -- and nothing is taken back across it.
 *   5. What is taken back never makes a region taller than the file made it.
 *   6. A page that starts lower than its body does is the start of something
 *      -- a chapter. What is pushed onto it goes into the room above its
 *      opening, and the opening stays where the file put it until that room
 *      is used up.
 *   7. Columns that stand side by side rather than being one text -- a note
 *      beside the text, the cells of a table -- are each their own: rules 2
 *      and 4 do not pass anything between them. What one cannot hold goes to
 *      the next page in its own column.
 *
 * Laying out a page nothing was pushed onto or taken from, whose content did
 * not change, returns every item to where the file drew it: a full column has
 * no room for the item after it, and that is the only thing rule 4 would give
 * it. That identity is what lets an untouched page be drawn straight from its
 * raster.
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
    // How many items at the head of this page the page before it took.
    let taken = 0;
    for (let page = origin; page === origin || carried.length > 0 || taken > 0; page++) {
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
      const own = taken > 0 ? withoutHead(flow.regions, taken) : flow.regions;
      let laid = layoutPage(flow, carried, own);
      taken = 0;
      // A page that ends with more room than the file left it would take the
      // head of the next -- if that is known, and if the break is one to cross.
      if (laid.foot && page < documentPages) {
        const next = flowOf(page + 1);
        if (!next) {
          (page + 1 <= horizon ? missing : deferred).push(page + 1);
        } else {
          const head = headOf(next, laid.foot);
          if (head.length > 0) {
            laid = layoutPage(flow, carried, own, head);
            taken = laid.taken;
          }
        }
      }
      plans.set(page, { page, placements: laid.placements });
      lastPage = Math.max(lastPage, page);
      carried = laid.overflow;
    }
  }

  return { plans, lastPage, missing, deferred };
}

/** A page's regions without the first `count` items of its first column. */
function withoutHead(regions: FlowRegion[], count: number): FlowRegion[] {
  const [first, ...rest] = regions;
  if (!first) return regions;
  const columns = first.columns.map((column, index) =>
    index === 0 ? { ...column, items: column.items.slice(count) } : column,
  );
  return [{ ...first, columns }, ...rest];
}

/** The items at the head of a page that the foot of the page before it may
 *  take: those of its first column, when that column continues the one the
 *  page before ended in. */
function headOf(next: PageFlow, foot: FlowRegion): FlowItem[] {
  const first = next.regions[0];
  const column = first?.columns[0];
  const opening = column?.items[0];
  if (!first || !column || !opening || !sameShape(foot, first)) return [];
  if (startsLow(next)) return [];
  return runsOn(foot.columns[foot.columns.length - 1], column) ? column.items : [];
}

/** Whether a page starts lower than its body does: the start of something. */
function startsLow(flow: PageFlow): boolean {
  const opening = flow.regions[0]?.columns[0]?.items[0];
  return opening !== undefined && flow.lead > opening.height;
}

/** Whether the file broke between two columns for want of room: the second's
 *  first item would not have fit under the first's last. */
function runsOn(column: FlowColumn, next: FlowColumn): boolean {
  return next.opens > column.room + EPSILON;
}

export interface PageLayoutResult {
  placements: Placement[];
  /** What the page could not hold, for the next. */
  overflow: FlowRegion[];
  /** How many of the items offered from the next page it took. */
  taken: number;
  /** The page's own last region, when its last column ended with more room
   *  than the file left it: the page would take more. Null otherwise. */
  foot: FlowRegion | null;
}

/**
 * One page: what stays on it, and what leaves for the next.
 *
 * @param carried   What the page before could not hold.
 * @param own       The page's regions, less whatever the page before took.
 * @param following Items at the head of the next page that this one's foot
 *                  may take, in order.
 */
export function layoutPage(
  flow: PageFlow,
  carried: FlowRegion[],
  own: FlowRegion[] = flow.regions,
  following: FlowItem[] = [],
): PageLayoutResult {
  // A region emptied by the page before is not there to be laid out.
  const present = own.filter(hasItems);
  // Onto a page that starts low, what is carried goes above its opening and
  // is not run into it: the opening keeps its place while there is room.
  const opensLow = carried.length > 0 && present.length > 0 && startsLow(flow);
  const regions = opensLow ? [...carried, ...present] : joinCarried(carried, present);
  const opening = opensLow ? carried.length : -1;
  const endsInOwn = own.length > 0 && hasItems(own[own.length - 1]);
  const placements: Placement[] = [];
  let cursor = flow.body.top + (carried.length > 0 ? 0 : flow.lead);
  let taken = 0;
  let foot: FlowRegion | null = null;

  for (let index = 0; index < regions.length; index++) {
    const region = regions[index];
    const below = index === 0 ? cursor : cursor + region.gapBefore;
    const top = index === opening ? Math.max(below, flow.body.top + flow.lead) : below;
    const isFoot = endsInOwn && index === regions.length - 1;
    // A page must take at least one item, or a single item taller than the
    // body would be carried forever.
    const filled = fillRegion(
      region,
      flow.body.bottom - top,
      placements.length === 0,
      isFoot ? following : [],
    );
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
      return { placements, overflow: [filled.rest, ...regions.slice(index + 1)], taken: 0, foot: null };
    }
    if (isFoot) {
      taken = filled.taken;
      const last = region.columns[region.columns.length - 1];
      if (filled.spare > last.room + EPSILON) foot = region;
    }
  }

  return { placements, overflow: [], taken, foot };
}

const hasItems = (region: FlowRegion) => region.columns.some((column) => column.items.length > 0);

interface PlacedItem {
  item: FlowItem;
  column: number;
  /** Below the region's top. */
  offset: number;
}

/**
 * Fill a region's columns in order. Each takes what the one before it could
 * not hold, then its own; one that still has room takes what follows it, over
 * a break the file made for want of room. What the last column cannot hold is
 * the region's remainder.
 *
 * @param following What the last column may take once it has room: the head
 *                  of the next page.
 */
function fillRegion(
  region: FlowRegion,
  limit: number,
  mustPlaceFirst: boolean,
  following: FlowItem[],
): { placed: PlacedItem[]; height: number; rest: FlowRegion | null; taken: number; spare: number } {
  if (region.apart) return fillApart(region, limit, mustPlaceFirst);
  const placed: PlacedItem[] = [];
  // What each column still holds: a column can lose its head to the one before.
  const waiting = region.columns.map((column) => column.items);
  // What is taken back never makes the region taller than the file made it.
  const refillLimit = Math.min(limit, region.depth ?? Infinity);
  let displaced: FlowItem[] = [];
  let height = 0;
  let taken = 0;
  let spare = 0;

  region.columns.forEach((column, columnIndex) => {
    const items = displaced.length > 0 ? [...displaced, ...waiting[columnIndex]] : waiting[columnIndex];
    // Where the ink of the column's first item goes, then the foot of the
    // last item placed.
    let cursor = displaced.length > 0 ? 0 : column.lead;
    let above: FlowItem | null = null;
    const place = (item: FlowItem, within: number, forced: boolean): boolean => {
      const itemTop = above ? cursor - above.trailing + item.gapBefore : cursor - item.leading;
      if (itemTop + item.height - item.trailing > within + EPSILON && !forced) return false;
      placed.push({ item, column: columnIndex, offset: itemTop });
      cursor = itemTop + item.height;
      above = item;
      return true;
    };
    /** Where the column's ink ends. */
    const foot = () => cursor - (above?.trailing ?? 0);

    let own = 0;
    while (own < items.length && place(items[own], limit, mustPlaceFirst && placed.length === 0)) own++;
    displaced = items.slice(own);

    if (displaced.length === 0) {
      const next = region.columns[columnIndex + 1];
      if (!next) {
        while (taken < following.length && place(following[taken], refillLimit, false)) taken++;
        spare = refillLimit - foot();
      } else if (runsOn(column, next)) {
        const source = waiting[columnIndex + 1];
        let pulled = 0;
        while (pulled < source.length && place(source[pulled], refillLimit, false)) pulled++;
        waiting[columnIndex + 1] = source.slice(pulled);
      }
    }
    if (above) height = Math.max(height, foot());
  });

  if (displaced.length === 0) return { placed, height, rest: null, taken, spare };
  return { placed, height, rest: tailRegion(region, displaced), taken: 0, spare: 0 };
}

/** Fill columns that stand side by side: each holds what of its own fits,
 *  and the rest of each is the region's remainder, still in its column. */
function fillApart(
  region: FlowRegion,
  limit: number,
  mustPlaceFirst: boolean,
): { placed: PlacedItem[]; height: number; rest: FlowRegion | null; taken: number; spare: number } {
  const placed: PlacedItem[] = [];
  let height = 0;
  const left = region.columns.map((column, columnIndex) => {
    let cursor = column.lead;
    let above: FlowItem | null = null;
    let held = 0;
    for (const item of column.items) {
      const itemTop: number = above ? cursor - above.trailing + item.gapBefore : cursor - item.leading;
      const forced = mustPlaceFirst && placed.length === 0;
      if (itemTop + item.height - item.trailing > limit + EPSILON && !forced) break;
      placed.push({ item, column: columnIndex, offset: itemTop });
      cursor = itemTop + item.height;
      above = item;
      held++;
    }
    if (above) height = Math.max(height, cursor - (above as FlowItem).trailing);
    return column.items.slice(held);
  });
  if (left.every((items) => items.length === 0)) return { placed, height, rest: null, taken: 0, spare: 0 };
  const rest: FlowRegion = {
    ...region,
    columns: region.columns.map((column, index) => ({ ...column, lead: 0, items: left[index] })),
  };
  return { placed, height, rest, taken: 0, spare: 0 };
}

/** What a region could not hold, as a region of the same shape whose first
 *  column carries it. */
function tailRegion(region: FlowRegion, items: FlowItem[]): FlowRegion {
  return {
    gapBefore: region.gapBefore,
    depth: region.depth,
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
  if (!first || !sameShape(tail, first) || tail.apart !== first.apart) return [...carried, ...own];
  if (tail.apart) {
    // Side by side, each column goes on from what was carried in it.
    const joined: FlowRegion = {
      ...first,
      gapBefore: tail.gapBefore,
      columns: first.columns.map((column, index) => {
        const ahead = tail.columns[index].items;
        return ahead.length > 0 ? { ...column, lead: 0, items: [...ahead, ...column.items] } : column;
      }),
    };
    return [...carried.slice(0, -1), joined, ...own.slice(1)];
  }
  if (!isTail(tail)) return [...carried, ...own];

  const joined: FlowRegion = {
    gapBefore: tail.gapBefore,
    depth: first.depth,
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
