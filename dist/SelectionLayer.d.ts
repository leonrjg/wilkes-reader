import type { PositionedSelection } from "./selection";
import type { SelectionActionsSlot, SelectionSlotApi } from "./slots";
/**
 * Positions whatever the host put in the `selectionActions` slot against the
 * end of the current selection. Shared by every reader so the popover lands in
 * the same place whatever is being read, and so each reader's own selection
 * plumbing stops re-deriving it.
 */
export default function SelectionLayer({ positioned, api, slot, }: {
    positioned: PositionedSelection | null;
    api: SelectionSlotApi;
    slot?: SelectionActionsSlot;
}): import("react").JSX.Element | null;
//# sourceMappingURL=SelectionLayer.d.ts.map