import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoundingBox } from "../documentCoordinates.js";
import type { PDFDocumentProxy } from "../pdfjs.js";
import { blankPageFlow, buildPageFlow, resolveDocumentFrame } from "./documentFrame.js";
import { buildExport, type PdfEditExport, type TypesetText } from "./editExport.js";
import { usableEdits, type PdfEditStore } from "./editStore.js";
import {
  applyEdits,
  createEdit,
  editBackdrops,
  editFragments,
  pagesOf,
  replacesItems,
  type Backdrop,
  type EditFragment,
  type ParagraphEdit,
} from "./edits.js";
import type { FlowItem, PageFlow, Placement } from "./flow.js";
import { useLiveFonts, type LiveFont, type ResolvePdfFont } from "./hostFonts.js";
import {
  adoptRuns,
  paragraphAfter,
  paragraphsOf,
  runningOnInto,
  runsToEdge,
  type Paragraph,
  type StyledRun,
} from "./paragraphs.js";
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
 *
 * What the reader has changed is also written to the host's store as it
 * changes, and taken up from there when the document is opened again.
 */

/** What a page shows. `placements` is null for a page no edit reaches, which is
 *  drawn exactly as the file has it. */
export interface PageView {
  flow: PageFlow | null;
  placements: Placement[] | null;
  /** What the edited paragraphs on this page stand on, drawn under them. */
  backdrops: Backdrop[];
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

/** A paragraph as the reader meets it: the page's, or the edit that stands in
 *  for it. An edit the reader made by pressing Enter has no paragraph of the
 *  page behind it at all. */
export interface Slot {
  paragraph: Paragraph;
  edit: ParagraphEdit | null;
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
  /** A page's paragraphs in reading order, wherever they are drawn now: its
   *  own, with an edit in place of each one changed, and the paragraphs the
   *  reader made among them. */
  slotsOf: (page: number) => Slot[];
  /** Cut a paragraph in two where the reader pressed Enter. */
  splitParagraph: (slot: Slot, before: StyledRun[], after: StyledRun[]) => void;
  /** The paragraph before (-1) or after (1) another in reading order, across
   *  columns and pages. Null at either end of the document, and where the next
   *  page has not been read yet -- which this then asks for. */
  neighbourOf: (slot: Slot, direction: -1 | 1) => Slot | null;
  /** Make one paragraph of `first`, `last` and every paragraph between them.
   *  It says `firstRuns` and then `lastRuns` -- what is to be left of the two
   *  ends -- and stands where `first` stood; the rest give up their places.
   *  `input` is a keystroke still to happen where the two meet. False when
   *  what lies between them has not all been read. */
  joinParagraphs: (
    first: Slot,
    last: Slot,
    firstRuns: StyledRun[],
    lastRuns: StyledRun[],
    input?: PendingInput | null,
  ) => boolean;
  locate: (itemId: string) => Located | null;
  fragmentsOf: (edit: ParagraphEdit) => EditFragment[];
  /** What is known of a font used on a page, by the name pdf.js loaded it as. */
  fontOf: (page: number, fontName: string) => FontInfo;
  /** The whole font the host resolved that one to, once it has. */
  liveFontOf: (page: number, fontName: string) => LiveFont | null;
  /** An edited paragraph offers to say what it shows, for as long as it is
   *  mounted. Returns the function that withdraws the offer. */
  registerTypesetter: (editId: string, typeset: () => TypesetText[]) => () => void;
  /** The document as edited, for a host to write to a file. Null when nothing
   *  has been changed. It first lays out every page the edits reach, however
   *  far past the screen that is, so it takes as long as that takes. Rejects
   *  when some edited text cannot be saved as it is shown -- its font has no
   *  whole font behind it -- or a page cannot be read. */
  exportEdits: () => Promise<PdfEditExport | null>;
  /** Say how far the reader is looking, so cascades are followed that far. */
  lookAhead: (page: number) => void;
  /** Give every changed paragraph back to the page. */
  discardEdits: () => void;
  beginEdit: (paragraph: Paragraph, handoff: Omit<Handoff, "editId">) => void;
  updateEdit: (id: string, patch: Partial<Pick<ParagraphEdit, "runs" | "lineCount" | "ascent">>) => void;
  removeEdit: (id: string) => void;
  handoff: Handoff | null;
  clearHandoff: () => void;
}

/** What a slot says now, as far as the session has been told. */
export const runsOfSlot = (slot: Slot) => slot.edit?.runs ?? slot.paragraph.runs;

/** Join a paragraph, given what it says now, to the one before it (-1) or
 *  after it (1): what deleting the break at its edge means. */
export function joinNeighbour(
  session: PdfEditSession,
  slot: Slot,
  direction: -1 | 1,
  runs: StyledRun[],
): boolean {
  const other = session.neighbourOf(slot, direction);
  if (!other) return false;
  const [first, last] = direction < 0 ? [other, slot] : [slot, other];
  const lastRuns = last === slot ? runs : runsOfSlot(last);
  let firstRuns = first === slot ? runs : runsOfSlot(first);
  // A paragraph the page broke across a column or a page is in two pieces
  // that were never two paragraphs: the join is in the middle of a sentence.
  if (!first.edit && runsToEdge(first.paragraph)) firstRuns = runningOnInto(firstRuns, lastRuns);
  return session.joinParagraphs(first, last, firstRuns, lastRuns);
}

const DEFAULT_FONT: FontInfo = { name: "", generic: "serif", bold: false, italic: false };

const NO_BACKDROPS: Backdrop[] = [];
/** How many pages past the one a cascade is waiting on are analysed with it. */
const ANALYSE_AHEAD = 2;

/** What names a paragraph across re-analysis: the first item it occupies. */
export const paragraphKey = (paragraph: Paragraph) => paragraph.itemIds[0];

export function usePdfEditSession(
  pdf: PDFDocumentProxy | null,
  pageSizes: ReadonlyArray<{ width: number; height: number }>,
  active: boolean,
  /** The host's way of finding a whole font. Without one, edited text is set
   *  in the page's embedded faces and cannot be exported. */
  resolveFont: ResolvePdfFont | undefined,
  /** What names the document in the host's store of unsaved edits. */
  documentKey: string,
  store: PdfEditStore | undefined,
  /** Areas the host knows are not prose -- formulas, tables. They move whole
   *  and are not offered as text to edit. */
  lockedAreas: ReadonlyArray<{ page: number; bbox: BoundingBox }> | undefined,
): PdfEditSession | null {
  const [analyses, setAnalyses] = useState<ReadonlyMap<number, PageAnalysis>>(() => new Map());
  const [edits, setEdits] = useState<readonly ParagraphEdit[]>([]);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const requested = useRef(new Set<number>());
  // How far past the edits their consequences are followed. It only grows:
  // what has been laid out stays laid out.
  const [horizon, setHorizon] = useState(0);
  const lookAhead = useCallback((page: number) => {
    setHorizon((current) => (page > current ? page : current));
  }, []);
  /** Whoever is waiting for the whole document to be laid out. */
  const waiting = useRef<Array<{ resolve: () => void; reject: (error: unknown) => void }>>([]);
  const typesetters = useRef(new Map<string, () => TypesetText[]>());
  const nextEditId = useRef(1);
  const documentPages = pageSizes.length;

  // A different document is a different session, starting from whatever the
  // reader had changed in it before.
  const pdfRef = useRef(pdf);
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    pdfRef.current = pdf;
    requested.current = new Set();
    setAnalyses(new Map());
    setHandoff(null);
    setHorizon(0);
    const draft = pdf ? (store?.read(documentKey) ?? null) : null;
    const kept = usableEdits(draft);
    const ids = kept.map(() => `edit-${nextEditId.current++}`);
    setEdits(
      kept.map(({ paragraph, runs, after, structural, absorbed }, index) => ({
        ...createEdit(ids[index], paragraph),
        runs,
        absorbed,
        after: after === undefined ? null : (ids[after] ?? null),
        structural: structural ?? false,
      })),
    );
    loadedKey.current = pdf ? documentKey : null;
  }, [pdf, documentKey, store]);

  // Written as it changes. Not before this document's own draft has been read:
  // the edits in state until then are the previous document's.
  useEffect(() => {
    if (!store || loadedKey.current !== documentKey) return;
    store.save(
      documentKey,
      edits.length > 0
        ? {
            version: 1,
            edits: edits.map(({ paragraph, runs, after, structural, absorbed }) => ({
              paragraph,
              runs,
              structural,
              absorbed,
              // By position: ids are made afresh each time a draft is taken up.
              ...(after === null ? {} : { after: edits.findIndex((edit) => edit.id === after) }),
            })),
          }
        : null,
    );
  }, [edits, documentKey, store]);

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
          // A layout that cannot be finished must not leave a save waiting.
          for (const waiter of waiting.current.splice(0)) waiter.reject(error);
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
        flow = buildPageFlow(
          page,
          analysis.layout,
          frame,
          (lockedAreas ?? []).filter((area) => area.page === page).map((area) => area.bbox),
        );
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

    /** Whether one item comes directly after another in the column of the page
     *  they were read from: nothing lies between them there. */
    const successors = new Map<number, Map<string, string | null>>();
    const successorsOn = (page: number) => {
      let onPage = successors.get(page);
      if (!onPage) {
        onPage = new Map();
        for (const region of flowOf(page)?.regions ?? []) {
          for (const column of region.columns) {
            column.items.forEach((item, index) => {
              onPage!.set(item.id, column.items[index + 1]?.id ?? null);
            });
          }
        }
        successors.set(page, onPage);
      }
      return onPage;
    };
    const followsOn = (page: number, previousId: string, nextId: string) =>
      successorsOn(page).get(previousId) === nextId;
    const follows = (previous: FlowItem, next: FlowItem): boolean =>
      previous.content.kind === "slice" &&
      next.content.kind === "slice" &&
      followsOn(previous.content.page, previous.id, next.id);
    const hasItems = (page: number, ids: readonly string[]) => {
      const onPage = successorsOn(page);
      return ids.every((id) => onPage.has(id));
    };

    return { flowOf, paragraphsOn, identityPlacements, follows, followsOn, hasItems };
  }, [analyses, pageSizes, documentPages, lockedAreas]);

  const reflow = useMemo(
    () =>
      reflowDocument(
        (page) => {
          const flow = model.flowOf(page);
          return flow && applyEdits(flow, edits);
        },
        edits.flatMap(pagesOf),
        documentPages,
        horizon,
      ),
    [model, edits, documentPages, horizon],
  );

  useEffect(() => {
    for (const page of reflow.missing) {
      // A cascade stops at the first page it cannot lay out, and will stop at
      // the one after it next. The next few are asked for with it.
      for (let ahead = page; ahead <= Math.min(page + ANALYSE_AHEAD, horizon, documentPages); ahead++) {
        requestAnalysis(ahead);
      }
      requestAnalysis(page);
    }
    if (reflow.missing.length === 0 && reflow.deferred.length === 0) {
      for (const waiter of waiting.current.splice(0)) waiter.resolve();
    }
  }, [reflow, requestAnalysis, horizon, documentPages]);

  // What a save reads once the layout is whole: by then the render that asked
  // for it is long gone, and so is everything it closed over.
  const latest = useRef({ reflow, model, edits, horizon });
  latest.current = { reflow, model, edits, horizon };

  // An edit names the paragraph it replaced. One taken up from a draft is only
  // as good as that paragraph still being on the page: a file changed on disk
  // since, or read differently by a later version of the analysis, no longer
  // has it, and laying the edit out anyway would drop text into the wrong
  // place. Such an edit is let go, and said to be.
  useEffect(() => {
    const unanchored = (edit: ParagraphEdit) =>
      edit.after !== null && !edits.some((other) => other.id === edit.after);
    const stale = edits.filter((edit) => {
      // What it absorbed must still be there to be left out.
      const adrift = edit.absorbed.some(
        (items) => analyses.has(items.page) && !model.hasItems(items.page, items.itemIds),
      );
      if (adrift) return true;
      // One that follows another edit goes when that edit has gone.
      if (!replacesItems(edit)) return unanchored(edit);
      if (!analyses.has(edit.paragraph.page)) return false;
      // Two paragraphs joined say what neither says on the page; what they
      // need is for every strip they replaced to still be there.
      if (edit.structural) return !model.hasItems(edit.paragraph.page, edit.paragraph.itemIds);
      const onPage = model
        .paragraphsOn(edit.paragraph.page)
        .find((paragraph) => paragraphKey(paragraph) === paragraphKey(edit.paragraph));
      return onPage?.text !== edit.paragraph.text;
    });
    if (stale.length === 0) return;
    console.warn(
      `PDF edit: ${stale.length} unsaved change(s) no longer match the document and were dropped`,
      stale.map((edit) => ({ page: edit.paragraph.page, was: edit.paragraph.text.slice(0, 60) })),
    );
    setEdits((current) => current.filter((edit) => !stale.includes(edit)));
  }, [edits, analyses, model]);

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
  // With an edit go the paragraphs the reader split off it: they were part of
  // what it said, and have nowhere to stand once it is the page's again.
  const removeEdit = useCallback<PdfEditSession["removeEdit"]>((id) => {
    setEdits((current) => {
      const gone = new Set([id]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const edit of current) {
          if (edit.after !== null && gone.has(edit.after) && !gone.has(edit.id)) {
            gone.add(edit.id);
            grew = true;
          }
        }
      }
      return current.filter((edit) => !gone.has(edit.id));
    });
  }, []);
  const clearHandoff = useCallback(() => setHandoff(null), []);
  const discardEdits = useCallback(() => setEdits([]), []);
  const registerTypesetter = useCallback<PdfEditSession["registerTypesetter"]>((editId, typeset) => {
    typesetters.current.set(editId, typeset);
    return () => {
      if (typesetters.current.get(editId) === typeset) typesetters.current.delete(editId);
    };
  }, []);

  // Every font the analysed pages use is resolved ahead of need, so the whole
  // font is already there when the first keystroke turns a paragraph live.
  const fontsInUse = useMemo(() => {
    const unique = new Map<string, FontInfo>();
    for (const analysis of analyses.values()) {
      for (const font of analysis.fonts.values()) unique.set(JSON.stringify(font), font);
    }
    return [...unique.values()];
  }, [analyses]);
  const liveFont = useLiveFonts(resolveFont, fontsInUse);

  return useMemo(() => {
    if (!pdf || !rasters) return null;
    const editByParagraph = new Map(
      edits.filter(replacesItems).map((edit) => [paragraphKey(edit.paragraph), edit]),
    );
    // Strips an edit stands in for. A paragraph joined into the one above it
    // is still a paragraph of its page, but there is nothing of it left to show.
    const replaced = new Set(
      edits.flatMap((edit) => [
        ...edit.paragraph.itemIds,
        ...edit.absorbed.flatMap((items) => items.itemIds),
      ]),
    );
    const followersOf = (id: string) => edits.filter((edit) => edit.after === id);

    const slotsOf = (page: number): Slot[] => {
      const slots: Slot[] = [];
      const withFollowers = (edit: ParagraphEdit) => {
        slots.push({ paragraph: edit.paragraph, edit });
        followersOf(edit.id).forEach(withFollowers);
      };
      const listed = new Set<string>();
      for (const paragraph of model.paragraphsOn(page)) {
        const edit = editByParagraph.get(paragraphKey(paragraph));
        if (edit) {
          listed.add(edit.id);
          withFollowers(edit);
        } else if (!paragraph.itemIds.some((id) => replaced.has(id))) {
          slots.push({ paragraph, edit: null });
        }
      }
      // An edit holds its paragraph as it was when taken over. Should a later
      // analysis group that page's lines differently, the edit still stands.
      for (const edit of edits) {
        if (replacesItems(edit) && edit.paragraph.page === page && !listed.has(edit.id)) {
          withFollowers(edit);
        }
      }
      return slots;
    };

    const sameSlot = (a: Slot, b: Slot) =>
      a.edit && b.edit ? a.edit.id === b.edit.id : !a.edit && !b.edit && paragraphKey(a.paragraph) === paragraphKey(b.paragraph);
    const newId = () => `edit-${nextEditId.current++}`;
    const textLength = (runs: readonly StyledRun[]) =>
      runs.reduce((total, run) => total + run.text.length, 0);

    const splitParagraph: PdfEditSession["splitParagraph"] = (slot, before, after) => {
      const first: ParagraphEdit = {
        ...(slot.edit ?? createEdit(newId(), slot.paragraph)),
        runs: before,
        structural: true,
        revision: (slot.edit?.revision ?? 0) + 1,
      };
      const second: ParagraphEdit = {
        ...createEdit(newId(), paragraphAfter(first.paragraph)),
        after: first.id,
        runs: after,
        structural: true,
      };
      setEdits((current) => [
        ...current
          .filter((edit) => edit.id !== first.id)
          // What followed the paragraph follows its second half now.
          .map((edit) => (edit.after === first.id ? { ...edit, after: second.id } : edit)),
        first,
        second,
      ]);
      setHandoff({ editId: second.id, anchor: 0, focus: 0, input: null });
    };

    /** The slots of the pages from one slot's to another's, in reading order.
     *  Null when a page among them has not been read. */
    const slotsAcross = (from: number, to: number): Slot[] | null => {
      const slots: Slot[] = [];
      for (let page = from; page <= to; page++) {
        if (page <= documentPages && !analyses.has(page)) {
          requestAnalysis(page);
          return null;
        }
        slots.push(...slotsOf(page));
      }
      return slots;
    };

    const neighbourOf: PdfEditSession["neighbourOf"] = (slot, direction) => {
      // A page can hold no paragraph at all -- a plate, a blank -- so the
      // neighbour is on the nearest page that has one.
      for (let page = slot.paragraph.page; page >= 1 && page <= documentPages; page += direction) {
        const [from, to] = direction < 0 ? [page, slot.paragraph.page] : [slot.paragraph.page, page];
        const slots = slotsAcross(from, to);
        if (!slots) return null;
        const other = slots[slots.findIndex((candidate) => sameSlot(candidate, slot)) + direction];
        if (other) return other;
      }
      return null;
    };

    const joinParagraphs: PdfEditSession["joinParagraphs"] = (first, last, firstRuns, lastRuns, input = null) => {
      const slots = slotsAcross(first.paragraph.page, last.paragraph.page);
      if (!slots) return false;
      const start = slots.findIndex((candidate) => sameSlot(candidate, first));
      const end = slots.findIndex((candidate) => sameSlot(candidate, last));
      if (start < 0 || end <= start) return false;
      const taken = slots.slice(start + 1, end + 1);

      // The result stands where the first stood and is set as it was set.
      // Everything after it gives up its place on the page: a paragraph of the
      // page by having its strips left out, one the reader made by going.
      const paragraph: Paragraph = { ...first.paragraph, styles: [...first.paragraph.styles] };
      const result: ParagraphEdit = {
        ...createEdit(newId(), paragraph),
        after: first.edit?.after ?? null,
        absorbed: [
          ...(first.edit?.absorbed ?? []),
          ...taken.flatMap((slot) => [
            ...(slot.paragraph.itemIds.length > 0
              ? [{ page: slot.paragraph.page, itemIds: slot.paragraph.itemIds }]
              : []),
            ...(slot.edit?.absorbed ?? []),
          ]),
        ],
        runs: [...firstRuns, ...adoptRuns(paragraph.styles, last.paragraph.styles, lastRuns)],
        structural: true,
        lineCount:
          (first.edit?.lineCount ?? first.paragraph.lineCount) +
          (last.edit?.lineCount ?? last.paragraph.lineCount),
      };
      const gone = new Set([first, ...taken].flatMap((slot) => (slot.edit ? [slot.edit.id] : [])));
      setEdits((current) => [
        ...current
          .filter((edit) => !gone.has(edit.id))
          // What followed the last of them follows the one they have become.
          .map((edit) => (edit.after !== null && gone.has(edit.after) ? { ...edit, after: result.id } : edit)),
        result,
      ]);
      const seam = textLength(firstRuns);
      setHandoff({ editId: result.id, anchor: seam, focus: seam, input });
      return true;
    };
    // One list for every page: a page's view is asked for on each of its
    // renders, and must be handed the same array until the layout changes.
    const backdrops = new Map<number, Backdrop[]>();
    for (const backdrop of edits.flatMap((edit) => editBackdrops(edit, reflow.plans))) {
      const onPage = backdrops.get(backdrop.page);
      if (onPage) onPage.push(backdrop);
      else backdrops.set(backdrop.page, [backdrop]);
    }

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
        backdrops: backdrops.get(page) ?? NO_BACKDROPS,
      }),

      slotsOf,
      splitParagraph,
      neighbourOf,
      joinParagraphs,
      locate,

      fragmentsOf: (edit) => editFragments(edit, reflow.plans),
      fontOf: (page, fontName) => analyses.get(page)?.fonts.get(fontName) ?? DEFAULT_FONT,
      liveFontOf: (page, fontName) => {
        const font = analyses.get(page)?.fonts.get(fontName);
        return font ? liveFont(font) : null;
      },
      registerTypesetter,
      discardEdits,

      lookAhead,

      exportEdits: async () => {
        if (latest.current.edits.length === 0) return null;
        const whole = () =>
          latest.current.horizon === Infinity &&
          latest.current.reflow.missing.length === 0 &&
          latest.current.reflow.deferred.length === 0;
        if (!whole()) {
          await new Promise<void>((resolve, reject) => {
            waiting.current.push({ resolve, reject });
            setHorizon(Infinity);
          });
        }
        const { reflow: complete, model: read, edits: current } = latest.current;
        const text = [...typesetters.current.values()].flatMap((typeset) => typeset());
        const standing = new Map<number, Backdrop[]>();
        for (const backdrop of current.flatMap((edit) => editBackdrops(edit, complete.plans))) {
          standing.set(backdrop.page, [...(standing.get(backdrop.page) ?? []), backdrop]);
        }
        return buildExport(complete.plans, read.flowOf, read.follows, text, standing);
      },

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
    liveFont,
    registerTypesetter,
    discardEdits,
    lookAhead,
  ]);
}
