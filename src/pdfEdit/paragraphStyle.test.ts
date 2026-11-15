import { describe, expect, it } from "vitest";
import type { Paragraph, ParagraphLine, StyledRun } from "./paragraphs.js";
import {
  lineHeightPx,
  measurePageLines,
  pageWordSpacing,
  wholeLineScale,
  wordSpacingOf,
  WORD_SPACING_PROPERTY,
} from "./paragraphStyle.js";

describe("wholeLineScale", () => {
  const paragraph = { lineHeight: 13.5 } as Paragraph;

  it("is a scale near the page's at which a line is a whole number of pixels", () => {
    // 13.5pt at 2.1806px a point is 29.44px a line, which WebKit sets 29 apart.
    const setAt = wholeLineScale(paragraph, 2.1806);
    expect(lineHeightPx(paragraph, setAt)).toBe(29);
    expect(Math.abs(setAt / 2.1806 - 1)).toBeLessThan(0.02);
  });

  it("is the page's scale where a line already is a whole number of pixels", () => {
    expect(wholeLineScale(paragraph, 2)).toBe(2);
  });

  it("never sets lines closer than a pixel", () => {
    expect(lineHeightPx(paragraph, wholeLineScale(paragraph, 0.01))).toBe(1);
  });
});

describe("pageWordSpacing", () => {
  /** How wide a line comes out with `spacing` added to each of its spaces. */
  const set = (width: number, spaces: number, spacing: number) => width + spaces * spacing;

  it("squeezes the spaces of a line the page squeezed, so it keeps its last word", () => {
    // TeX set the first line tighter than its font's spaces: unbroken, its
    // text is wider than the box. CSS justification can only widen spaces.
    const lines = [
      { natural: 104, withNext: 120, spaces: 8, page: 100, room: 100 },
      { natural: 90, withNext: 115, spaces: 8, page: 100, room: 100 },
      { natural: 50, spaces: 4, page: 48, room: 100 },
    ];
    const spacing = pageWordSpacing(lines);
    for (const line of lines) {
      expect(set(line.natural, line.spaces, spacing)).toBeLessThanOrEqual(line.room);
      if (line.withNext !== undefined) expect(set(line.withNext, line.spaces + 1, spacing)).toBeGreaterThan(line.room);
    }
  });

  it("spaces ragged text as widely as the page did", () => {
    // A printer that set every space a unit wider than the font's.
    const spacing = pageWordSpacing([
      { natural: 90, withNext: 125, spaces: 8, page: 98, room: 120 },
      { natural: 95, withNext: 130, spaces: 8, page: 103, room: 120 },
      { natural: 40, spaces: 4, page: 44, room: 120 },
    ]);
    expect(spacing).toBeCloseTo(1);
  });

  it("never spaces a line so tightly that it takes the next one's first word", () => {
    // The page's spaces are narrower than the font's, but at its spacing the
    // short word that starts the next line would fit on this one.
    const line = { natural: 80, withNext: 101, spaces: 10, page: 75, room: 100 };
    const spacing = pageWordSpacing([line, { natural: 30, spaces: 3, page: 29, room: 100 }]);
    expect(set(line.withNext, line.spaces + 1, spacing)).toBeGreaterThan(line.room);
    expect(set(line.natural, line.spaces, spacing)).toBeLessThanOrEqual(line.room);
  });

  it("keeps every line's words on it where no one spacing keeps every break", () => {
    // One line was squeezed and another stretched, as TeX does to break a
    // paragraph as a whole: the stretched one may take a word from the next.
    const squeezed = { natural: 110, withNext: 125, spaces: 10, page: 100, room: 100 };
    const stretched = { natural: 80, withNext: 94, spaces: 10, page: 100, room: 100 };
    const spacing = pageWordSpacing([squeezed, stretched, { natural: 40, spaces: 4, page: 40, room: 100 }]);
    expect(set(squeezed.natural, squeezed.spaces, spacing)).toBeLessThanOrEqual(squeezed.room);
    expect(set(stretched.natural, stretched.spaces, spacing)).toBeLessThanOrEqual(stretched.room);
  });

  it("adds nothing where there are no word spaces to add to", () => {
    expect(pageWordSpacing([])).toBe(0);
    expect(pageWordSpacing([{ natural: 50, spaces: 0, page: 60, room: 100 }])).toBe(0);
  });
});

describe("measurePageLines", () => {
  const line = (text: string, start: number, kept: number, width: number): ParagraphLine => ({
    itemId: "",
    text,
    start,
    kept,
    baselineOffset: 0,
    inset: 0,
    width,
  });
  /** Measures a piece as one unit a character, and remembers what it was asked. */
  const recorder = () => {
    const asked: StyledRun[][] = [];
    const widthsOf = (pieces: StyledRun[][]) => {
      asked.push(...pieces);
      return pieces.map((runs) => runs.reduce((sum, run) => sum + run.text.length, 0));
    };
    return { asked, widthsOf };
  };

  it("measures each line, and each with the word that starts the next", () => {
    const paragraph = {
      text: "One two three four five six",
      runs: [
        { text: "One two ", style: 0 },
        { text: "three four five six", style: 1 },
      ],
      lines: [line("One two three", 0, 13, 50), line("four five six", 14, 13, 40)],
      indent: 2,
    } as Paragraph;
    const { asked, widthsOf } = recorder();
    const measured = measurePageLines(paragraph, widthsOf, 2, 120);
    expect(asked).toEqual([
      [
        { text: "One two ", style: 0 },
        { text: "three", style: 1 },
      ],
      [
        { text: "One two ", style: 0 },
        { text: "three four", style: 1 },
      ],
      [{ text: "four five six", style: 1 }],
    ]);
    expect(measured).toEqual([
      // The first line's room is what its indent leaves of the box.
      { natural: 13, withNext: 18, spaces: 2, page: 100, room: 116 },
      { natural: 13, spaces: 2, page: 80, room: 120 },
    ]);
  });

  it("leaves out a line ended in a typesetter's hyphen", () => {
    const paragraph = {
      text: "hyphenated word",
      runs: [{ text: "hyphenated word", style: 0 }],
      lines: [line("hyphen-", 0, 6, 30), line("ated word", 6, 9, 40)],
      indent: 0,
    } as Paragraph;
    const { asked, widthsOf } = recorder();
    expect(measurePageLines(paragraph, widthsOf, 1, 100)).toEqual([
      { natural: 9, spaces: 1, page: 40, room: 100 },
    ]);
    expect(asked).toEqual([[{ text: "ated word", style: 0 }]]);
  });
});

describe("wordSpacingOf", () => {
  it("adds the paragraph's word spacing to a face's own", () => {
    const face = { fontFamily: "f", fontWeight: "normal", fontStyle: "normal" } as const;
    expect(wordSpacingOf({ ...face, wordSpacing: "0.05em" })).toBe(
      `calc(0.05em + var(${WORD_SPACING_PROPERTY}, 0px))`,
    );
    expect(wordSpacingOf(face)).toBe(`calc(0px + var(${WORD_SPACING_PROPERTY}, 0px))`);
  });
});
