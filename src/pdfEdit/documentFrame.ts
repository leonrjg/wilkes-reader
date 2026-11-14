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
 * It is asked of a page and its neighbours, not of every page read so far:
 * the answer for a page must be the same whenever it is asked, or the page
 * would be laid out one way before the reader scrolled on and another after.
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
/** Columns of one text differ in width by no more than this share of the
 *  widest: they were set to one measure, and what differs is how far their
 *  longest lines happen to reach. */
const ALIKE_WIDTHS = 0.15;
/** And are each at least this many of their lines' heights wide. */
const PROSE_WIDTH_LINES = 10;

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
export function buildPageFlow(
  page: number,
  layout: PageLayout,
  frame: DocumentFrame,
  /** Areas of this page the host knows are not prose: formulas, tables. */
  locked: readonly BoundingBox[] = [],
): PageFlow {
  const fixed: BoundingBox[] = [];
  const flowing: Array<{ region: LayoutRegion; index: number }> = [];
  let headLimit = 0;
  let footLimit = layout.height;

  for (const [index, region] of layout.regions.entries()) {
    if (region.role === "body" || !frame.isFurniture(page, region.role)) {
      flowing.push({ region, index });
    } else if (region.role === "head") {
      headLimit = region.bottom + FIXED_MARGIN;
      fixed.push({ x: 0, y: 0, width: layout.width, height: headLimit });
    } else {
      footLimit = region.top - FIXED_MARGIN;
      fixed.push({ x: 0, y: footLimit, width: layout.width, height: layout.height - footLimit });
    }
  }

  const ownTop = flowing[0]?.region.top;
  const ownBottom = flowing[flowing.length - 1]?.region.bottom;
  const shared = frame.body ?? { top: layout.height * 0.1, bottom: layout.height * 0.9 };
  // The shared frame, kept off this page's own furniture and never tighter
  // than this page's own content: a page always holds what it already held.
  const body: BodyFrame = {
    top: Math.min(ownTop ?? Infinity, Math.max(shared.top, headLimit)),
    bottom: Math.max(ownBottom ?? -Infinity, Math.min(shared.bottom, footLimit)),
  };

  const regions: FlowRegion[] = flowing.map(({ region, index }, position) => {
    const previous = flowing[position - 1]?.region;
    // Every region but the last stops where the one under it starts; the last
    // could have run to the foot of the body.
    const last = position === flowing.length - 1;
    const stop = last ? body.bottom : region.bottom;
    return {
      gapBefore: previous ? region.top - previous.bottom : layout.lineGap,
      depth: last ? null : region.bottom - region.top,
      columns: region.columns.map((column, columnIndex) =>
        flowColumn(page, `${page}:${index}:${columnIndex}`, region, column, layout.lineGap, locked, stop),
      ),
      ...(standApart(region) ? { apart: true as const } : {}),
    };
  });

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

/** Whether a region's columns stand side by side rather than being one text
 *  read down each in turn. Columns of one text are set alike -- as wide as
 *  each other -- and wide enough to set prose in. A note beside the text is
 *  narrower than the text; a label, an answer, a table's cells are too narrow
 *  for a sentence. Taking those for a text's columns pours one into the next
 *  as soon as either grows. */
function standApart(region: LayoutRegion): boolean {
  if (region.columns.length < 2) return false;
  const widths = region.columns.map((column) => column.width);
  const widest = Math.max(...widths);
  const narrowest = Math.min(...widths);
  const lineHeight = median(
    region.columns.flatMap((column) => column.bands.map((band) => band.bottom - band.top)),
  );
  return widest - narrowest > ALIKE_WIDTHS * widest || narrowest < PROSE_WIDTH_LINES * lineHeight;
}

function flowColumn(
  page: number,
  idPrefix: string,
  region: LayoutRegion,
  column: LayoutRegion["columns"][number],
  lineGap: number,
  locked: readonly BoundingBox[],
  /** How far down the page the column could have run. */
  stop: number,
): FlowColumn {
  const pieces = lockedTogether(column, locked);
  const gaps = pieces.slice(1).map((piece, index) => piece.top - pieces[index].bottom);
  // A column's first item has no gap of its own on the page it was read from;
  // it needs one the moment something is pushed in ahead of it.
  const typicalGap = gaps.length > 0 ? median(gaps) : lineGap;
  const items: FlowItem[] = pieces.map((piece, index) => ({
    id: `${idPrefix}:${piece.firstBand}`,
    height: piece.bottom - piece.top,
    gapBefore: index === 0 ? typicalGap : gaps[index - 1],
    leading: 0,
    trailing: 0,
    content: {
      kind: "slice",
      page,
      rect: { x: column.x, y: piece.top, width: column.width, height: piece.bottom - piece.top },
      ...(piece.locked ? { locked: true } : {}),
    },
  }));
  return {
    x: column.x,
    width: column.width,
    lead: pieces.length > 0 ? pieces[0].top - region.top : 0,
    items,
    room: stop - (pieces[pieces.length - 1]?.bottom ?? region.top),
    opens: items.length > 0 ? items[0].gapBefore + items[0].height : 0,
  };
}

interface Piece {
  top: number;
  bottom: number;
  /** The band it starts at, which is what its id is taken from: an id must not
   *  change because a neighbour was found to belong to a formula. */
  firstBand: number;
  locked: boolean;
}

/** A column's bands as the pieces that move: one each, except that the bands a
 *  locked area covers are one piece together. A formula is several rows of
 *  ink -- a numerator, a bar, a denominator -- and a page break between two of
 *  them would be a break through the middle of it. */
function lockedTogether(
  column: LayoutRegion["columns"][number],
  locked: readonly BoundingBox[],
): Piece[] {
  const areaOf = (band: { top: number; bottom: number }) =>
    locked.findIndex((area) => {
      const overlap =
        Math.min(band.bottom, area.y + area.height) - Math.max(band.top, area.y);
      const beside = area.x < column.x + column.width && area.x + area.width > column.x;
      return beside && overlap > (band.bottom - band.top) / 2;
    });

  const pieces: Piece[] = [];
  let previousArea = -1;
  column.bands.forEach((band, index) => {
    const area = areaOf(band);
    const last = pieces[pieces.length - 1];
    if (area >= 0 && area === previousArea && last) {
      last.bottom = band.bottom;
    } else {
      pieces.push({ top: band.top, bottom: band.bottom, firstBand: index, locked: area >= 0 });
    }
    previousArea = area;
  });
  return pieces;
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
