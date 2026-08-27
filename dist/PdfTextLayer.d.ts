import type { PDFDocumentProxy } from "pdfjs-dist";
interface Props {
    pdf: PDFDocumentProxy;
    pageNumber: number;
    /** CSS pixels per PDF unit, i.e. renderedWidth / unscaledPageWidth. */
    scale: number;
}
/**
 * Renders the selectable text overlay for a single page using pdf.js' own
 * `TextLayerBuilder` — the exact component the pdf.js viewer (and Zotero) use.
 *
 * Hand-rolling this layer is a trap: the `selectionchange`-driven
 * `endOfContent` management is what keeps a selection from ballooning to the
 * whole paragraph or page, and `TextLayerBuilder` owns it (its static global
 * selection listener spans every mounted page, virtualized ones included) and
 * is maintained upstream. The canvas beside it is drawn by `PdfPageCanvas`.
 */
export default function PdfTextLayer({ pdf, pageNumber, scale }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=PdfTextLayer.d.ts.map