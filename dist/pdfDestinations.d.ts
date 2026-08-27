import type { PDFDocumentProxy } from "pdfjs-dist";
/**
 * A PDF GoTo destination as exposed by pdf.js: either a named destination
 * (string, resolved via `getDestination`) or an explicit destination array
 * `[pageRef, {name}, ...params]`.
 */
export type PdfDestination = string | unknown[];
export interface ResolvedDestination {
    /** 0-based index of the target page. */
    pageIndex: number;
    /** Destination mode from the explicit destination array (XYZ, FitH, etc.). */
    mode: string | null;
    /**
     * Horizontal target position in the scale-1, top-left page viewport. Null
     * means the destination does not constrain the horizontal position.
     */
    offsetX: number | null;
    /**
     * Vertical offset of the target within the page, in unscaled (scale-1)
     * top-left PDF-unit coordinates, or `null` when the destination does not
     * pin a specific position (e.g. a plain "Fit" destination). Callers scale
     * this by the page's render scale before adjusting scroll.
     */
    offsetY: number | null;
}
/**
 * Resolve a PDF GoTo destination to a concrete page and spatial anchor.
 *
 * Handles both named destinations (looked up via `getDestination`) and explicit
 * destination arrays. All consumers (navigation, hover previews, and future
 * link affordances) share this resolver so a link cannot point to one place on
 * click and describe another place on hover.
 */
export declare function resolveDestination(pdf: PDFDocumentProxy, dest: PdfDestination): Promise<ResolvedDestination | null>;
//# sourceMappingURL=pdfDestinations.d.ts.map