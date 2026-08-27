import type { PDFDocumentProxy } from "pdfjs-dist";
/** The parsed proxy if this document is currently cached, else null. Lets a
 *  revisited document render synchronously with no reload flash. */
export declare function peekCachedPdfDocument(url: string): PDFDocumentProxy | null;
/** Load a PDF, reusing the cached proxy when present. */
export declare function loadPdfDocument(url: string): Promise<PDFDocumentProxy>;
/** The cached-or-loading `PDFDocumentProxy` for `url`, or null while loading. */
export declare function usePdfDocument(url: string, loadAttempt?: number, onLoadError?: (error: unknown) => void): PDFDocumentProxy | null;
//# sourceMappingURL=pdfDocumentCache.d.ts.map