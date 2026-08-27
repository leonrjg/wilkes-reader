import { type Ref } from "react";
import type { Extension } from "@codemirror/state";
import { type Decoration as ReaderDecoration } from "./decorations";
import type { ReaderSlots } from "./slots";
import type { ReaderHandle } from "./readerHandle";
export declare function getLanguageExtension(lang: string | null): Extension | null;
export interface CodeViewerProps {
    content: string;
    language: string | null;
    documentPath: string;
    restoreScrollPosition?: boolean;
    highlightLine: number;
    highlightRange: {
        start: number;
        end: number;
    };
    /** Host-owned marks. Only `range`-anchored decorations are placeable here;
     *  `rects` anchors belong to the PDF reader and are ignored. */
    decorations?: ReaderDecoration[];
    slots?: ReaderSlots;
    ref?: Ref<CodeReaderHandle>;
}
export interface CodeReaderHandle extends ReaderHandle {
    /** Scroll a 1-based source line to the centre of the viewport. */
    goToLine: (line: number) => void;
}
export default function CodeViewer({ content, language, documentPath, restoreScrollPosition, highlightLine, highlightRange, decorations, slots, ref, }: CodeViewerProps): import("react").JSX.Element;
//# sourceMappingURL=CodeViewer.d.ts.map