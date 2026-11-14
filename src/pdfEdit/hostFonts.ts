import { useCallback, useEffect, useState } from "react";

/**
 * Whole fonts for edited text, from the host.
 *
 * A PDF's embedded fonts are subsets, so text a reader types is set in a whole
 * font the host resolves -- and the host saves the document with the same
 * file, which is what makes the saved line breaks the ones on screen. This is
 * where those fonts are asked for and registered with the browser.
 */

/** A font as a document names it. */
export interface PdfFontRequest {
  /** PostScript name, without a subset's prefix. May be empty. */
  name: string;
  bold: boolean;
  italic: boolean;
  generic: "serif" | "sans-serif" | "monospace";
}

/** What a host answers with: a standalone font file, and the name it will
 *  know it by again when the document is saved. */
export interface ResolvedPdfFont {
  id: string;
  data: ArrayBuffer;
}

export type ResolvePdfFont = (font: PdfFontRequest) => Promise<ResolvedPdfFont>;

/** A resolved font, registered: the id to save with, the family to draw with. */
export interface LiveFont {
  id: string;
  family: string;
}

const requestKey = (font: PdfFontRequest) =>
  `${font.name}|${font.bold}|${font.italic}|${font.generic}`;

// `document.fonts` is one set for the whole page, so what has been added to it
// is remembered for the whole page too: two documents set in Times New Roman
// share one face.
const families = new Map<string, string>();

function register(font: ResolvedPdfFont): LiveFont {
  let family = families.get(font.id);
  if (!family) {
    family = `pdf-edit-${families.size}`;
    families.set(font.id, family);
    document.fonts.add(new FontFace(family, font.data));
  }
  return { id: font.id, family };
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
          const live = register(resolved);
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
