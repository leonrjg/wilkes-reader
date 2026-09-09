import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfDestination } from "./pdfDestinations.js";

export interface PdfOutlineNode {
  title: string;
  /** Where the entry goes. A host-supplied outline uses a
   *  {@link HostDestination}, which names its page directly. */
  dest: PdfDestination | null;
  url: string | null;
  items: PdfOutlineNode[];
}

/** pdf.js outline item shape (subset we consume). */
interface RawOutlineItem {
  title: string;
  dest?: PdfDestination | null;
  url?: string | null;
  items?: RawOutlineItem[];
}

function normalize(items: RawOutlineItem[]): PdfOutlineNode[] {
  return items.map((item) => ({
    title: item.title,
    dest: item.dest ?? null,
    url: item.url ?? null,
    items: item.items ? normalize(item.items) : [],
  }));
}

/**
 * Loads the document outline (the PDF's own table of contents / bookmarks tree)
 * via `pdf.getOutline()`. Returns `null` while loading or when the document has
 * no outline, letting callers hide the TOC affordance entirely.
 */
export function usePdfOutline(
  pdf: PDFDocumentProxy | null,
  supplied?: PdfOutlineNode[] | null,
): PdfOutlineNode[] | null {
  const [outline, setOutline] = useState<PdfOutlineNode[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOutline(null);
    // A host that holds the outline itself is answering a question the
    // document cannot. A book rendered to pages for display carries no
    // outline of its own -- a page writer emits drawing operations, and a
    // table of contents is not one -- so asking the document would report the
    // book as having none, which is a different claim from the truth.
    if (supplied) {
      setOutline(supplied.length > 0 ? supplied : null);
      return;
    }
    if (!pdf) return;

    pdf
      .getOutline()
      .then((items) => {
        if (cancelled) return;
        setOutline(items && items.length > 0 ? normalize(items as RawOutlineItem[]) : null);
      })
      .catch((e) => {
        if (!cancelled) console.error("Failed to load PDF outline:", e);
      });

    return () => {
      cancelled = true;
    };
  }, [pdf, supplied]);

  return outline;
}
