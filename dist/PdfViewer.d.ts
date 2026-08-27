import { type Ref } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { BoundingBox } from "./documentCoordinates";
import type { PdfSearchLocator } from "./pdfTextLocator";
import { type PdfDestination } from "./pdfDestinations";
import type { DocumentSelection } from "./selection";
import { type Decoration } from "./decorations";
import type { PdfReaderSlots } from "./slots";
import type { FindableReaderHandle, ZoomableReaderHandle } from "./readerHandle";
export interface PdfViewerProps {
    url: string;
    /** Incremented to retry a failed parse without changing the document URL. */
    loadAttempt?: number;
    page: number;
    /** Where to navigate: the scroll destination and what the ping points at.
     *  It locates the target, it does not draw it -- a host that wants a mark
     *  left on the page supplies a decoration, so nothing is drawn twice. */
    highlight_bbox: BoundingBox | null;
    /** Raw search evidence used to correct a chunk-level indexed origin against
     *  nearby PDF.js pages. It is transient viewer state, never index data. */
    search_locator?: PdfSearchLocator | null;
    /** Host-owned marks on the document. Only `rects`-anchored decorations are
     *  placeable here; `range` anchors belong to the text readers and are
     *  ignored, so one list can be handed to whichever reader is mounted. */
    decorations?: Decoration[];
    slots?: PdfReaderSlots;
    /** Imperative control — navigation, zoom and find as commands. */
    ref?: Ref<PdfReaderHandle>;
    onRenderSuccess?: () => void;
    onLoadError?: (error: unknown) => void;
    /** Fires (debounced) whenever the page nearest the viewport center changes
     *  -- covers scroll, page-jump, and link/outline navigation alike, since
     *  all of them funnel through `currentPage`. Used to keep the chat pane's
     *  "open document" page badge live as the user reads, not just on the
     *  initial landing page. */
    onPageChange?: (page: number) => void;
}
export type PdfSelection = DocumentSelection;
export interface PdfReaderHandle extends FindableReaderHandle, ZoomableReaderHandle {
    /** Scroll a page to the top of the viewport, optionally revealing a
     *  rectangle on it once the page is mounted. */
    goToPage: (page: number, opts?: {
        reveal?: BoundingBox;
    }) => void;
    /** Follow an in-document destination (outline entry, cross-reference). */
    goToDestination: (destination: PdfDestination) => void;
    getCurrentPage: () => number;
    getPageCount: () => number | null;
    /** The parsed document, for hosts that need to read it directly. Null until
     *  it has loaded. */
    getDocument: () => PDFDocumentProxy | null;
}
export default function PdfViewer({ url, loadAttempt, page, highlight_bbox, search_locator, decorations, slots, ref, onRenderSuccess, onLoadError, onPageChange, }: PdfViewerProps): import("react").JSX.Element;
//# sourceMappingURL=PdfViewer.d.ts.map