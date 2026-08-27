import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfDestination } from "./pdfDestinations";
interface Props {
    pdf: PDFDocumentProxy;
    pageNumber: number;
    /** CSS pixels per PDF unit, i.e. renderedWidth / unscaledPageWidth. */
    scale: number;
    /** Navigate to an in-document GoTo destination. */
    onNavigateToDestination: (dest: PdfDestination) => void;
    /** Open an external URL (http/https) referenced by a link annotation. */
    onOpenExternal: (url: string) => void;
}
/**
 * Renders clickable overlays for a page's Link annotations — the within-document
 * links (table-of-contents entries, cross-references) and external URLs that OS
 * readers make navigable. Positioned above the text layer so links win the click;
 * everything else stays selectable.
 *
 * Mirrors PdfTextLayer's lifecycle: annotations are fetched per page and the
 * overlay boxes are derived from the annotation rects via the page viewport, so
 * coordinates already match the rendered scale.
 */
export default function PdfLinkLayer({ pdf, pageNumber, scale, onNavigateToDestination, onOpenExternal, }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=PdfLinkLayer.d.ts.map