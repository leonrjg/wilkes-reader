import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoundingBox } from "../documentCoordinates.js";
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

/** A paragraph under the pointer, and where it is on the page being shown. */
export interface ParagraphHit {
  paragraph: Paragraph;
  box: BoundingBox;
}

/** Where to put the caret in an edit that was just opened by a click. */
export interface FocusRequest {
  editId: string;
  clientX: number;
  clientY: number;
}

export interface PdfEditSession {
  /** The document's pages, plus any the edits pushed content onto. */
  pageCount: number;
  documentPages: number;
  rasters: PageRasters;
  edits: readonly ParagraphEdit[];
  requestAnalysis: (page: number) => void;
  pageView: (page: number) => PageView;
  paragraphAt: (page: number, x: number, y: number) => ParagraphHit | null;
  fragmentsOf: (edit: ParagraphEdit) => EditFragment[];
  fontOf: (edit: ParagraphEdit) => FontInfo;
  beginEdit: (paragraph: Paragraph, color: string, at: { clientX: number; clientY: number }) => void;
  updateEdit: (id: string, patch: Partial<Pick<ParagraphEdit, "text" | "lineCount" | "ascent">>) => void;
  removeEdit: (id: string) => void;
  focusRequest: FocusRequest | null;
  clearFocusRequest: () => void;
}

const DEFAULT_FONT: FontInfo = { fallback: "serif", bold: false, italic: false };
/** How far outside a strip a click still counts as on it, in page units: the
 *  space between two lines belongs to the paragraph they are in. */
const HIT_SLOP = 2;

export function usePdfEditSession(
  pdf: PDFDocumentProxy | null,
  pageSizes: ReadonlyArray<{ width: number; height: number }>,
  active: boolean,
): PdfEditSession | null {
  const [analyses, setAnalyses] = useState<ReadonlyMap<number, PageAnalysis>>(() => new Map());
  const [edits, setEdits] = useState<readonly ParagraphEdit[]>([]);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
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
    setFocusRequest(null);
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
    const paragraphs = new Map<number, Map<string, Paragraph>>();
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

    const paragraphOf = (page: number, itemId: string): Paragraph | null => {
      let byItem = paragraphs.get(page);
      if (!byItem) {
        byItem = new Map();
        const flow = flowOf(page);
        const analysis = analyses.get(page);
        if (flow && analysis) {
          for (const paragraph of paragraphsOf(flow, analysis.runs)) {
            for (const id of paragraph.itemIds) byItem.set(id, paragraph);
          }
        }
        paragraphs.set(page, byItem);
      }
      return byItem.get(itemId) ?? null;
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

    return { flowOf, paragraphOf, identityPlacements };
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
  const beginEdit = useCallback<PdfEditSession["beginEdit"]>((paragraph, color, at) => {
    const id = `edit-${nextEditId.current++}`;
    setEdits((current) => [...current, createEdit(id, paragraph, color)]);
    setFocusRequest({ editId: id, ...at });
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
  const clearFocusRequest = useCallback(() => setFocusRequest(null), []);

  return useMemo(() => {
    if (!pdf || !rasters) return null;
    const editedItems = new Set(edits.flatMap((edit) => edit.paragraph.itemIds));

    const placementsOf = (page: number): Placement[] =>
      reflow.plans.get(page)?.placements ?? model.identityPlacements(page);

    return {
      pageCount: reflow.lastPage,
      documentPages,
      rasters,
      edits,
      requestAnalysis,
      focusRequest,
      clearFocusRequest,

      pageView: (page) => ({
        flow: model.flowOf(page),
        placements: reflow.plans.get(page)?.placements ?? null,
      }),

      paragraphAt: (page, x, y) => {
        const placements = placementsOf(page);
        const under = placements.find(
          ({ item, x: left, y: top, width }) =>
            item.content.kind === "slice" &&
            x >= left && x <= left + width &&
            y >= top - HIT_SLOP && y <= top + item.height + HIT_SLOP,
        );
        if (!under || under.item.content.kind !== "slice" || editedItems.has(under.item.id)) {
          return null;
        }
        const paragraph = model.paragraphOf(under.item.content.page, under.item.id);
        if (!paragraph) return null;
        const mine = placements.filter(({ item }) => paragraph.itemIds.includes(item.id));
        const top = Math.min(...mine.map((placement) => placement.y));
        const bottom = Math.max(...mine.map((placement) => placement.y + placement.item.height));
        return {
          paragraph,
          box: { x: under.x + paragraph.inset, y: top, width: paragraph.width, height: bottom - top },
        };
      },

      fragmentsOf: (edit) => editFragments(edit, reflow.plans),
      fontOf: (edit) =>
        analyses.get(edit.paragraph.page)?.fonts.get(edit.paragraph.fontName) ?? DEFAULT_FONT,

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
    focusRequest,
    clearFocusRequest,
    beginEdit,
    updateEdit,
    removeEdit,
  ]);
}
