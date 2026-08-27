import type { PdfOutlineNode } from "./usePdfOutline";
import type { PdfDestination } from "./pdfDestinations";
interface Props {
    outline: PdfOutlineNode[];
    onNavigateToDestination: (dest: PdfDestination) => void;
    onOpenExternal: (url: string) => void;
    onClose: () => void;
}
/**
 * Docked sidebar listing the PDF's own outline (table of contents). Entries
 * navigate through the same destination resolver used by in-page links.
 */
export default function PdfOutline({ outline, onNavigateToDestination, onOpenExternal, onClose, }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=PdfOutline.d.ts.map