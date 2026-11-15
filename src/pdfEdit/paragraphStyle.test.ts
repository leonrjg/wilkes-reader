import { describe, expect, it } from "vitest";
import type { Paragraph } from "./paragraphs.js";
import { lineHeightPx, wholeLineScale } from "./paragraphStyle.js";

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
