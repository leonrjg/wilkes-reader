/**
 * Where a rendered page has anything on it.
 *
 * Reflow moves whatever the page drew, and most of what a page draws is not
 * text the file can describe: a figure is paths, a scanned formula is pixels,
 * a rule is one stroke. The raster is the one account of the page that covers
 * all of it, so the layout is read from the raster, reduced here to a single
 * bit per pixel: paper, or not paper.
 */
export interface InkGrid {
  width: number;
  height: number;
  /** Grid cells per page unit, on both axes. */
  cellsPerUnit: number;
  /** Row-major, one byte per cell: 1 where the page is not bare paper. */
  ink: Uint8Array;
  /** The paper's colour. */
  background: [number, number, number];
}

/** A half-open run of rows or columns, in cells. */
export interface Run {
  start: number;
  end: number;
}

/** How far a channel may sit from the paper's and still be paper. Low, because
 *  a faint rule or a pale tint that reads as paper here is not carried when the
 *  content around it moves. */
const PAPER_TOLERANCE = 12;

interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function inkGridFromImage(image: RgbaImage, cellsPerUnit: number): InkGrid {
  const { data, width, height } = image;
  const background = paperColour(image);
  const ink = new Uint8Array(width * height);
  for (let cell = 0, offset = 0; cell < ink.length; cell++, offset += 4) {
    if (
      Math.abs(data[offset] - background[0]) > PAPER_TOLERANCE ||
      Math.abs(data[offset + 1] - background[1]) > PAPER_TOLERANCE ||
      Math.abs(data[offset + 2] - background[2]) > PAPER_TOLERANCE
    ) {
      ink[cell] = 1;
    }
  }
  return { width, height, cellsPerUnit, ink, background };
}

/** The colour most of the page's edge is: a page's border is its margin. */
function paperColour({ data, width, height }: RgbaImage): [number, number, number] {
  const counts = new Map<number, number>();
  const sample = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    const key = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const stepX = Math.max(1, Math.floor(width / 64));
  const stepY = Math.max(1, Math.floor(height / 64));
  for (let x = 0; x < width; x += stepX) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += stepY) {
    sample(0, y);
    sample(width - 1, y);
  }
  let best = 0xffffff;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return [(best >> 16) & 0xff, (best >> 8) & 0xff, best & 0xff];
}

function rowHasInk(grid: InkGrid, y: number, x0: number, x1: number): boolean {
  const base = y * grid.width;
  for (let x = x0; x < x1; x++) if (grid.ink[base + x]) return true;
  return false;
}

/** Maximal runs of rows that hold ink somewhere in `[x0, x1)`. */
export function inkRowRuns(grid: InkGrid, x0: number, x1: number, y0: number, y1: number): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let y = y0; y < y1; y++) {
    const has = rowHasInk(grid, y, x0, x1);
    if (has && start < 0) start = y;
    if (!has && start >= 0) {
      runs.push({ start, end: y });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, end: y1 });
  return runs;
}

/** Maximal runs of columns in `[x0, x1)` that hold no ink in rows `[y0, y1)`. */
export function blankColumnRuns(
  grid: InkGrid,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Run[] {
  const occupied = new Uint8Array(x1 - x0);
  for (let y = y0; y < y1; y++) {
    const base = y * grid.width;
    for (let x = x0; x < x1; x++) if (grid.ink[base + x]) occupied[x - x0] = 1;
  }
  const runs: Run[] = [];
  let start = -1;
  for (let index = 0; index < occupied.length; index++) {
    if (!occupied[index] && start < 0) start = index;
    if (occupied[index] && start >= 0) {
      runs.push({ start: x0 + start, end: x0 + index });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start: x0 + start, end: x1 });
  return runs;
}

/** The horizontal extent of the ink in rows `[y0, y1)`, or null if there is none. */
export function inkExtent(grid: InkGrid, x0: number, x1: number, y0: number, y1: number): Run | null {
  const blank = blankColumnRuns(grid, x0, x1, y0, y1);
  const start = blank.length > 0 && blank[0].start === x0 ? blank[0].end : x0;
  const last = blank[blank.length - 1];
  const end = last && last.end === x1 ? last.start : x1;
  return start < end ? { start, end } : null;
}
