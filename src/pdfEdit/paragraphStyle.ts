import type { CSSProperties } from "react";
import type { LiveFont } from "./hostFonts.js";
import type { Paragraph } from "./paragraphs.js";
import type { FontInfo } from "./pdfPageSource.js";

/** Layout engines keep lengths in 64ths of a pixel. A line height that is not
 *  a whole number of them is rounded per line, and forty lines of rounding is
 *  enough to put the last line of a page on the wrong side of a float. */
export const snapPx = (pixels: number) => Math.round(pixels * 64) / 64;

/** The height of one of a paragraph's line boxes on screen. */
export const lineHeightPx = (paragraph: Paragraph, scale: number) =>
  snapPx(paragraph.lineHeight * scale);

/** A font, as the CSS that asks for it. */
export interface FaceStyle {
  fontFamily: string;
  fontWeight: "bold" | "normal";
  fontStyle: "italic" | "normal";
  /** Set where spaces come from another font than the text's own, to make
   *  them as wide as the text's own would be. */
  wordSpacing?: string;
}

/** The size and leading of a paragraph's type, in a given face. */
export function paragraphTextStyle(paragraph: Paragraph, face: FaceStyle, scale: number): CSSProperties {
  return {
    ...face,
    fontSize: paragraph.fontSize * scale,
    lineHeight: `${lineHeightPx(paragraph, scale)}px`,
  };
}

/** A font as the page draws it: the embedded face pdf.js registered. It is the
 *  face the page's own glyphs are in, so a caret laid over the page in it
 *  falls between the letters it appears to be between. A subset lacks glyphs;
 *  the generic family covers what it lacks -- and all of it, for a font of a
 *  page nothing is known about yet. */
export function pageFace(font: FontInfo): FaceStyle {
  return {
    fontFamily: font.face ? `"${font.face}", ${font.generic}` : font.generic,
    fontWeight: font.bold ? "bold" : "normal",
    fontStyle: font.italic ? "italic" : "normal",
  };
}

/** The fonts edited text is set in, each the file it will also be saved in:
 *  the browser takes each character from the first that has it, and so does
 *  the typesetter (`typeset`). Each is already the bold or the italic, so
 *  nothing is asked of the browser on top. Until any is known it is the
 *  page's face. */
export function liveFace(font: FontInfo, live: readonly LiveFont[]): FaceStyle {
  if (live.length === 0) return pageFace(font);
  const face: FaceStyle = {
    fontFamily: [...live.map((each) => `"${each.family}"`), font.generic].join(", "),
    fontWeight: "normal",
    fontStyle: "normal",
  };
  // A subset often has no space -- the document only ever left a gap -- and
  // the browser then takes one from the next font, at that font's width.
  const [own] = live;
  const drawn = live.find((each) => each.covers.has(0x20));
  if (!own.covers.has(0x20) && own.space !== undefined && drawn?.space !== undefined) {
    const difference = own.space - drawn.space;
    if (Math.abs(difference) > 0.001) face.wordSpacing = `${difference}em`;
  }
  return face;
}
