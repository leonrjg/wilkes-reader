import type { ReactNode } from "react";
import type { BoundingBox, ByteRange } from "./documentCoordinates";
/** Where a decoration attaches to the document.
 *
 *  The two variants are not stylistic: they are the two coordinate systems the
 *  readers actually have. A reader that lays out pages (PDF) can only place
 *  something it is given page-relative rectangles for; a reader that renders a
 *  byte stream (Markdown, source) can only place something it is given a range
 *  in the document's UTF-8 bytes for. A host builds whichever anchor its data
 *  already carries and passes one list to whichever reader is mounted — each
 *  reader keeps the anchors it can place and ignores the rest. */
export type DecorationAnchor = {
    kind: "rects";
    page: number;
    rects: BoundingBox[];
} | {
    kind: "range";
    range: ByteRange;
};
export interface DecorationRenderContext {
    /** PDF units → CSS px for the page this decoration was placed on. */
    scale: number;
    /** The decoration's union box, in PDF units. */
    box: BoundingBox;
    page: number;
}
/**
 * A host-owned mark on the document. The reader owns *where* it lands (page
 * placement, scale, rect merging, virtualization); the host owns what it means
 * and what it looks like. This is the whole reason the readers no longer know
 * the word "bookmark": a bookmark is a decoration whose class is
 * `pdf-highlight--bookmark`, and a coverage box is a decoration whose class is
 * something else. Neither is a concept the reader has to carry.
 */
export interface Decoration {
    id: string;
    anchor: DecorationAnchor;
    /** Appended to the reader's own geometry class. The host owns the palette. */
    className?: string;
    /** Optional host content, positioned over the decoration's union box.
     *  Rect-anchored decorations only — a range anchor has no stable box until
     *  the text is laid out, so there is nothing to position against. */
    render?: (ctx: DecorationRenderContext) => ReactNode;
    /** When set, the reader makes the decoration clickable/focusable and calls
     *  this with the live screen rectangle of the element that was activated, so
     *  the host can anchor a popover to it. */
    onActivate?: DecorationActivateHandler;
    ariaLabel?: string;
}
/** Screen-space rectangle of a rendered element, for anchoring host chrome. */
export interface ElementAnchor {
    left: number;
    top: number;
    right: number;
    bottom: number;
}
export type DecorationActivateHandler = (id: string, anchor: ElementAnchor) => void;
export declare function elementAnchor(element: Element): ElementAnchor;
/** The rect-anchored decorations that fall on one page. */
export declare function rectDecorationsForPage(decorations: Decoration[], page: number): Array<Decoration & {
    anchor: Extract<DecorationAnchor, {
        kind: "rects";
    }>;
}>;
/** The range-anchored decorations, in document order. */
export declare function rangeDecorations(decorations: Decoration[]): Array<{
    id: string;
    range: ByteRange;
    className?: string;
    ariaLabel?: string;
}>;
/** Bounding envelope of a set of rectangles. */
export declare function unionBox(rects: BoundingBox[]): BoundingBox;
//# sourceMappingURL=decorations.d.ts.map