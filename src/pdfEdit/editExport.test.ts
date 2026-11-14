import { describe, expect, it } from "vitest";
import { buildExport, type TypesetText } from "./editExport.js";
import type { FlowItem, PageFlow, Placement } from "./flow.js";

function slice(page: number, index: number, y: number): FlowItem {
  return {
    id: `${page}:${index}`,
    height: 10,
    gapBefore: 2,
    trailing: 0,
    content: { kind: "slice", page, rect: { x: 50, y, width: 200, height: 10 } },
  };
}

function flow(page: number, fixed: PageFlow["fixed"] = []): PageFlow {
  return {
    page,
    width: 300,
    height: 400,
    body: { top: 40, bottom: 360 },
    lead: 0,
    regions: [],
    fixed,
    background: "white",
  };
}

const place = (item: FlowItem, y: number): Placement => ({ item, x: 50, y, width: 200 });
/** Items are consecutive on their page when their indices are. */
const follows = (a: FlowItem, b: FlowItem) => {
  const [pageA, indexA] = a.id.split(":").map(Number);
  const [pageB, indexB] = b.id.split(":").map(Number);
  return pageA === pageB && indexB === indexA + 1;
};

describe("buildExport", () => {
  it("joins lines that stayed together into one area", () => {
    const items = [slice(1, 0, 100), slice(1, 1, 112), slice(1, 2, 124)];
    const plans = new Map([[1, { page: 1, placements: items.map((item, i) => place(item, 130 + i * 12)) }]]);
    const { pages } = buildExport(plans, flow, follows, []);
    expect(pages[0].strips).toEqual([
      { source: 1, rect: { x: 50, y: 100, width: 200, height: 34 }, x: 50, y: 130 },
    ]);
  });

  it("does not join across a paragraph that was taken out between them", () => {
    // Items 0 and 2 are both placed, 30 lower; item 1 was edited away. They
    // are no longer neighbours on their page, so what lay between must not
    // come along.
    const plans = new Map([
      [1, { page: 1, placements: [place(slice(1, 0, 100), 130), place(slice(1, 2, 124), 154)] }],
    ]);
    expect(buildExport(plans, flow, follows, []).pages[0].strips).toHaveLength(2);
  });

  it("does not join lines that moved by different amounts", () => {
    const plans = new Map([
      [1, { page: 1, placements: [place(slice(1, 0, 100), 100), place(slice(1, 1, 112), 136)] }],
    ]);
    expect(buildExport(plans, flow, follows, []).pages[0].strips).toHaveLength(2);
  });

  it("carries a page's fixed areas and the text set on it", () => {
    const head = { x: 0, y: 0, width: 300, height: 30 };
    const text: TypesetText[] = [
      { page: 1, x: 50, baseline: 108, text: "here ", font: "Georgia", size: 10, color: [0, 0, 0] },
      { page: 2, x: 50, baseline: 60, text: "there", font: "Georgia", size: 10, color: [0, 0, 0] },
    ];
    const plans = new Map([
      [2, { page: 2, placements: [place(slice(1, 5, 300), 50)] }],
      [1, { page: 1, placements: [] }],
    ]);
    const { pages } = buildExport(plans, (page) => flow(page, page === 1 ? [head] : []), follows, text);
    expect(pages.map((page) => page.page)).toEqual([1, 2]);
    expect(pages[0].strips).toEqual([{ source: 1, rect: head, x: 0, y: 0 }]);
    expect(pages[0].text).toEqual([
      { x: 50, baseline: 108, text: "here ", font: "Georgia", size: 10, color: [0, 0, 0] },
    ]);
    // A strip pushed onto the next page still names the page it was cut from.
    expect(pages[1].strips[0]).toMatchObject({ source: 1, y: 50 });
    expect(pages[1].text[0].text).toBe("there");
  });
});
