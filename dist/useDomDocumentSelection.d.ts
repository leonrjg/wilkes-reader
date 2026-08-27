import { type RefObject } from "react";
import type { DocumentSelection, PositionedSelection } from "./selection";
interface Options {
    rootRef: RefObject<HTMLElement | null>;
    mapSelection: (range: Range, selection: Selection) => DocumentSelection | null;
    /** Dismiss the selection chrome as soon as the document selection collapses.
     *  Suspended while the host has pinned itself. */
    dismissOnCollapsedSelection?: boolean;
}
export declare function useDomDocumentSelection({ rootRef, mapSelection, dismissOnCollapsedSelection, }: Options): {
    positioned: PositionedSelection | null;
    readSelection: () => void;
    dismiss: () => void;
    clearSelection: () => void | undefined;
    slotApi: import("./slots").SelectionSlotApi;
};
export {};
//# sourceMappingURL=useDomDocumentSelection.d.ts.map