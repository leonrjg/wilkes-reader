import { createContext, useContext, type ReactNode } from "react";
import type { ResolvePdfFont } from "./pdfEdit/hostFonts.js";
import type { PdfEditStore } from "./pdfEdit/editStore.js";
import type { ReaderPositionStore } from "./readerPositions.js";

/** The appearance a reader renders in. The host resolves whatever theme setting
 *  it has ("system", a class on the document, an OS query) down to this. */
export type ColorScheme = "light" | "dark";

/**
 * The services a reader needs from the application hosting it. This exists so
 * the readers reach for an injected capability instead of importing the app's
 * singletons: there is exactly one Tauri `api` and one settings store in
 * Wilkes, and a reader that imports them cannot be mounted anywhere else.
 *
 * Deliberately not optional and deliberately not defaulted — a reader rendered
 * without a host is a wiring mistake, and a silent fallback would hide it until
 * a link failed to open in front of a user.
 */
export interface ReaderHostServices {
  /** Open a URL or path outside the reader (external links, `file://`). */
  openExternal: (url: string) => void;
  /** The appearance to render in. The *treatment* is the readers' own -- the
   *  inverted PDF canvas, the dark syntax theme -- but which one applies is the
   *  application's decision, and how it decides is its own business. Reading it
   *  off a class on the document, as these readers used to, silently assumes
   *  the host stamps that particular class on that particular element. */
  colorScheme: ColorScheme;
  /** Target CSS-pixel height for body text when a PDF is first opened.
   *  `undefined` disables auto-zoom. */
  pdfAutoZoomTargetPx?: number;
  /** Where each document was left, and at what zoom. The readers capture and
   *  restore the geometry; how long it is kept is the application's decision.
   *  Keep its identity stable: the text readers re-read their position when it
   *  changes. A host that keeps nothing past the component tree passes
   *  `createMemoryPositionStore()`. */
  positions: ReaderPositionStore;
  /** A URL the application will serve a local file at, for the subresources a
   *  document references -- the images beside an HTML file.
   *
   *  Optional because it is a decision, not a detail: a host that does not
   *  supply it gets documents rendered without their local images, and the
   *  readers will not invent a way to fetch a file the application has not
   *  offered them. Returning `null` refuses one path; the reader then shows the
   *  image's alt text. This is also the only place a document's reach into the
   *  filesystem can be judged -- the reference has already been resolved
   *  against the document, and a host that wants it fenced to a corpus fences
   *  it here. */
  resolveLocalAsset?: (path: string) => string | null;
  /** A whole, installed font to set edited PDF text in, standing in for a font
   *  the document names.
   *
   *  A PDF embeds subsets of its fonts -- the glyphs it needed and no others --
   *  so text a reader types cannot be set in them. The host finds a whole one,
   *  and saves the edited document with the same file: that it is the same
   *  file on both sides is what makes the saved line breaks the ones on
   *  screen. Optional: without it, edited text is set in the document's
   *  embedded faces as far as they go, and cannot be exported. */
  resolvePdfFont?: ResolvePdfFont;
  /** What the reader has changed in each PDF and not saved as a file. Kept by
   *  the host for as long as it chooses, like `positions`. Optional: without
   *  it, changes last as long as the reader showing them. */
  pdfEdits?: PdfEditStore;
}

const ReaderHostContext = createContext<ReaderHostServices | null>(null);

export function ReaderHostProvider({
  value,
  children,
}: {
  value: ReaderHostServices;
  children: ReactNode;
}) {
  return <ReaderHostContext.Provider value={value}>{children}</ReaderHostContext.Provider>;
}

export function useReaderHost(): ReaderHostServices {
  const host = useContext(ReaderHostContext);
  if (!host) {
    throw new Error(
      "Reader components must be rendered inside <ReaderHostProvider>; " +
        "it supplies openExternal and the reader settings.",
    );
  }
  return host;
}
