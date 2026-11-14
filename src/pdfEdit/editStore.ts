import type { Paragraph, StyledRun } from "./paragraphs.js";

/**
 * What a reader has changed in a document and not yet saved as a file.
 *
 * Edits are a statement about how a document should be drawn, not a change to
 * it, so they have to be kept somewhere or they end with the tab. The reader
 * reads and writes them; how long they are kept is the host's decision, as it
 * is for where each document was left.
 */
export interface PdfEditDraft {
  version: 1;
  edits: DraftEdit[];
}

/** One changed paragraph: what it was on the page, and what it says now. The
 *  paragraph is kept whole because it is the evidence the edit still applies:
 *  a draft is only taken up again where the page still has that paragraph. */
export interface DraftEdit {
  paragraph: Paragraph;
  runs: StyledRun[];
}

export interface PdfEditStore {
  /** Keyed by `pdfDocumentKey(source)`, as the reader's positions are. */
  read(documentKey: string): PdfEditDraft | null;
  /** `null` when nothing is changed any more. */
  save(documentKey: string, draft: PdfEditDraft | null): void;
}

/**
 * The edits of a draft that this version of the reader can take up.
 *
 * A draft is written by one run of the application and read by another, which
 * may be a later version with more to say about a paragraph than the one that
 * wrote it. An edit missing what is now needed cannot be laid out; it is let
 * go here, and said to be, rather than failing somewhere inside the layout.
 */
export function usableEdits(draft: PdfEditDraft | null): DraftEdit[] {
  if (!draft) return [];
  const usable = draft.edits.filter(isUsable);
  if (usable.length < draft.edits.length) {
    console.warn(
      `PDF edit: ${draft.edits.length - usable.length} unsaved change(s) were written by a version of the reader this one cannot read, and were dropped`,
    );
  }
  return usable;
}

function isUsable(edit: DraftEdit): boolean {
  const paragraph = edit?.paragraph as Partial<Paragraph> | undefined;
  const box = paragraph?.area;
  return (
    Array.isArray(edit?.runs) &&
    paragraph !== undefined &&
    Number.isInteger(paragraph.page) &&
    Array.isArray(paragraph.itemIds) &&
    paragraph.itemIds.length > 0 &&
    Array.isArray(paragraph.lines) &&
    Array.isArray(paragraph.styles) &&
    paragraph.styles[paragraph.baseStyle ?? -1] !== undefined &&
    typeof paragraph.text === "string" &&
    [paragraph.lineHeight, paragraph.firstBaseline, paragraph.lineCount, paragraph.fontSize].every(Number.isFinite) &&
    box !== undefined &&
    [box.x, box.y, box.width, box.height].every(Number.isFinite)
  );
}

/** Edits kept for as long as the page is. */
export function createMemoryPdfEditStore(): PdfEditStore {
  const drafts = new Map<string, PdfEditDraft>();
  return {
    read: (documentKey) => drafts.get(documentKey) ?? null,
    save: (documentKey, draft) => {
      if (draft) drafts.set(documentKey, draft);
      else drafts.delete(documentKey);
    },
  };
}
