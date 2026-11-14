import { blankColumnRuns, inkExtent, inkRowRuns, type InkGrid, type Run } from "./inkGrid.js";

/**
 * A page's geometry, read off its ink: which rows are lines, and where the
 * page sets them in columns.
 *
 * This is the classic projection-profile cut. A row with no ink across the
 * whole page separates two bands; a strip with no ink down a run of bands is a
 * gutter between columns. It needs no text layer, so it segments a scanned
 * page, a figure and a typeset formula on the same terms as prose.
 *
 * What it reports is geometry only. Whether a band at the head of the page is
 * a running head is not something one page can know -- a chapter title looks
 * the same -- so bands that *could* be are set apart here and decided across
 * pages, in `documentFrame`.
 */

/** A horizontal band of ink, in page units. */
export interface Band {
  top: number;
  bottom: number;
}

export interface LayoutColumn {
  x: number;
  width: number;
  bands: Band[];
}

/** `head` and `foot` mark an isolated group at the page's edge: a candidate
 *  for a running head or a page number, not yet a decision that it is one. */
export type RegionRole = "body" | "head" | "foot";

export interface LayoutRegion {
  role: RegionRole;
  top: number;
  bottom: number;
  columns: LayoutColumn[];
}

export interface PageLayout {
  width: number;
  height: number;
  /** The paper's colour, as CSS. */
  background: string;
  /** The typical space between two lines of a column. */
  lineGap: number;
  regions: LayoutRegion[];
}

/** The narrowest blank strip that separates columns, in page units. Wider than
 *  any space between words, narrower than any gutter worth the name. */
const MIN_GUTTER = 9;
/** Columns shorter than this are not a layout: they are one line with a wide
 *  gap in it, or a small table. */
const MIN_COLUMNS_HEIGHT = 48;
/** An edge group stands apart when the gap inside it is this many typical band
 *  heights... */
const FURNITURE_GAP = 1.2;
/** ...and it is no taller than this many, in at most this many bands. */
const FURNITURE_MAX_HEIGHT = 3;
const FURNITURE_MAX_BANDS = 3;

export function layoutFromInk(grid: InkGrid): PageLayout {
  const scale = grid.cellsPerUnit;
  const [red, green, blue] = grid.background;
  const page = {
    width: grid.width / scale,
    height: grid.height / scale,
    background: `rgb(${red}, ${green}, ${blue})`,
  };

  const rows = inkRowRuns(grid, 0, grid.width, 0, grid.height);
  if (rows.length === 0) return { ...page, lineGap: 0, regions: [] };

  const bandHeight = median(rows.map((row) => row.end - row.start));
  const headCount = edgeGroup(rows, bandHeight);
  const footCount = edgeGroup([...rows.slice(headCount)].reverse(), bandHeight);
  const bodyRows = rows.slice(headCount, rows.length - footCount);

  const cells: CellRegion[] = [];
  if (headCount > 0) cells.push(marginRegion("head", rows.slice(0, headCount), grid.width));
  cells.push(...bodyRegions(grid, bodyRows));
  if (footCount > 0) {
    cells.push(marginRegion("foot", rows.slice(rows.length - footCount), grid.width));
  }

  const gaps = cells
    .filter((region) => region.role === "body")
    .flatMap((region) => region.columns)
    .flatMap((column) => column.bands.slice(1).map((band, i) => band.start - column.bands[i].end));

  return {
    ...page,
    lineGap: (gaps.length > 0 ? median(gaps) : bandHeight * 0.3) / scale,
    regions: cells.map((region) => ({
      role: region.role,
      top: region.top / scale,
      bottom: region.bottom / scale,
      columns: region.columns.map((column) => ({
        x: column.start / scale,
        width: (column.end - column.start) / scale,
        bands: column.bands.map((band) => ({ top: band.start / scale, bottom: band.end / scale })),
      })),
    })),
  };
}

/** A region still in grid cells. */
interface CellRegion {
  role: RegionRole;
  top: number;
  bottom: number;
  columns: Array<Run & { bands: Run[] }>;
}

/** How many leading rows form a short group set apart from the rest, or 0. */
function edgeGroup(rows: Run[], bandHeight: number): number {
  const edge = rows[0];
  for (let count = 1; count <= FURNITURE_MAX_BANDS && count < rows.length; count++) {
    const inner = rows[count - 1];
    const next = rows[count];
    // `rows` may be reversed (for the foot), so neither measurement assumes
    // which of two rows is the higher.
    const groupHeight = Math.max(edge.end, inner.end) - Math.min(edge.start, inner.start);
    if (groupHeight > FURNITURE_MAX_HEIGHT * bandHeight) return 0;
    const gap = Math.max(next.start - inner.end, inner.start - next.end);
    if (gap >= FURNITURE_GAP * bandHeight) return count;
  }
  return 0;
}

function marginRegion(role: RegionRole, rows: Run[], pageWidth: number): CellRegion {
  return {
    role,
    top: rows[0].start,
    bottom: rows[rows.length - 1].end,
    columns: [{ start: 0, end: pageWidth, bands: rows }],
  };
}

/** Cut the body's rows into regions: runs of rows that share a gutter become a
 *  set of columns, and the rows between them are single columns. */
function bodyRegions(grid: InkGrid, rows: Run[]): CellRegion[] {
  if (rows.length === 0) return [];
  const extent = inkExtent(grid, 0, grid.width, rows[0].start, rows[rows.length - 1].end);
  if (!extent) return [];

  const minGutter = MIN_GUTTER * grid.cellsPerUnit;
  const minHeight = MIN_COLUMNS_HEIGHT * grid.cellsPerUnit;
  const regions: CellRegion[] = [];
  let single: Run[] = [];
  const flushSingle = () => {
    if (single.length === 0) return;
    regions.push({
      role: "body",
      top: single[0].start,
      bottom: single[single.length - 1].end,
      columns: [{ ...extent, bands: single }],
    });
    single = [];
  };

  for (let index = 0; index < rows.length; ) {
    const span = guttersFrom(grid, rows, index, extent, minGutter);
    const top = rows[index].start;
    if (span && rows[span.end - 1].end - top >= minHeight) {
      // A span starts at the first row with ink on both sides of a gutter, but
      // one column can start higher than the other. Rows just above that keep
      // every gutter clear are the head of a column, not content above both.
      let regionTop = top;
      while (single.length > 0 && clearOf(grid, single[single.length - 1], span.gutters)) {
        regionTop = single.pop()!.start;
      }
      flushSingle();
      regions.push(columnRegion(grid, regionTop, rows[span.end - 1].end, extent, span.gutters));
      index = span.end;
    } else {
      single.push(rows[index]);
      index++;
    }
  }
  flushSingle();
  return regions;
}

/** The longest run of rows from `from` that all leave some gutter blank. */
function guttersFrom(
  grid: InkGrid,
  rows: Run[],
  from: number,
  extent: Run,
  minGutter: number,
): { end: number; gutters: Run[] } | null {
  const wide = (run: Run) => run.end - run.start >= minGutter;
  const first = rows[from];
  // A gutter has ink on both sides of it, so it is looked for inside the first
  // row's own ink: the blank beside a short line is not one.
  const own = inkExtent(grid, extent.start, extent.end, first.start, first.end);
  if (!own) return null;
  let gutters = blankColumnRuns(grid, own.start, own.end, first.start, first.end).filter(wide);
  if (gutters.length === 0) return null;

  let end = from + 1;
  for (; end < rows.length; end++) {
    const blank = blankColumnRuns(grid, extent.start, extent.end, rows[end].start, rows[end].end);
    const kept = intersectRuns(gutters, blank).filter(wide);
    if (kept.length === 0) break;
    gutters = kept;
  }
  return { end, gutters };
}

function clearOf(grid: InkGrid, row: Run, gutters: Run[]): boolean {
  return gutters.every(
    (gutter) => inkExtent(grid, gutter.start, gutter.end, row.start, row.end) === null,
  );
}

function columnRegion(grid: InkGrid, top: number, bottom: number, extent: Run, gutters: Run[]): CellRegion {
  const edges = [extent.start, ...gutters.flatMap((gutter) => [gutter.start, gutter.end]), extent.end];
  const columns: CellRegion["columns"] = [];
  for (let index = 0; index < edges.length; index += 2) {
    // Tightened to the column's own ink, so its left edge is where its text
    // starts rather than where the gutter was measured to end.
    const own = inkExtent(grid, edges[index], edges[index + 1], top, bottom);
    if (!own) continue;
    columns.push({ ...own, bands: inkRowRuns(grid, own.start, own.end, top, bottom) });
  }
  return { role: "body", top, bottom, columns };
}

function intersectRuns(a: Run[], b: Run[]): Run[] {
  const result: Run[] = [];
  for (const left of a) {
    for (const right of b) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (start < end) result.push({ start, end });
    }
  }
  return result;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
