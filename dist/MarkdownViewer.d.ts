import { type Ref } from "react";
import type { ByteRange } from "./documentCoordinates";
import { type Decoration } from "./decorations";
import type { ReaderSlots } from "./slots";
import type { FindableReaderHandle, ZoomableReaderHandle } from "./readerHandle";
export interface MarkdownReaderHandle extends FindableReaderHandle, ZoomableReaderHandle {
}
export interface MarkdownViewerProps {
    content: string;
    documentPath: string;
    restoreScrollPosition?: boolean;
    highlightRange: ByteRange;
    /** Host-owned marks. Only `range`-anchored decorations are placeable here;
     *  `rects` anchors belong to the PDF reader and are ignored. */
    decorations?: Decoration[];
    slots?: ReaderSlots;
    ref?: Ref<MarkdownReaderHandle>;
}
export default function MarkdownViewer({ content, documentPath, restoreScrollPosition, highlightRange, decorations, slots, ref, }: MarkdownViewerProps): import("react").JSX.Element;
//# sourceMappingURL=MarkdownViewer.d.ts.map