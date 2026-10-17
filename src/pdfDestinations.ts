import type { PDFDocumentProxy } from "./pdfjs.js";

/**
 * A PDF GoTo destination as exposed by pdf.js: either a named destination
 * (string, resolved via `getDestination`) or an explicit destination array
 * `[pageRef, {name}, ...params]`.
 */
export type PdfDestination = string | unknown[] | HostDestination;

/**
 * A destination the host resolved for itself, in page coordinates.
 *
 * A pdf.js destination names its page by an internal reference that only
 * pdf.js can resolve, against the document pdf.js parsed. That is no use to a
 * host describing a document the reader is not reading: a book laid out to
 * pages here and rendered for display carries an outline and links that were
 * resolved against the laid-out document, not against the bytes the reader
 * received. Such a host already knows the page number, and this is the shape
 * of saying so.
 */
export interface HostDestination {
  /** 1-based, as the reader's own `goToPage` counts. */
  page: number;
  /** Where on that page, in unscaled page units from the top. `null` or
   *  absent when the destination pins no vertical position. */
  offsetY?: number | null;
}

/** Whether a destination is one the host resolved rather than one pdf.js must. */
export function isHostDestination(dest: PdfDestination): dest is HostDestination {
  return (
    typeof dest === "object" &&
    dest !== null &&
    !Array.isArray(dest) &&
    typeof (dest as HostDestination).page === "number"
  );
}

export interface ResolvedDestination {
  /** 0-based index of the target page. */
  pageIndex: number;
  /** Destination mode from the explicit destination array (XYZ, FitH, etc.). */
  mode: string | null;
  /**
   * Horizontal target position in the scale-1, top-left page viewport. Null
   * means the destination does not constrain the horizontal position.
   */
  offsetX: number | null;
  /**
   * Vertical offset of the target within the page, in unscaled (scale-1)
   * top-left PDF-unit coordinates, or `null` when the destination does not
   * pin a specific position (e.g. a plain "Fit" destination). Callers scale
   * this by the page's render scale before adjusting scroll.
   */
  offsetY: number | null;
}

/**
 * Resolve a PDF GoTo destination to a concrete page and spatial anchor.
 *
 * Handles both named destinations (looked up via `getDestination`) and explicit
 * destination arrays. All consumers (navigation, hover previews, and future
 * link affordances) share this resolver so a link cannot point to one place on
 * click and describe another place on hover.
 */
export async function resolveDestination(
  pdf: PDFDocumentProxy,
  dest: PdfDestination,
): Promise<ResolvedDestination | null> {
  // A host-resolved destination is already the answer; it names a page rather
  // than a reference into a document this reader may not be holding.
  if (isHostDestination(dest)) {
    return {
      pageIndex: Math.max(0, dest.page - 1),
      mode: null,
      offsetX: null,
      offsetY: dest.offsetY ?? null,
    };
  }

  const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || explicit.length === 0) return null;

  const pageRef = explicit[0];
  const pageIndex = await pdf.getPageIndex(pageRef as never);

  const mode = (explicit[1] as { name?: string } | undefined)?.name;
  let destX: number | null = null;
  let destY: number | null = null;
  if (mode === "XYZ") {
    destX = typeof explicit[2] === "number" ? (explicit[2] as number) : null;
    destY = typeof explicit[3] === "number" ? (explicit[3] as number) : null;
  } else if (mode === "FitH" || mode === "FitBH") {
    destY = typeof explicit[2] === "number" ? (explicit[2] as number) : null;
  } else if (mode === "FitV" || mode === "FitBV") {
    destX = typeof explicit[2] === "number" ? (explicit[2] as number) : null;
  } else if (mode === "FitR") {
    // FitR packs [ref, {name:"FitR"}, left, bottom, right, top]. The upper-left
    // corner is the natural text-preview/navigation anchor.
    destX = typeof explicit[2] === "number" ? (explicit[2] as number) : null;
    destY = typeof explicit[5] === "number" ? (explicit[5] as number) : null;
  }

  let offsetX: number | null = null;
  let offsetY: number | null = null;
  if (destX !== null || destY !== null) {
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1 });
    const pageLeft = page.view[0];
    const pageTop = page.view[3];
    // Supply the page's upper-left coordinate for an unconstrained axis. This
    // keeps conversion correct on cropped/rotated pages without pretending the
    // destination constrained that axis (its returned offset remains null).
    const [vx, vy] = viewport.convertToViewportPoint(
      destX ?? pageLeft,
      destY ?? pageTop,
    );
    const [a, b, c, d] = viewport.transform;
    const epsilon = 1e-8;
    // A cropped/rotated viewport can swap or mix PDF-space axes. Mark a
    // viewport coordinate precise only when every source axis contributing to
    // it was constrained by the destination.
    const exactViewportX =
      (Math.abs(a) <= epsilon || destX !== null) &&
      (Math.abs(c) <= epsilon || destY !== null);
    const exactViewportY =
      (Math.abs(b) <= epsilon || destX !== null) &&
      (Math.abs(d) <= epsilon || destY !== null);
    if (exactViewportX) offsetX = vx;
    if (exactViewportY) offsetY = vy;
  }

  return { pageIndex, mode: mode ?? null, offsetX, offsetY };
}
