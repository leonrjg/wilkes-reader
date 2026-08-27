import type { PDFDocumentProxy } from "pdfjs-dist";
export interface PositionedPdfText {
    text: string;
    hasEOL: boolean;
    direction: string;
    x: number;
    top: number;
    width: number;
    height: number;
    /** True when advancing through the string primarily moves horizontally. */
    horizontal: boolean;
}
/**
 * Convert one PDF.js text item to the same top-left page coordinate space used
 * by the viewer's highlight overlays. The axis-aligned envelope remains valid
 * for cropped and rotated pages; substring trimming is limited to horizontal
 * items by the caller.
 */
export declare function positionPdfTextItem(viewportTransform: number[], item: {
    str: string;
    hasEOL?: boolean;
    dir?: string;
    transform: number[];
    width?: number;
    height?: number;
}): PositionedPdfText;
/** Load and position a page's PDF.js text items once per open document. */
export declare function loadPdfPageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<PositionedPdfText[]>;
//# sourceMappingURL=pdfTextContent.d.ts.map