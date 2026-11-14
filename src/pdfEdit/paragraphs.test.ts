import { describe, expect, it } from "vitest";
import type { FlowItem, PageFlow } from "./flow.js";
import { splitRuns } from "./edits.js";
import { continuesIn, paragraphsOf, runningOnInto, type TextRun } from "./paragraphs.js";

const LEFT = 50;
const RIGHT = 250;

/** One line of 10pt text: its strip of the page and the run on it. */
function line(index: number, top: number, text: string, left = LEFT, right = RIGHT) {
  const item: FlowItem = {
    id: `1:0:0:${index}`,
    height: 8,
    gapBefore: 4,
    leading: 0,
    trailing: 0,
    content: { kind: "slice", page: 1, rect: { x: LEFT, y: top, width: RIGHT - LEFT, height: 8 } },
  };
  const run: TextRun = { text, x: left, width: right - left, baseline: top + 7, fontSize: 10, fontName: "f1", color: "black" };
  return { item, run };
}

function flowOf(lines: Array<ReturnType<typeof line>>, gaps: number[] = []): PageFlow {
  const items = lines.map(({ item }, index) => ({ ...item, gapBefore: gaps[index] ?? 4 }));
  return {
    page: 1,
    width: 300,
    height: 400,
    body: { top: 40, bottom: 360 },
    lead: 0,
    regions: [{ gapBefore: 0, depth: null, columns: [{ x: LEFT, width: RIGHT - LEFT, lead: 0, items, room: 0, opens: 0 }] }],
    fixed: [],
    background: "white",
  };
}

describe("paragraphsOf", () => {
  it("joins the lines of a paragraph and undoes the typesetter's hyphens", () => {
    const lines = [
      line(0, 40, "A paragraph that was hyphen-"),
      line(1, 52, "ated by whoever set it and"),
      line(2, 64, "ends here.", LEFT, 110),
    ];
    const [paragraph, ...rest] = paragraphsOf(flowOf(lines), lines.map(({ run }) => run));
    expect(rest).toEqual([]);
    expect(paragraph.text).toBe("A paragraph that was hyphenated by whoever set it and ends here.");
    expect(paragraph).toMatchObject({
      itemIds: ["1:0:0:0", "1:0:0:1", "1:0:0:2"],
      lineCount: 3,
      firstBaseline: 47,
      lineHeight: 12,
      inset: 0,
      width: 200,
      align: "justify",
    });
    // Where each line went in the joined text: the first lost its hyphen.
    expect(paragraph.lines.map(({ itemId, start, kept, baselineOffset }) => [itemId, start, kept, baselineOffset])).toEqual([
      ["1:0:0:0", 0, 27, 7],
      ["1:0:0:1", 27, 26, 7],
      ["1:0:0:2", 54, 10, 7],
    ]);
  });

  it("starts a new paragraph after a short line, a wide gap, or at an indent", () => {
    const lines = [
      line(0, 40, "First paragraph, a full line"),
      line(1, 52, "and a short one.", LEFT, 130),
      line(2, 64, "Second, straight after it and"),
      line(3, 76, "full to the right-hand edge."),
      line(4, 100, "Third, after a wider gap, full."),
      line(5, 112, "Fourth, indented a little.", LEFT + 12),
    ];
    const paragraphs = paragraphsOf(flowOf(lines, [4, 4, 4, 4, 16, 4]), lines.map(({ run }) => run));
    expect(paragraphs.map((paragraph) => paragraph.itemIds.length)).toEqual([2, 2, 1, 1]);
    expect(paragraphs[3].inset).toBe(12);
  });

  it("keeps ragged lines together: a line is not short because it stops before the edge", () => {
    // Set flush left, so no line reaches the edge. Each was broken because the
    // next word did not fit -- except the fourth, whose follower would have.
    const lines = [
      line(0, 40, "Ragged text never reaches the", LEFT, 236),
      line(1, 52, "right-hand edge, but every line", LEFT, 250),
      line(2, 64, "was broken only because the", LEFT, 228),
      line(3, 76, "following word was too long.", LEFT, 215),
      line(4, 88, "A list item, quite short.", LEFT, 160),
      line(5, 100, "And another one after it.", LEFT, 170),
    ];
    const paragraphs = paragraphsOf(flowOf(lines), lines.map(({ run }) => run));
    expect(paragraphs.map((paragraph) => paragraph.itemIds.length)).toEqual([4, 1, 1]);
    expect(paragraphs[0].align).toBe("left");
  });

  it("measures a column by its lines, not by a note set in the margin beside one", () => {
    const body = (index: number, text: string) => line(index, 40 + index * 12, text);
    const lines = Array.from({ length: 12 }, (_, index) => body(index, "A full line of the paragraph's own text"));
    // The second line has a word in the margin, on its own baseline.
    const note: TextRun = { text: "margin", x: 262, width: 30, baseline: lines[1].run.baseline, fontSize: 10, fontName: "f1", color: "black" };
    lines[1].item.content = { kind: "slice", page: 1, rect: { x: LEFT, y: 52, width: 260, height: 8 } };
    const paragraphs = paragraphsOf(flowOf(lines), [...lines.map(({ run }) => run), note]);
    expect(paragraphs.map((paragraph) => paragraph.itemIds.length)).toEqual([12]);
  });

  it("knows a paragraph that goes on in the next column from one that ended", () => {
    const paragraphOf = (rows: Array<ReturnType<typeof line>>) => paragraphsOf(flowOf(rows), rows.map(({ run }) => run))[0];
    const next = paragraphOf([line(0, 40, "Following words that begin the next"), line(1, 52, "column of the page.", LEFT, 150)]);
    // Its last line stops a word short of the edge: "Following" did not fit.
    const broken = paragraphOf([line(0, 40, "A paragraph the column's foot cut in"), line(1, 52, "two, mid-sentence, and it goes", LEFT, 222)]);
    expect(continuesIn(broken, next)).toBe(true);
    // Its last line stops well short: the paragraph ended there.
    const ended = paragraphOf([line(0, 40, "A paragraph that says what it has to"), line(1, 52, "and ends.", LEFT, 100)]);
    expect(continuesIn(ended, next)).toBe(false);
  });

  it("keeps a list item whose first line hangs to the left of the rest", () => {
    const lines = [
      line(0, 40, "Before the list, a full line of"),
      line(1, 52, "text, and its end.", LEFT, 140),
      line(2, 64, "\u2022 an item of the list, long enough"),
      line(3, 76, "to go on under its own words", LEFT + 12, 230),
      line(4, 88, "and end.", LEFT + 12, 100),
      line(5, 100, "\u2022 another item, of one line.", LEFT, 200),
    ];
    const paragraphs = paragraphsOf(flowOf(lines), lines.map(({ run }) => run));
    expect(paragraphs.map((paragraph) => paragraph.itemIds.length)).toEqual([2, 3, 1]);
    // Its edge is where its later lines are; its first line starts left of it.
    expect(paragraphs[1]).toMatchObject({ inset: 12, indent: -12, width: 188 });
  });

  it("keeps the runs of type a paragraph is set in", () => {
    const first = line(0, 40, "Plain words, then");
    const second = line(1, 52, "more plain words.", LEFT, 150);
    // An italic phrase at the end of the first line and a raised citation
    // after the second: different faces, and one off the baseline.
    const italic: TextRun = { text: "a phrase", x: 150, width: 100, baseline: 47, fontSize: 10, fontName: "f2", color: "black" };
    const raised: TextRun = { text: "7", x: 151, width: 4, baseline: 55, fontSize: 7, fontName: "f1", color: "black" };
    first.run.width = 95;
    const [paragraph] = paragraphsOf(flowOf([first, second]), [first.run, italic, second.run, raised]);

    expect(paragraph.text).toBe("Plain words, then a phrase more plain words.7");
    expect(paragraph.runs.map((run) => [run.text, paragraph.styles[run.style]])).toEqual([
      ["Plain words, then ", { fontName: "f1", fontSize: 10, color: "black", rise: 0 }],
      ["a phrase", { fontName: "f2", fontSize: 10, color: "black", rise: 0 }],
      [" more plain words.", { fontName: "f1", fontSize: 10, color: "black", rise: 0 }],
      ["7", { fontName: "f1", fontSize: 7, color: "black", rise: 4 }],
    ]);
    expect(paragraph.styles[paragraph.baseStyle].fontName).toBe("f1");
  });

  it("withholds a paragraph that has a locked line in it", () => {
    const lines = [
      line(0, 40, "A sentence that runs into a"),
      line(1, 52, "formula set in its own line"),
      line(2, 64, "and carries on after it.", LEFT, 160),
      line(3, 90, "Another paragraph entirely.", LEFT, 180),
    ];
    const flow = flowOf(lines, [4, 4, 4, 18]);
    const locked = flow.regions[0].columns[0].items[1];
    if (locked.content.kind === "slice") locked.content.locked = true;
    const paragraphs = paragraphsOf(flow, lines.map(({ run }) => run));
    expect(paragraphs.map((paragraph) => paragraph.text)).toEqual(["Another paragraph entirely."]);
  });

  it("offers nothing for a strip with no text on it", () => {
    const lines = [line(0, 40, "Some text above a figure.")];
    const figure = line(1, 60, "");
    expect(paragraphsOf(flowOf([...lines, figure]), [lines[0].run])).toHaveLength(1);
  });
});

describe("splitRuns", () => {
  const runs = [
    { text: "plain ", style: 0 },
    { text: "italic", style: 1 },
  ];

  it("cuts inside a run and between runs", () => {
    expect(splitRuns(runs, 3)).toEqual([[{ text: "pla", style: 0 }], [{ text: "in ", style: 0 }, runs[1]]]);
    expect(splitRuns(runs, 6)).toEqual([[runs[0]], [runs[1]]]);
  });

  it("leaves one side empty at either end", () => {
    expect(splitRuns(runs, 0)).toEqual([[], runs]);
    expect(splitRuns(runs, 99)).toEqual([runs, []]);
  });
});

describe("runningOnInto", () => {
  const next = [{ text: "made it.", style: 0 }];

  it("puts a space where a sentence was broken between words", () => {
    expect(runningOnInto([{ text: "people here", style: 1 }], next)).toEqual([{ text: "people here ", style: 1 }]);
  });

  it("takes out the hyphen a typesetter broke a word with", () => {
    expect(runningOnInto([{ text: "re-", style: 0 }], next)).toEqual([{ text: "re", style: 0 }]);
  });

  it("adds nothing after a space, or before nothing", () => {
    expect(runningOnInto([{ text: "here ", style: 0 }], next)).toEqual([{ text: "here ", style: 0 }]);
    expect(runningOnInto([{ text: "here", style: 0 }], [])).toEqual([{ text: "here", style: 0 }]);
  });
});
