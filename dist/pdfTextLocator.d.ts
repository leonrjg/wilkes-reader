import type { PDFDocumentProxy } from "pdfjs-dist";
import type { BoundingBox } from "./documentCoordinates";
import { type PositionedPdfText } from "./pdfTextContent";
export interface PdfTextMatch {
    page: number;
    bbox: BoundingBox;
    rects: BoundingBox[];
    contextScore: number;
}
export interface PdfSearchLocator {
    matched_text: string;
    context_before: string;
    context_after: string;
}
export declare function findPdfTextMatchesInItems(items: PositionedPdfText[], page: number, query: string, options?: {
    caseSensitive?: boolean;
    contextBefore?: string;
    contextAfter?: string;
}): PdfTextMatch[];
export declare function findPdfTextMatchesOnPage(pdf: PDFDocumentProxy, page: number, query: string, options?: {
    caseSensitive?: boolean;
    contextBefore?: string;
    contextAfter?: string;
}): Promise<PdfTextMatch[]>;
export declare function findAllPdfTextMatches(pdf: PDFDocumentProxy, query: string, signal?: AbortSignal): Promise<PdfTextMatch[]>;
/**
 * Resolve an indexed result close to its chunk-level page hint. The bounded
 * neighborhood covers a chunk whose text begins on one page and whose match is
 * on the next without turning result navigation into a full-document scan.
 */
export declare function locatePdfSearchResult(pdf: PDFDocumentProxy, coarsePage: number, locator: PdfSearchLocator, signal?: AbortSignal): Promise<PdfTextMatch | null>;
//# sourceMappingURL=pdfTextLocator.d.ts.map