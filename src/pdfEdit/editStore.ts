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
