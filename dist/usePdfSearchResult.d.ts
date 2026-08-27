import type { PDFDocumentProxy } from "pdfjs-dist";
import { type PdfSearchLocator, type PdfTextMatch } from "./pdfTextLocator";
/** Resolve a coarse indexed PDF origin to rendered PDF.js page geometry. */
export declare function usePdfSearchResult(pdf: PDFDocumentProxy | null, coarsePage: number, locator: PdfSearchLocator | null | undefined): PdfTextMatch | null;
//# sourceMappingURL=usePdfSearchResult.d.ts.map