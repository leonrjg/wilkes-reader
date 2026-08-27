import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PdfPageMetric {
  width: number;
  height: number;
}

export function getScaledPageHeight(metric: PdfPageMetric, renderedWidth: number) {
  return (metric.height / metric.width) * renderedWidth;
}

/** Every page's unscaled size, remeasured when the document changes.
 *
 *  `documentKey` is the document's identity ([`pdfDocumentKey`]), not a
 *  location: a host whose bytes arrive over its own transport has no URL to
 *  name, and this hook only ever used one as "has the document changed?". */
export function usePdfPageMetrics(pdf: PDFDocumentProxy | null, documentKey: string) {
  const [pageMetrics, setPageMetrics] = useState<PdfPageMetric[]>([]);
  const [isLoadingPageMetrics, setIsLoadingPageMetrics] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setPageMetrics([]);
    setIsLoadingPageMetrics(Boolean(pdf));

    if (!pdf) {
      return () => {
        cancelled = true;
      };
    }

    const loadMetrics = async () => {
      try {
        const metrics = await Promise.all(
          Array.from({ length: pdf.numPages }, async (_, index) => {
            const page = await pdf.getPage(index + 1);
            const viewport = page.getViewport({ scale: 1 });
            return { width: viewport.width, height: viewport.height };
          }),
        );

        if (!cancelled) {
          setPageMetrics(metrics);
        }
      } catch (e) {
        console.error("Failed to load PDF page metrics:", e);
      } finally {
        if (!cancelled) {
          setIsLoadingPageMetrics(false);
        }
      }
    };

    loadMetrics();

    return () => {
      cancelled = true;
    };
  }, [pdf, documentKey]);

  return {
    pageMetrics,
    isLoadingPageMetrics,
    hasPageMetrics: pdf !== null && pageMetrics.length === pdf.numPages,
  };
}
