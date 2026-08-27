import type { PDFDocumentProxy } from "pdfjs-dist";
import { type PdfDestination } from "./pdfDestinations";
import { type PositionedPdfText } from "./pdfTextContent";
export type { PositionedPdfText } from "./pdfTextContent";
export interface PdfLinkPreview {
    pageNumber: number;
    text: string;
}
interface TextLine {
    text: string;
    x: number;
    top: number;
    width: number;
    height: number;
}
interface PreviewAnchor {
    x: number | null;
    y: number;
}
/**
 * Group positioned PDF.js text items into visual line segments. A baseline can
 * contain unrelated items from two columns, so a large horizontal gap splits a
 * row into independent lines before any destination matching occurs.
 */
export declare function groupPdfTextLines(items: PositionedPdfText[]): TextLine[];
export declare function extractTextBlockAtDestination(items: PositionedPdfText[], anchor: PreviewAnchor): string | null;
export declare function getPdfLinkPreview(pdf: PDFDocumentProxy, dest: PdfDestination): Promise<PdfLinkPreview | null>;
//# sourceMappingURL=pdfLinkPreview.d.ts.map