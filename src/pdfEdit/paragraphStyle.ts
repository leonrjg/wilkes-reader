import type { CSSProperties } from "react";
import type { Paragraph } from "./paragraphs.js";
import type { FontInfo } from "./pdfPageSource.js";

/** Layout engines keep lengths in 64ths of a pixel. A line height that is not
 *  a whole number of them is rounded per line, and forty lines of rounding is
 *  enough to put the last line of a page on the wrong side of a float. */
export const snapPx = (pixels: number) => Math.round(pixels * 64) / 64;

/** The height of one of a paragraph's line boxes on screen. */
export const lineHeightPx = (paragraph: Paragraph, scale: number) =>
  snapPx(paragraph.lineHeight * scale);

/** The type a paragraph is set in, as the page has it. Shared by the text laid
 *  invisibly over an untouched paragraph and the live text of an edited one,
 *  so a caret sits in the same place in both. */
export function paragraphTextStyle(paragraph: Paragraph, font: FontInfo, scale: number): CSSProperties {
  return {
    ...fontFace(paragraph.fontName, font),
    fontSize: paragraph.fontSize * scale,
    lineHeight: `${lineHeightPx(paragraph, scale)}px`,
  };
}

/** A font of the page, as CSS: the embedded face pdf.js registered, then the
 *  generic family for whatever characters a subset does not have. */
export function fontFace(fontName: string, font: FontInfo) {
  return {
    fontFamily: `"${fontName}", ${font.fallback}`,
    fontWeight: font.bold ? "bold" : "normal",
    fontStyle: font.italic ? "italic" : "normal",
  };
}
