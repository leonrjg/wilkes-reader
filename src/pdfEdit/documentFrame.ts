import type { BoundingBox } from "../documentCoordinates.js";
import type { BodyFrame, FlowColumn, FlowItem, FlowRegion, PageFlow } from "./flow.js";
import { median, type LayoutRegion, type PageLayout } from "./pageLayout.js";

/**
 * What only several pages together can say about each one: which edge groups
 * are running heads and page numbers, and how far down a page content may go.
 *
 * Both are needed before a page can reflow. A running head must stay put while
 * the lines under it move; and a page that ends short -- the last of a chapter
 * -- has room below its last line that its own ink gives no measure of.
 *
 * The answers firm up as more pages are analysed, so this is recomputed from
 * every layout known so far rather than fixed at the first page.
 */
export interface DocumentFrame {
  /** Null until some page has content. */
  body: BodyFrame | null;
  isFurniture: (page: number, role: "head" | "foot") => boolean;
}

/** How closely two pages' edge groups must line up to be the same furniture. */
const FURNITURE_ALIGNMENT = 4;
/** Kept clear around a fixed area, so a line is not set against it. */
const FIXED_MARGIN = 0.5;

export function resolveDocumentFrame(layouts: ReadonlyMap<number, PageLayout>): DocumentFrame {
  const heads = edgePositions(layouts, "head");
  const feet = edgePositions(layouts, "foot");
  const furniture = {
    head: recurring(heads, layouts.size),
    foot: recurring(feet, layouts.size),
  };
  const isFurniture = (page: number, role: "head" | "foot") => furniture[role].has(page);

  let body: BodyFrame | null = null;
  for (const [page, layout] of layouts) {
    const regions = bodyRegions(layout, page, isFurniture);
    if (regions.length === 0) continue;
    const top = regions[0].top;
    const bottom = regions[regions.length - 1].bottom;
    body = body
      ? { top: Math.min(body.top, top), bottom: Math.max(body.bottom, bottom) }
      : { top, bottom };
  }
  return { body, isFurniture };
}

/** Where each page's candidate group meets the body: a head's foot, a foot's head. */
function edgePositions(
  layouts: ReadonlyMap<number, PageLayout>,
  role: "head" | "foot",
): Map<number, number> {
  const positions = new Map<number, number>();
  for (const [page, layout] of layouts) {
    const region = layout.regions.find((candidate) => candidate.role === role);
    if (region) positions.set(page, role === "head" ? region.bottom : region.top);
  }
  return positions;
}

/** The pages whose candidate sits where enough other pages have one too. A
 *  chapter title is isolated at the head of its page as well, but no other
 *  page has anything isolated at that height. */
function recurring(positions: Map<number, number>, analysedPages: number): Set<number> {
  const needed = Math.max(1, Math.floor((analysedPages - 1) / 2));
  const pages = new Set<number>();
  for (const [page, position] of positions) {
    let agreeing = 0;
    for (const [other, otherPosition] of positions) {
      if (other !== page && Math.abs(otherPosition - position) <= FURNITURE_ALIGNMENT) agreeing++;
    }
    if (agreeing >= needed) pages.add(page);
  }
  return pages;
}

function bodyRegions(
  layout: PageLayout,
  page: number,
  isFurniture: DocumentFrame["isFurniture"],
): LayoutRegion[] {
  return layout.regions.filter(
    (region) => region.role === "body" || !isFurniture(page, region.role),
  );
}

/** A page as the reflow engine takes it: its body regions as flowing items,
 *  its furniture as fixed areas. */
export function buildPageFlow(page: number, layout: PageLayout, frame: DocumentFrame): PageFlow {
  const fixed: BoundingBox[] = [];
  const regions: FlowRegion[] = [];
  let previous: LayoutRegion | null = null;
  let first: LayoutRegion | null = null;
  let headLimit = 0;
  let footLimit = layout.height;

  for (const [regionIndex, region] of layout.regions.entries()) {
    if (region.role !== "body" && frame.isFurniture(page, region.role)) {
      if (region.role === "head") {
        headLimit = region.bottom + FIXED_MARGIN;
        fixed.push({ x: 0, y: 0, width: layout.width, height: headLimit });
      } else {
        footLimit = region.top - FIXED_MARGIN;
        fixed.push({ x: 0, y: footLimit, width: layout.width, height: layout.height - footLimit });
      }
      continue;
    }
    regions.push({
      gapBefore: previous ? region.top - previous.bottom : layout.lineGap,
      columns: region.columns.map((column, columnIndex) =>
        flowColumn(page, `${page}:${regionIndex}:${columnIndex}`, region, column, layout.lineGap),
      ),
    });
    first ??= region;
    previous = region;
  }

  const ownTop = first?.top;
  const ownBottom = previous?.bottom;
  const shared = frame.body ?? { top: layout.height * 0.1, bottom: layout.height * 0.9 };
  // The shared frame, kept off this page's own furniture and never tighter
  // than this page's own content: a page always holds what it already held.
  const body: BodyFrame = {
    top: Math.min(ownTop ?? Infinity, Math.max(shared.top, headLimit)),
    bottom: Math.max(ownBottom ?? -Infinity, Math.min(shared.bottom, footLimit)),
  };

  return {
    page,
    width: layout.width,
    height: layout.height,
    body,
    lead: ownTop === undefined ? 0 : ownTop - body.top,
    regions,
    fixed,
    background: layout.background,
  };
}

function flowColumn(
  page: number,
  idPrefix: string,
  region: LayoutRegion,
  column: LayoutRegion["columns"][number],
  lineGap: number,
): FlowColumn {
  const gaps = column.bands.slice(1).map((band, index) => band.top - column.bands[index].bottom);
  // A column's first item has no gap of its own on the page it was read from;
  // it needs one the moment something is pushed in ahead of it.
  const typicalGap = gaps.length > 0 ? median(gaps) : lineGap;
  const items: FlowItem[] = column.bands.map((band, index) => ({
    id: `${idPrefix}:${index}`,
    height: band.bottom - band.top,
    gapBefore: index === 0 ? typicalGap : gaps[index - 1],
    trailing: 0,
    content: {
      kind: "slice",
      page,
      rect: { x: column.x, y: band.top, width: column.width, height: band.bottom - band.top },
    },
  }));
  return {
    x: column.x,
    width: column.width,
    lead: column.bands.length > 0 ? column.bands[0].top - region.top : 0,
    items,
  };
}

/** A page past the document's end, there to take what the last page could not. */
export function blankPageFlow(
  page: number,
  size: { width: number; height: number },
  body: BodyFrame,
  background: string,
): PageFlow {
  return { page, ...size, body, lead: 0, regions: [], fixed: [], background };
}
