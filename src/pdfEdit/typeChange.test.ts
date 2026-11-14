import { describe, expect, it } from "vitest";
import type { PdfFontRequest } from "./hostFonts.js";
import type { RunStyle } from "./paragraphs.js";
import { allWear, fontRequestOf, retyped } from "./typeChange.js";

const regular: PdfFontRequest = { name: "Face-Regular", bold: false, italic: false, generic: "serif" };
const bold: PdfFontRequest = { name: "Face-Bold", bold: true, italic: false, generic: "serif" };
const fontOf = (fontName: string) => (fontName === "b" ? bold : regular);
const plain: RunStyle = { fontName: "r", fontSize: 10, color: "black", rise: 0 };
const strong: RunStyle = { ...plain, fontName: "b" };
const styles = [plain, strong];
const runs = [
  { text: "plain ", style: 0 },
  { text: "strong", style: 1 },
];

describe("retyped", () => {
  it("makes part of a run bold in a style of its own", () => {
    const result = retyped(runs, styles, 2, 4, "bold", true, fontOf);
    expect(result.runs).toEqual([
      { text: "pl", style: 0 },
      { text: "ai", style: 2 },
      { text: "n ", style: 0 },
      { text: "strong", style: 1 },
    ]);
    expect(result.styles[2]).toEqual({ ...plain, bold: true });
  });

  it("gives back the page's own runs when the change is taken off again", () => {
    const once = retyped(runs, styles, 2, 4, "bold", true, fontOf);
    const back = retyped(once.runs, once.styles, 0, 12, "bold", false, fontOf);
    // The word the page set bold is now not: that is a change of its own.
    expect(back.runs[0]).toEqual({ text: "plain ", style: 0 });
    expect(back.styles[back.runs[1].style]).toEqual({ ...strong, bold: false });
    const again = retyped(back.runs, back.styles, 6, 12, "bold", true, fontOf);
    expect(again.runs).toEqual(runs);
  });

  it("says nothing where the font is already what was asked for", () => {
    expect(retyped(runs, styles, 6, 12, "bold", true, fontOf)).toEqual({ runs, styles });
  });

  it("keeps a change that is already there when another is made", () => {
    const first = retyped(runs, styles, 0, 6, "bold", true, fontOf);
    const second = retyped(first.runs, first.styles, 0, 6, "italic", true, fontOf);
    expect(second.styles[second.runs[0].style]).toEqual({ ...plain, bold: true, italic: true });
  });
});

describe("allWear", () => {
  it("is true only when every selected run is", () => {
    expect(allWear(runs, styles, 6, 12, "bold", fontOf)).toBe(true);
    expect(allWear(runs, styles, 4, 12, "bold", fontOf)).toBe(false);
  });
});

describe("fontRequestOf", () => {
  it("asks for the font itself when the style says nothing against it", () => {
    expect(fontRequestOf(plain, regular)).toBe(regular);
    expect(fontRequestOf({ ...strong, bold: true }, bold)).toBe(bold);
  });

  it("asks for a sibling face when the style does", () => {
    expect(fontRequestOf({ ...plain, italic: true }, regular)).toEqual({
      ...regular,
      italic: true,
      sibling: true,
    });
  });
});
