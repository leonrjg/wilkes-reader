import { type ReactElement } from "react";
import { type RenderOptions, type RenderResult } from "@testing-library/react";
import { type Mock } from "vitest";
import { type ReaderHostServices } from "../ReaderHost";
import type { DocumentSelection } from "../selection";
import type { SelectionActionsSlot } from "../slots";
/** The one capability the readers ask a host to perform. */
export declare const openExternalSpy: Mock;
/**
 * Render a reader with a host, and let the test change that host afterwards --
 * appearance is something a real host changes at runtime, so a reader's
 * response to it has to be testable without re-mounting.
 */
export declare function renderWithReaderHost(ui: ReactElement, options?: Omit<RenderOptions, "wrapper"> & {
    host?: Partial<ReaderHostServices>;
}): RenderResult & {
    setHost: (patch: Partial<ReaderHostServices>) => void;
};
/**
 * Stand-in host chrome for the selection slot. Deliberately not any real
 * application's menu: what a reader owes the slot is a position, a selection
 * and a working pin, and those are what this exercises.
 */
export declare function stubSelectionSlot(handlers?: {
    onAction?: (selection: DocumentSelection) => void;
}): SelectionActionsSlot;
//# sourceMappingURL=readerHarness.d.ts.map