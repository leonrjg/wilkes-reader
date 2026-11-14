import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../pdfjs.js";
import { blankPageFlow, buildPageFlow, resolveDocumentFrame } from "./documentFrame.js";
import { applyEdits, createEdit, editFragments, type EditFragment, type ParagraphEdit } from "./edits.js";
import type { PageFlow, Placement } from "./flow.js";
import { paragraphsOf, type Paragraph } from "./paragraphs.js";
import { analysePage, PageRasters, type FontInfo, type PageAnalysis } from "./pdfPageSource.js";
import { layoutPage, reflowDocument } from "./reflow.js";

/**
 * One document's editing state, and the layout that follows from it.
 *
 * The session is the only stateful part of the editor. It holds two things --
 * what has been learned about the pages, and what the reader has changed --
 * and derives everything else from them on every render: the document frame,
 * each page's flow, the reflow, where each edit's lines landed. Nothing derived
 * is stored, so nothing derived can go stale.
 *
 * Pages are analysed on demand. A cascade that reaches a page nobody has looked
 * at yet stops there, asks for it, and resumes when it arrives.
 */

/** What a page shows. `placements` is null for a page no edit reaches, which is
 *  drawn exactly as the file has it. */
export interface PageView {
  flow: PageFlow | null;
  placements: Placement[] | null;
}

/** What to do in a paragraph the moment it becomes live text: the keystroke
 *  that made it one has not happened yet, and has to happen there. */
export type PendingInput = { kind: "insert"; text: string } | { kind: "delete" };

/** A paragraph handed over from the page's rendering to live text. The caret
 *  was over the page; it has to reappear at the same place in the text. */
export interface Handoff {
  editId: string;
  /** The selection to restore, as offsets into the paragraph's text. */
  anchor: number;
  focus: number;
  input: PendingInput | null;
}

/** Where an item of the page is now. */
export interface Located {
  page: number;
  x: number;
  y: number;
}

export interface PdfEditSession {
  /** The document's pages, plus any the edits pushed content onto. */
  pageCount: number;
  documentPages: number;
  rasters: PageRasters;
  edits: readonly ParagraphEdit[];
  requestAnalysis: (page: number) => void;
  pageView: (page: number) => PageView;
  /** A page's own paragraphs in reading order, wherever they are drawn now. */
  paragraphsOf: (page: number) => Paragraph[];
  editOf: (paragraph: Paragraph) => ParagraphEdit | null;
  locate: (itemId: string) => Located | null;
  fragmentsOf: (edit: ParagraphEdit) => EditFragment[];
  /** What is known of a font used on a page, by the name pdf.js loaded it as. */
  fontOf: (page: number, fontName: string) => FontInfo;
  beginEdit: (paragraph: Paragraph, handoff: Omit<Handoff, "editId">) => void;
  updateEdit: (id: string, patch: Partial<Pick<ParagraphEdit, "runs" | "lineCount" | "ascent">>) => void;
  removeEdit: (id: string) => void;
  handoff: Handoff | null;
  clearHandoff: () => void;
}

const DEFAULT_FONT: FontInfo = { name: "", fallback: "serif", bold: false, italic: false };

/** What names a paragraph across re-analysis: the first item it occupies. */
export const paragraphKey = (paragraph: Paragraph) => paragraph.itemIds[0];

export function usePdfEditSession(
  pdf: PDFDocumentProxy | null,
  pageSizes: ReadonlyArray<{ width: number; height: number }>,
  active: boolean,
): PdfEditSession | null {
  const [analyses, setAnalyses] = useState<ReadonlyMap<number, PageAnalysis>>(() => new Map());
  const [edits, setEdits] = useState<readonly ParagraphEdit[]>([]);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const requested = useRef(new Set<number>());
  const nextEditId = useRef(1);
  const documentPages = pageSizes.length;

  // A different document is a different session.
  const pdfRef = useRef(pdf);
  useEffect(() => {
    pdfRef.current = pdf;
    requested.current = new Set();
    setAnalyses(new Map());
    setEdits([]);
    setHandoff(null);
  }, [pdf]);

  // Rasters are megabytes each and only edit mode composes from them.
  const rasters = useMemo(() => (pdf && active ? new PageRasters(pdf) : null), [pdf, active]);
  useEffect(() => () => rasters?.dispose(), [rasters]);

  const requestAnalysis = useCallback(
    (page: number) => {
      if (!pdf || page < 1 || page > pdf.numPages || requested.current.has(page)) return;
      requested.current.add(page);
      analysePage(pdf, page).then(
        (analysis) => {
          if (pdfRef.current !== pdf) return;
          setAnalyses((known) => new Map(known).set(page, analysis));
        },
        (error) => {
          // Left out of `requested` so a later look at the page tries again.
          requested.current.delete(page);
          console.error(`PDF edit: analysing page ${page} failed:`, error);
        },
      );
    },
    [pdf],
  );

  // Everything known about the pages, as flows. Rebuilt whole when a page's
  // analysis lands, because what one page says can change another's: a running
  // head is only recognised as one once a second page has it too.
  const model = useMemo(() => {
    const frame = resolveDocumentFrame(
      new Map([...analyses].map(([page, analysis]) => [page, analysis.layout])),
    );
    const flows = new Map<number, PageFlow>();
    const paragraphs = new Map<number, Paragraph[]>();
    const identity = new Map<number, Placement[]>();

    const flowOf = (page: number): PageFlow | null => {
      const known = flows.get(page);
      if (known) return known;
      let flow: PageFlow;
      if (page > documentPages) {
        const size = pageSizes[documentPages - 1];
        if (!size || !frame.body) return null;
        flow = blankPageFlow(page, size, frame.body, "white");
      } else {
        const analysis = analyses.get(page);
        if (!analysis) return null;
        flow = buildPageFlow(page, analysis.layout, frame);
      }
      flows.set(page, flow);
      return flow;
    };

    const paragraphsOn = (page: number): Paragraph[] => {
      let list = paragraphs.get(page);
      if (!list) {
        const flow = flowOf(page);
        const analysis = analyses.get(page);
        list = flow && analysis ? paragraphsOf(flow, analysis.runs) : [];
        paragraphs.set(page, list);
      }
      return list;
    };

    /** Where a page no edit reaches has its items: where the file drew them. */
    const identityPlacements = (page: number): Placement[] => {
      let placements = identity.get(page);
      if (!placements) {
        const flow = flowOf(page);
        placements = flow ? layoutPage(flow, []).placements : [];
        identity.set(page, placements);
      }
      return placements;
    };

    return { flowOf, paragraphsOn, identityPlacements };
  }, [analyses, pageSizes, documentPages]);

  const reflow = useMemo(
    () =>
      reflowDocument(
        (page) => {
          const flow = model.flowOf(page);
          return flow && applyEdits(flow, edits);
        },
        edits.map((edit) => edit.paragraph.page),
        documentPages,
      ),
    [model, edits, documentPages],
  );

  useEffect(() => {
    reflow.missing.forEach(requestAnalysis);
  }, [reflow, requestAnalysis]);

  // Stable, because the editable blocks hold them across renders: one that
  // changed identity with every keystroke would re-run the effects that write
  // and read back the text under the caret.
  const beginEdit = useCallback<PdfEditSession["beginEdit"]>((paragraph, handoff) => {
    const id = `edit-${nextEditId.current++}`;
    setEdits((current) => [...current, createEdit(id, paragraph)]);
    setHandoff({ editId: id, ...handoff });
  }, []);
  const updateEdit = useCallback<PdfEditSession["updateEdit"]>((id, patch) => {
    setEdits((current) => {
      const edit = current.find((candidate) => candidate.id === id);
      if (!edit) return current;
      const keys = Object.keys(patch) as Array<keyof typeof patch>;
      // Unchanged is the common case -- most keystrokes do not add a line --
      // and returning the same list is what spares a reflow for each of them.
      if (keys.every((key) => edit[key] === patch[key])) return current;
      return current.map((candidate) => (candidate === edit ? { ...edit, ...patch } : candidate));
    });
  }, []);
  const removeEdit = useCallback<PdfEditSession["removeEdit"]>((id) => {
    setEdits((current) => current.filter((edit) => edit.id !== id));
  }, []);
  const clearHandoff = useCallback(() => setHandoff(null), []);

  return useMemo(() => {
    if (!pdf || !rasters) return null;
    const editByParagraph = new Map(edits.map((edit) => [paragraphKey(edit.paragraph), edit]));

    // Where every item of the analysed pages is now. Built on first use: most
    // renders ask about a handful of paragraphs, and many ask about none.
    let located: Map<string, Located> | null = null;
    const locate = (itemId: string): Located | null => {
      if (!located) {
        located = new Map();
        for (const page of new Set([...analyses.keys(), ...reflow.plans.keys()])) {
          const placements = reflow.plans.get(page)?.placements ?? model.identityPlacements(page);
          for (const { item, x, y } of placements) located.set(item.id, { page, x, y });
        }
      }
      return located.get(itemId) ?? null;
    };

    return {
      pageCount: reflow.lastPage,
      documentPages,
      rasters,
      edits,
      requestAnalysis,
      handoff,
      clearHandoff,

      pageView: (page) => ({
        flow: model.flowOf(page),
        placements: reflow.plans.get(page)?.placements ?? null,
      }),

      paragraphsOf: model.paragraphsOn,
      editOf: (paragraph) => editByParagraph.get(paragraphKey(paragraph)) ?? null,
      locate,

      fragmentsOf: (edit) => editFragments(edit, reflow.plans),
      fontOf: (page, fontName) => analyses.get(page)?.fonts.get(fontName) ?? DEFAULT_FONT,

      beginEdit,
      updateEdit,
      removeEdit,
    };
  }, [
    pdf,
    rasters,
    edits,
    reflow,
    model,
    analyses,
    documentPages,
    requestAnalysis,
    handoff,
    clearHandoff,
    beginEdit,
    updateEdit,
    removeEdit,
  ]);
}
