import type { SelectionSlotApi } from "./slots";
/**
 * The reader half of the selection slot: dismissal and pinning.
 *
 * Pinning is the reader's business, not the host's, because only the reader
 * knows what would otherwise dismiss the chrome. The host merely declares "I am
 * taking focus"; whether that matters is for the reader to decide.
 *
 * The returned `api` is stable for the life of the reader. Host chrome holds it
 * in effect dependencies, so an identity that changed per render would re-run
 * those effects every render. The handlers are read through a ref to keep it
 * stable, and the pin is a ref rather than state because nothing renders from
 * it -- it is only ever read by an event handler.
 */
export declare function useSelectionSlot(handlers: {
    dismiss: () => void;
    clear: () => void;
}): {
    api: SelectionSlotApi;
    pinnedRef: import("react").RefObject<boolean>;
};
//# sourceMappingURL=selectionSlot.d.ts.map