import { describe, expect, it } from "vitest";
import { buildPageFlow, resolveDocumentFrame } from "./documentFrame.js";
import { inkGridFromImage } from "./inkGrid.js";
import { layoutFromInk, type PageLayout } from "./pageLayout.js";

const WIDTH = 300;
const HEIGHT = 400;

/** A white page with black rectangles on it, one cell per page unit. */
function pageWith(rects: Array<[x: number, y: number, width: number, height: number]>) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
  for (const [x, y, width, height] of rects) {
    for (let row = y; row < y + height; row++) {
      for (let col = x; col < x + width; col++) {
        data.fill(0, (row * WIDTH + col) * 4, (row * WIDTH + col) * 4 + 3);
      }
    }
  }
  return layoutFromInk(inkGridFromImage({ data, width: WIDTH, height: HEIGHT }, 1));
}

/** `count` full lines, 8 tall and 4 apart, from `top`. */
function lines(x: number, width: number, top: number, count: number) {
  return Array.from({ length: count }, (_, index) => [x, top + index * 12, width, 8] as [number, number, number, number]);
}

describe("layoutFromInk", () => {
  it("reads a column of lines as bands", () => {
    const layout = pageWith(lines(40, 220, 60, 5));
    expect(layout.regions).toHaveLength(1);
    const [column] = layout.regions[0].columns;
    expect(column).toMatchObject({ x: 40, width: 220 });
    expect(column.bands).toEqual([
      { top: 60, bottom: 68 },
      { top: 72, bottom: 80 },
      { top: 84, bottom: 92 },
      { top: 96, bottom: 104 },
      { top: 108, bottom: 116 },
    ]);
    expect(layout.lineGap).toBe(4);
  });

  it("finds two columns under a full-width heading", () => {
    const layout = pageWith([
      [40, 40, 220, 8],
      ...lines(40, 100, 60, 10),
      ...lines(160, 100, 60, 8),
    ]);
    expect(layout.regions.map((region) => region.columns.length)).toEqual([1, 2]);
    const [left, right] = layout.regions[1].columns;
    expect(left).toMatchObject({ x: 40, width: 100 });
    expect(right).toMatchObject({ x: 160, width: 100 });
    expect(left.bands).toHaveLength(10);
    expect(right.bands).toHaveLength(8);
  });

  it("gives a column the lines it starts with above the other column", () => {
    const layout = pageWith([
      [40, 20, 220, 8],
      ...lines(40, 100, 72, 8),
      ...lines(160, 100, 48, 10),
    ]);
    expect(layout.regions.map((region) => region.columns.length)).toEqual([1, 2]);
    const [left, right] = layout.regions[1].columns;
    expect(left.bands).toHaveLength(8);
    expect(right.bands).toHaveLength(10);
    expect(layout.regions[1].top).toBe(48);
  });

  it("does not take one line with a wide gap in it for columns", () => {
    const layout = pageWith([[40, 60, 60, 8], [160, 60, 100, 8], ...lines(40, 220, 72, 6)]);
    expect(layout.regions).toHaveLength(1);
    expect(layout.regions[0].columns).toHaveLength(1);
  });

  it("sets apart an isolated line at the head and at the foot", () => {
    const layout = pageWith([[40, 20, 80, 8], ...lines(40, 220, 60, 10), [140, 360, 20, 8]]);
    expect(layout.regions.map((region) => region.role)).toEqual(["head", "body", "foot"]);
  });
});

describe("resolveDocumentFrame", () => {
  const withFurniture = () =>
    pageWith([[40, 20, 80, 8], ...lines(40, 220, 60, 10), [140, 360, 20, 8]]);

  it("does not call a lone page's edge lines furniture", () => {
    const layouts = new Map<number, PageLayout>([[1, withFurniture()]]);
    const frame = resolveDocumentFrame(layouts);
    expect(frame.isFurniture(1, "head")).toBe(false);
    expect(buildPageFlow(1, layouts.get(1)!, frame).fixed).toEqual([]);
  });

  it("fixes edge lines that recur at the same place on other pages", () => {
    const layouts = new Map<number, PageLayout>([
      [1, withFurniture()],
      [2, withFurniture()],
      // A short last page: its own content ends well above the others'.
      [3, pageWith([[40, 20, 80, 8], ...lines(40, 220, 60, 3), [140, 360, 20, 8]])],
    ]);
    const frame = resolveDocumentFrame(layouts);
    expect(frame.isFurniture(1, "head")).toBe(true);
    expect(frame.isFurniture(3, "foot")).toBe(true);
    expect(frame.body).toEqual({ top: 60, bottom: 176 });

    const short = buildPageFlow(3, layouts.get(3)!, frame);
    expect(short.fixed).toHaveLength(2);
    expect(short.regions).toHaveLength(1);
    // It has the room the full pages show a page has, not just its own extent.
    expect(short.body).toEqual({ top: 60, bottom: 176 });
  });

  it("gives a chapter title at the head of one page to the flow", () => {
    const layouts = new Map<number, PageLayout>([
      [1, pageWith([[40, 60, 120, 8], ...lines(40, 220, 100, 6)])],
      [2, pageWith(lines(40, 220, 60, 10))],
      [3, pageWith(lines(40, 220, 60, 10))],
    ]);
    const frame = resolveDocumentFrame(layouts);
    expect(frame.isFurniture(1, "head")).toBe(false);
    expect(buildPageFlow(1, layouts.get(1)!, frame).regions).toHaveLength(2);
  });
});
