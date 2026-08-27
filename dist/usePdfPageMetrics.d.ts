import type { PDFDocumentProxy } from "pdfjs-dist";
export interface PdfPageMetric {
    width: number;
    height: number;
}
export declare function getScaledPageHeight(metric: PdfPageMetric, renderedWidth: number): number;
export declare function usePdfPageMetrics(pdf: PDFDocumentProxy | null, url: string): {
    pageMetrics: PdfPageMetric[];
    isLoadingPageMetrics: boolean;
    hasPageMetrics: boolean;
};
//# sourceMappingURL=usePdfPageMetrics.d.ts.map