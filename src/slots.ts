import type { ReactNode } from "react";
import type { DocumentSelection } from "./selection.js";

/** What the reader hands a selection slot so the host's chrome can behave. */
export interface SelectionSlotApi {
  /** Hide the chrome, leaving the text selected. */
  dismiss: () => void;
  /** Hide the chrome and clear the underlying selection. */
  clear: () => void;
  /** While pinned, the reader will not dismiss the chrome when the document
   *  selection collapses. Host chrome that takes focus (a text input, a
   *  submenu) must pin itself, or the act of focusing it destroys it. */
  setPinned: (pinned: boolean) => void;
}

/** Host chrome for the current selection. The reader positions it against the
 *  end of the selection and owns dismissal; the host owns the content. */
export type SelectionActionsSlot = (
  selection: DocumentSelection,
  api: SelectionSlotApi,
) => ReactNode;

/** Host content laid out beside one page, aligned to that page's top-left. */
export type PageGutterSlot = (
  page: number,
  ctx: { scale: number; width: number; height: number },
) => ReactNode;

/** A column of host content running down the outside of every page.
 *
 *  The width is declared rather than left to the content because the reader
 *  has to *reserve* it: the page is drawn into what is left of the canvas
 *  after the gutter is taken out, so the two together fill the reader and the
 *  gutter pads the page instead of hanging off its right edge. A gutter the
 *  reader did not know the width of could only be positioned outside the
 *  scrollable extent, where it is clipped, and where zooming the page walks it
 *  off screen -- which is why the width is part of the declaration and not an
 *  optional hint beside it. */
export interface PageGutter {
  /** CSS px taken out of the canvas for this column, at every zoom. Fixed
   *  rather than scaled: the column holds host chrome, and chrome that grew
   *  with the page would leave less room for the page the more you zoomed. */
  width: number;
  render: PageGutterSlot;
}

export interface ReaderSlots {
  selectionActions?: SelectionActionsSlot;
  /** Extra controls, rendered inside the reader's floating control cluster
   *  ahead of the zoom controls. */
  toolbar?: ReactNode;
}

export interface PdfReaderSlots extends ReaderSlots {
  pageGutter?: PageGutter;
}
