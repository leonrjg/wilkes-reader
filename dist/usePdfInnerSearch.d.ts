import type { PDFDocumentProxy } from "pdfjs-dist";
import type { BoundingBox } from "./documentCoordinates";
export interface InnerMatch {
    page: number;
    bbox: BoundingBox;
}
/**
 * Computes the PDF-specific match set for in-document find: it scans page text
 * for `query` and returns page-anchored bounding boxes. Find-bar state and match
 * navigation are owned by the shared {@link useDocumentFind} controller.
 */
export declare function usePdfInnerSearch(pdf: PDFDocumentProxy | null, query: string, isEnabled: boolean): {
    matches: InnerMatch[];
    isSearching: boolean;
};
//# sourceMappingURL=usePdfInnerSearch.d.ts.map