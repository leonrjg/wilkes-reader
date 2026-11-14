import { describe, expect, it } from "vitest";
import type { FlowItem, PageFlow } from "./flow.js";
import { relocateArea, relocateHeight, type LocateItem } from "./relocation.js";

/** Lines 10 tall and 2 apart from y=100, in one column from x=50. */
const items: FlowItem[] = Array.from({ length: 6 }, (_, index) => ({
  id: `line-${index}`,
  height: 10,
  gapBefore: 2,
  leading: 0,
  trailing: 0,
  content: { kind: "slice", page: 1, rect: { x: 50, y: 100 + index * 12, width: 200, height: 10 } },
}));
const flow: PageFlow = {
  page: 1,
  width: 300,
  height: 400,
  body: { top: 100, bottom: 300 },
  lead: 0,
  regions: [{ gapBefore: 0, depth: null, columns: [{ x: 50, width: 200, lead: 0, items, room: 0, opens: 12 }] }],
  fixed: [],
  background: "white",
};

/** Where each line is, given how far the lines from `from` on moved down, and
 *  which were replaced or pushed onto the next page. */
const locator =
  (from: number, by: number, gone: number[] = [], nextPage: number[] = []): LocateItem =>
  (id) => {
    const index = Number(id.split("-")[1]);
    if (gone.includes(index)) return null;
    if (nextPage.includes(index)) return { page: 2, x: 50, y: 100 + nextPage.indexOf(index) * 12 };
    return { page: 1, x: 50, y: 100 + index * 12 + (index >= from ? by : 0) };
  };

describe("relocateArea", () => {
  const onLineTwo = { x: 80, y: 123, width: 40, height: 12 };

  it("leaves an area where it is when nothing under it moved", () => {
    expect(relocateArea(1, onLineTwo, flow, locator(4, 24))).toEqual([{ page: 1, rect: onLineTwo }]);
  });

  it("moves an area with the line it is on", () => {
    expect(relocateArea(1, onLineTwo, flow, locator(1, 24))).toEqual([
      { page: 1, rect: { x: 80, y: 123 + 24, width: 40, height: 12 } },
    ]);
  });

  it("keeps an area over several lines whole while they move together", () => {
    const overThree = { x: 60, y: 110, width: 100, height: 36 };
    expect(relocateArea(1, overThree, flow, locator(0, 12))).toEqual([
      { page: 1, rect: { x: 60, y: 110 + 12, width: 100, height: 36 } },
    ]);
  });

  it("parts an area whose lines ended up on two pages", () => {
    const overTwo = { x: 60, y: 148, width: 100, height: 22 };
    expect(relocateArea(1, overTwo, flow, locator(0, 0, [], [5]))).toEqual([
      { page: 1, rect: { x: 60, y: 148, width: 100, height: 11 } },
      { page: 2, rect: { x: 60, y: 99, width: 100, height: 11 } },
    ]);
  });

  it("drops what lay on a line an edit replaced", () => {
    expect(relocateArea(1, onLineTwo, flow, locator(0, 0, [2]))).toEqual([]);
  });

  it("leaves an area that is on nothing that flows", () => {
    const inMargin = { x: 10, y: 20, width: 20, height: 20 };
    expect(relocateArea(1, inMargin, flow, locator(0, 50))).toEqual([{ page: 1, rect: inMargin }]);
  });

  it("leaves everything alone on a page that has not been read", () => {
    expect(relocateArea(3, onLineTwo, null, () => null)).toEqual([{ page: 3, rect: onLineTwo }]);
  });
});

describe("relocateHeight", () => {
  it("follows the line at that height", () => {
    expect(relocateHeight(1, 126, flow, locator(1, 24))).toEqual({ page: 1, y: 126 + 24 });
  });

  it("takes the next line still drawn when the one there was replaced", () => {
    expect(relocateHeight(1, 123, flow, locator(0, 0, [2], [3, 4, 5]))).toEqual({ page: 2, y: 100 });
  });

  it("is unchanged under the last line", () => {
    expect(relocateHeight(1, 390, flow, locator(0, 30))).toEqual({ page: 1, y: 390 });
  });
});
