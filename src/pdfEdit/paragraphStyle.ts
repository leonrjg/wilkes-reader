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

/** The font edited text is set in: the whole font the host resolved, which is
 *  the file it will also save with. It is already the bold or the italic, so
 *  nothing is asked of the browser on top. Until the host has answered -- or
 *  when there is no host to ask -- it is the page's face. */
export function liveFace(font: FontInfo, live: LiveFont | null): FaceStyle {
  if (!live) return pageFace(font);
  return { fontFamily: `"${live.family}", ${font.generic}`, fontWeight: "normal", fontStyle: "normal" };
}
