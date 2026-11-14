import { describe, expect, it } from "vitest";
import { applyEdits, createEdit, editBackdrops, editFragments } from "./edits.js";
import type { FlowColumn, FlowItem, PageFlow } from "./flow.js";
import type { Paragraph } from "./paragraphs.js";
import { layoutPage, reflowDocument } from "./reflow.js";

const LINE = 10;
const GAP = 2;

/** A column of `count` lines, each 10 tall and 2 apart, as a page drew them. */
function column(page: number, name: string, x: number, count: number, top: number): FlowColumn {
  const items: FlowItem[] = Array.from({ length: count }, (_, index) => ({
    id: `${page}:${name}:${index}`,
    height: LINE,
    gapBefore: GAP,
    trailing: 0,
    content: {
      kind: "slice",
      page,
      rect: { x, y: top + index * (LINE + GAP), width: 200, height: LINE },
    },
  }));
  return { x, width: 200, lead: 0, items };
}

/** A page whose body runs from 100 to 340: room for exactly twenty lines. */
function page(number: number, columns: FlowColumn[], lead = 0): PageFlow {
  return {
    page: number,
    width: 600,
    height: 400,
    body: { top: 100, bottom: 340 - GAP },
    lead,
    regions: columns.length > 0 ? [{ gapBefore: GAP, columns }] : [],
    fixed: [],
    background: "white",
  };
}

function blank(number: number): PageFlow {
  return page(number, []);
}

function tops(flow: PageFlow, carried = []) {
  return layoutPage(flow, carried).placements.map((placement) => placement.y);
}

/** A paragraph covering lines `from..to` of a single-column page. */
function paragraph(flow: PageFlow, from: number, to: number, splittable = true): Paragraph {
  const items = flow.regions[0].columns[0].items.slice(from, to);
  const first = items[0].content;
  if (first.kind !== "slice") throw new Error("expected a slice");
  return {
    page: flow.page,
    itemIds: items.map((item) => item.id),
    area: { x: first.rect.x, y: first.rect.y, width: 200, height: items.length * (LINE + GAP) - GAP },
    splittable,
    text: "",
    runs: [],
    styles: [{ fontName: "f", fontSize: 10, color: "black", rise: 0 }],
    baseStyle: 0,
    lineCount: items.length,
    // With line boxes as tall as a line and its gap, and an ascent that puts
    // the box's top on the ink's, an unchanged edit occupies what it replaced.
    firstBaseline: first.rect.y + 8,
    lineHeight: LINE + GAP,
    inset: 0,
    width: 200,
    indent: 0,
    fontName: "f",
    fontSize: 10,
    color: "black",
    align: "left",
    lines: [],
  };
}

function edited(flow: PageFlow, from: number, to: number, lineCount: number, splittable = true) {
  return { ...createEdit("e", paragraph(flow, from, to, splittable)), lineCount, ascent: 8 };
}

describe("layoutPage", () => {
  it("returns an untouched page's items to where the file drew them", () => {
    const flow = page(1, [column(1, "a", 50, 20, 100)]);
    const original = flow.regions[0].columns[0].items.map((item) =>
      item.content.kind === "slice" ? item.content.rect.y : NaN,
    );
    expect(tops(flow)).toEqual(original);
    expect(layoutPage(flow, []).overflow).toEqual([]);
  });

  it("keeps a page's first region where it was when the page starts low", () => {
    const flow = page(1, [column(1, "a", 50, 3, 160)], 60);
    expect(tops(flow)[0]).toBe(160);
  });

  it("moves a column's overflow to the head of the next column", () => {
    const left = column(1, "l", 50, 21, 100);
    const right = column(1, "r", 300, 5, 100);
    const { placements, overflow } = layoutPage(page(1, [left, right]), []);
    const moved = placements.find((placement) => placement.item.id === "1:l:20");
    expect(moved).toMatchObject({ x: 300, y: 100 });
    // The right column's own lines follow it, one line further down.
    expect(placements.find((placement) => placement.item.id === "1:r:0")?.y).toBe(112);
    expect(overflow).toEqual([]);
  });
});

describe("reflowDocument", () => {
  const flows = (pages: PageFlow[]) => (number: number) =>
    pages.find((flow) => flow.page === number) ?? blank(number);

  it("plans nothing past a page whose content still fits", () => {
    const first = page(1, [column(1, "a", 50, 10, 100)]);
    const edit = edited(first, 2, 4, 5);
    const reflow = reflowDocument((n) => applyEdits(flows([first])(n), [edit]), [1], 1);
    expect([...reflow.plans.keys()]).toEqual([1]);
    // Three more lines above it: the line after the paragraph moved by three.
    const after = reflow.plans.get(1)?.placements.find((p) => p.item.id === "1:a:4");
    expect(after?.y).toBe(100 + 4 * 12 + 3 * 12);
  });

  it("leaves the lines after an edit that changed nothing exactly in place", () => {
    const first = page(1, [column(1, "a", 50, 10, 100)]);
    const edit = edited(first, 2, 4, 2);
    const reflow = reflowDocument((n) => applyEdits(flows([first])(n), [edit]), [1], 1);
    const slices = reflow.plans.get(1)!.placements.filter((p) => p.item.content.kind === "slice");
    for (const placement of slices) {
      const { content } = placement.item;
      expect(placement.y).toBeCloseTo(content.kind === "slice" ? content.rect.y : NaN);
    }
  });

  it("pushes a full page's last lines onto the next, ahead of its own", () => {
    const first = page(1, [column(1, "a", 50, 20, 100)]);
    const second = page(2, [column(2, "a", 50, 10, 100)]);
    const edit = edited(first, 0, 1, 3);
    const reflow = reflowDocument((n) => applyEdits(flows([first, second])(n), [edit]), [1], 2);

    const onSecond = reflow.plans.get(2)!.placements.map((placement) => placement.item.id);
    expect(onSecond.slice(0, 3)).toEqual(["1:a:18", "1:a:19", "2:a:0"]);
    expect(reflow.plans.get(2)!.placements[2].y).toBe(100 + 2 * 12);
    expect(reflow.lastPage).toBe(2);
  });

  it("cascades through full pages and stops at one with room", () => {
    const pages = [1, 2, 3].map((n) => page(n, [column(n, "a", 50, 20, 100)]));
    pages.push(page(4, [column(4, "a", 50, 5, 100)]));
    const edit = edited(pages[0], 0, 1, 2);
    const reflow = reflowDocument((n) => applyEdits(flows(pages)(n), [edit]), [1], 5);
    expect([...reflow.plans.keys()]).toEqual([1, 2, 3, 4]);
    expect(reflow.plans.get(4)!.placements[0].item.id).toBe("3:a:19");
  });

  it("appends a page when the last one overflows", () => {
    const only = page(1, [column(1, "a", 50, 20, 100)]);
    const edit = edited(only, 0, 1, 2);
    const reflow = reflowDocument((n) => applyEdits(flows([only])(n), [edit]), [1], 1);
    expect(reflow.lastPage).toBe(2);
    expect(reflow.plans.get(2)!.placements.map((p) => p.item.id)).toEqual(["1:a:19"]);
  });

  it("reports the page a cascade is waiting on", () => {
    const first = page(1, [column(1, "a", 50, 20, 100)]);
    const edit = edited(first, 0, 1, 2);
    const reflow = reflowDocument((n) => (n === 1 ? applyEdits(first, [edit]) : null), [1], 3);
    expect(reflow.missing).toEqual([2]);
  });

  it("splits an edited paragraph's lines across a page break", () => {
    const first = page(1, [column(1, "a", 50, 20, 100)]);
    const second = page(2, [column(2, "a", 50, 10, 100)]);
    // The page's last two lines become five.
    const edit = edited(first, 18, 20, 5);
    const reflow = reflowDocument((n) => applyEdits(flows([first, second])(n), [edit]), [1], 2);
    expect(editFragments(edit, reflow.plans)).toEqual([
      { page: 1, x: 50, y: 100 + 18 * 12, lines: 2 },
      { page: 2, x: 50, y: 100, lines: 3 },
    ]);
  });

  it("cuts what a paragraph stood on to the lines it has now", () => {
    const first = page(1, [column(1, "a", 50, 10, 100)]);
    // Lines 2..4 (three lines) become five. The paragraph's box is 12 tall per
    // line here, so it has nothing above its first line or below its last.
    const edit = edited(first, 2, 5, 5);
    const reflow = reflowDocument((n) => applyEdits(flows([first])(n), [edit]), [1], 1);
    const backdrops = editBackdrops(edit, reflow.plans);
    const top = 100 + 2 * 12;
    expect(backdrops.map((backdrop) => [backdrop.y, backdrop.source.rect.y])).toEqual([
      // The first line keeps its own piece; every line added reuses the last
      // inner line's; the last line gets the original last line's.
      [top, top],
      [top + 12, top + 12],
      [top + 24, top + 12],
      [top + 36, top + 12],
      [top + 48, top + 24],
    ]);
  });

  it("puts the top and bottom of a box above the first line and below the last", () => {
    const first = page(1, [column(1, "a", 50, 10, 100)]);
    const paragraphInBox = paragraph(first, 2, 4);
    // A box 6 taller than its two lines at each end.
    paragraphInBox.area = { ...paragraphInBox.area, y: paragraphInBox.area.y - 6, height: 2 * 12 + 12 };
    const edit = { ...createEdit("e", paragraphInBox), lineCount: 3, ascent: 8 };
    const reflow = reflowDocument((n) => applyEdits(flows([first])(n), [edit]), [1], 1);
    const backdrops = editBackdrops(edit, reflow.plans);
    const lineTop = reflow.plans.get(1)!.placements.find((p) => p.item.id === "e:0")!.y;
    const head = backdrops.find((backdrop) => backdrop.source.rect.y === paragraphInBox.area.y)!;
    expect(head).toMatchObject({ y: lineTop - 6 });
    expect(head.source.rect.height).toBe(6);
    const tail = backdrops[backdrops.length - 1];
    expect(tail.y).toBe(lineTop + 3 * 12);
    expect(tail.source.rect.height).toBe(6);
  });

  it("moves a paragraph that cannot be split as one block", () => {
    const first = page(1, [column(1, "a", 50, 20, 100)]);
    const second = page(2, [column(2, "a", 50, 10, 100)]);
    const edit = edited(first, 18, 20, 5, false);
    const reflow = reflowDocument((n) => applyEdits(flows([first, second])(n), [edit]), [1], 2);
    expect(editFragments(edit, reflow.plans)).toEqual([{ page: 2, x: 50, y: 100, lines: 5 }]);
  });
});
