import { useCallback, useEffect, useState } from "react";
import { readCharacterMap, spaceAdvance } from "./sfnt.js";

/**
 * Whole fonts for edited text, from the host.
 *
 * A PDF's embedded fonts are subsets. Text a reader types is set in the
 * document's own font where it has the glyphs (`ownFaces`), and in a whole
 * font the host resolves where it does not -- or in that alone, when the host
 * has the document's font itself. The host saves the document with the same
 * files, which is what makes the saved line breaks the ones on screen. This is
 * where the host's fonts are asked for, and where every font edited text is
 * set in is registered with the browser.
 */

/** A font as a document names it. */
export interface PdfFontRequest {
  /** PostScript name, without a subset's prefix. May be empty. */
  name: string;
  bold: boolean;
  italic: boolean;
  generic: "serif" | "sans-serif" | "monospace";
  /** Set when the weight and slant asked for are not the named font's own but
   *  another face of its family: the reader made a word bold. The name then
   *  says which family, not which font. */
  sibling?: boolean;
}

/** What a host answers with: a standalone font file, and the name it will
 *  know it by again when the document is saved. */
export interface ResolvedPdfFont {
  id: string;
  data: ArrayBuffer;
}

export type ResolvePdfFont = (font: PdfFontRequest) => Promise<ResolvedPdfFont>;

/** A font edited text can be set in, registered: the id to save with, the
 *  family to draw with, and the characters it can draw. */
export interface LiveFont {
  id: string;
  family: string;
  covers: ReadonlySet<number>;
  /** How wide a space is in this font, in ems, if that is known. */
  space?: number;
  /** The host found the very font the document asked for, whole: nothing
   *  else needs to be laid under it. */
  exact?: boolean;
  /** A font the host did not supply -- the document's own, made typeable --
   *  is sent to it with the edits, to be saved in. */
  file?: Uint8Array;
}

const requestKey = (font: PdfFontRequest) =>
  `${font.name}|${font.bold}|${font.italic}|${font.generic}|${font.sibling ?? false}`;

// `document.fonts` is one set for the whole page, so what has been added to it
// is remembered for the whole page too: two documents set in Times New Roman
// share one face. A font of a document's own is known by the object it was
// made into, since two documents can each have a different "Times" subset.
const families = new Map<object | string, LiveFont>();

/** Add a font file to the page's fonts, once per `key`. */
export function registerFont(
  key: object | string,
  id: string,
  data: Uint8Array | ArrayBuffer,
  space?: number,
): LiveFont {
  let live = families.get(key);
  if (!live) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    live = {
      id,
      family: `pdf-edit-${families.size}`,
      covers: charactersOf(id, bytes),
      space: space ?? spaceOf(id, bytes),
    };
    families.set(key, live);
    // A copy: the font set may hold on to the buffer it is given.
    document.fonts.add(new FontFace(live.family, bytes.slice()));
  }
  return live;
}

/** The characters a font has glyphs for. One whose map cannot be read is
 *  still drawn, and taken to have them all: the browser will say otherwise. */
function charactersOf(id: string, font: Uint8Array): ReadonlySet<number> {
  try {
    return new Set(readCharacterMap(font).keys());
  } catch (error) {
    console.warn(`PDF edit: which characters font ${id} has could not be read:`, error);
    return EVERY_CHARACTER;
  }
}

function spaceOf(id: string, font: Uint8Array): number | undefined {
  try {
    return spaceAdvance(font) ?? undefined;
  } catch (error) {
    console.warn(`PDF edit: how wide a space is in font ${id} could not be read:`, error);
    return undefined;
  }
}

const EVERY_CHARACTER: ReadonlySet<number> = new (class extends Set<number> {
  has(): boolean {
    return true;
  }
})();

function register(font: ResolvedPdfFont, request: PdfFontRequest): LiveFont {
  const live = registerFont(font.id, font.id, font.data);
  return !request.sibling && request.name !== "" && font.id === request.name ? { ...live, exact: true } : live;
}

/** Resolve every font in `wanted` through the host, and answer which are
 *  ready. Null for one that is not: still on its way, or refused. */
export function useLiveFonts(
  resolve: ResolvePdfFont | undefined,
  wanted: readonly PdfFontRequest[],
): (font: PdfFontRequest) => LiveFont | null {
  const [ready, setReady] = useState<ReadonlyMap<string, LiveFont>>(() => new Map());
  const [asked] = useState(() => new Set<string>());

  useEffect(() => {
    if (!resolve) return;
    for (const font of wanted) {
      const key = requestKey(font);
      if (asked.has(key)) continue;
      asked.add(key);
      resolve(font).then(
        (resolved) => {
          const live = register(resolved, font);
          setReady((known) => new Map(known).set(key, live));
        },
        (error) => {
          // Left asked-for: a font the host could not resolve once will not
          // resolve on the next render either. Its text stays in the page's
          // embedded face, and cannot be saved.
          console.error(`PDF edit: no font could be resolved for "${font.name}":`, error);
        },
      );
    }
  }, [resolve, wanted, asked]);

  // The same function until a font arrives: whatever is derived from it must
  // not look new on every render.
  return useCallback((font: PdfFontRequest) => ready.get(requestKey(font)) ?? null, [ready]);
}
