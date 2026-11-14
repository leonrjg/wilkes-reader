import { glyphAdvances, readCharacterMap, withTable, writeCharacterMap } from "./sfnt.js";

/**
 * The document's own fonts, as fonts text can be typed in.
 *
 * Edited text has to be set in a font that the browser can draw and that the
 * saved file can embed, and the font a paragraph was set in is rarely
 * installed. Standing in for it with an installed font changes the paragraph's
 * face the moment it is touched. But the font is in the file -- as a subset,
 * the glyphs the document used -- and pdf.js has already turned it into one a
 * browser can draw, to draw the page with. What that one lacks is a way in by
 * character: its character map is keyed by the codes the file's text is
 * written in, which are often not Unicode at all. Given a map from Unicode,
 * built from what pdf.js knows of which code is which character, it is the
 * page's own face for every character the document used. The characters it
 * never had are left to a whole installed font (see `hostFonts`).
 */

/** A font of the document, ready to type in. */
export interface OwnFace {
  /** A font file with a Unicode character map. */
  data: Uint8Array;
  /** The characters it has glyphs for. */
  covers: ReadonlySet<number>;
  /** How wide the document sets a space in this font, in ems -- known even
   *  when the subset has no glyph for one, which is common: a space is often
   *  only a gap. */
  space?: number;
}

/** What pdf.js keeps of a font it loaded, when asked to keep it all
 *  (`fontExtraProperties`). */
export interface LoadedFontFile {
  data?: Uint8Array | null;
  /** Code to character: a sparse table, or every code standing for itself. */
  toUnicode?: { _map?: ArrayLike<string | undefined> } | { firstChar?: number; lastChar?: number } | null;
  /** Code to the code pdf.js gave the glyph in the font it built. */
  toFontChar?: ArrayLike<number | undefined> | null;
  /** Code to advance, in the font's glyph space. */
  widths?: ArrayLike<number | undefined> | null;
  /** Glyph space to text space; the first entry scales advances. */
  fontMatrix?: ArrayLike<number> | null;
}

/** The characters a font's codes stand for, code by code. */
function charactersOf(toUnicode: NonNullable<LoadedFontFile["toUnicode"]>): Array<[number, string]> {
  if ("_map" in toUnicode && toUnicode._map) {
    const map = toUnicode._map;
    return Object.keys(map)
      .map((key) => [Number(key), map[Number(key)]] as const)
      .filter((entry): entry is [number, string] => typeof entry[1] === "string" && Number.isInteger(entry[0]));
  }
  if ("firstChar" in toUnicode && toUnicode.firstChar !== undefined && toUnicode.lastChar !== undefined) {
    const characters: Array<[number, string]> = [];
    for (let code = toUnicode.firstChar; code <= toUnicode.lastChar; code++) {
      characters.push([code, String.fromCodePoint(code)]);
    }
    return characters;
  }
  return [];
}

const built = new WeakMap<object, OwnFace | null>();

/** The font as one to type in, or null when there is nothing to make it from:
 *  a font the file did not embed and pdf.js had no stand-in for, a font drawn
 *  as pictures (Type 3), or one whose codes no character is known for. */
export function ownFaceOf(font: LoadedFontFile): OwnFace | null {
  if (built.has(font)) return built.get(font) ?? null;
  const face = buildOwnFace(font);
  built.set(font, face);
  return face;
}

function buildOwnFace(font: LoadedFontFile): OwnFace | null {
  const { data, toUnicode, toFontChar } = font;
  if (!data || !toUnicode) return null;
  let glyphs: Map<number, number>;
  let advance: ((glyph: number) => number) | null;
  try {
    glyphs = readCharacterMap(data);
    advance = glyphAdvances(data);
  } catch (error) {
    console.warn("PDF edit: a font of the document could not be read for typing in:", error);
    return null;
  }
  const byCharacter = new Map<number, number>();
  let space: number | undefined;
  for (const [code, text] of charactersOf(toUnicode)) {
    if (text === " " && space === undefined) space = widthOf(font, code);
    // A code that stands for several characters is a ligature: typed text has
    // the letters, and each finds its own glyph.
    const characters = [...text];
    if (characters.length !== 1) continue;
    const character = characters[0].codePointAt(0)!;
    if (character < 0x20 || (character >= 0x7f && character < 0xa0)) continue;
    const glyph = glyphs.get(toFontChar?.[code] ?? code);
    if (!glyph) continue;
    // pdf.js gives a font codes from a standard encoding that the document
    // never used, and points them at whatever glyph there is -- a TeX font's
    // code 32 is a "space" with no width. A glyph that takes no room is
    // only ever right for a mark that sits on the letter before it.
    // The document's own widths say the same of the codes it never used.
    const mark = /\p{M}/u.test(characters[0]);
    if (!mark && (advance?.(glyph) === 0 || font.widths?.[code] === 0)) continue;
    // The first code for a character wins; a font that draws one character
    // two ways means the same by both.
    if (!byCharacter.has(character)) byCharacter.set(character, glyph);
  }
  if (byCharacter.size === 0) return null;
  return {
    data: withTable(data, "cmap", writeCharacterMap(byCharacter)),
    covers: new Set(byCharacter.keys()),
    space: space ?? widthOf(font, 0x20),
  };
}

/** A code's advance in ems, if the document gives one. */
function widthOf({ widths, fontMatrix }: LoadedFontFile, code: number): number | undefined {
  const width = widths?.[code];
  if (typeof width !== "number" || width <= 0) return undefined;
  return width * (fontMatrix?.[0] ?? 0.001);
}
