import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfDestination } from "./pdfDestinations";
export interface PdfOutlineNode {
    title: string;
    dest: PdfDestination | null;
    url: string | null;
    items: PdfOutlineNode[];
}
/**
 * Loads the document outline (the PDF's own table of contents / bookmarks tree)
 * via `pdf.getOutline()`. Returns `null` while loading or when the document has
 * no outline, letting callers hide the TOC affordance entirely.
 */
export declare function usePdfOutline(pdf: PDFDocumentProxy | null): PdfOutlineNode[] | null;
//# sourceMappingURL=usePdfOutline.d.ts.map