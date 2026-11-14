import { useEffect, useRef } from "react";
import { travelOnArrow } from "./caretTravel.js";
import LiveParagraph from "./LiveParagraph.js";
import PageParagraph from "./PageParagraph.js";
import { paragraphKey, type PdfEditSession } from "./usePdfEditSession.js";

/**
 * The text of the document, as something to type in.
 *
 * One layer over the whole scrolled document rather than one per page, because
 * the pages are virtualized and a paragraph can belong to two of them. It
 * holds every paragraph of the pages in view, in reading order: those nobody
 * has changed as invisible text over the page's own rendering, and those
 * somebody has as live text. To the reader they are one surface -- a caret
 * goes wherever there is text, and an arrow key at the edge of one paragraph
 * carries it into the next.
 */

/** Where a page is in the scrolled content, and how large it is drawn. */
export interface PageGeometry {
  /** CSS px from the content's top to the page's top. */
  top: number;
  /** CSS px per page unit. */
  scale: number;
}

/** How far past the last page on screen a cascade is followed. */
const LOOK_AHEAD_PAGES = 2;

interface PdfEditLayerProps {
  session: PdfEditSession;
  /** The pages on screen. */
  pages: number[];
  geometryOf: (page: number) => PageGeometry | null;
}

export default function PdfEditLayer({ session, pages, geometryOf }: PdfEditLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);

  // An edit's consequences are followed a little past what is on screen, so
  // the page about to scroll into view is already as it should be.
  const { lookAhead } = session;
  const furthest = pages.length > 0 ? Math.max(...pages) : 0;
  useEffect(() => lookAhead(furthest + LOOK_AHEAD_PAGES), [lookAhead, furthest]);

  // A page's paragraphs can have been pushed onto the page after it, so what
  // is drawn on the first page in view may belong to the one before.
  const inView = new Set(pages);
  if (pages.length > 0) inView.add(Math.min(...pages) - 1);
  // Edited paragraphs stay mounted wherever they are: their text and their
  // undo history live in the DOM.
  const edited = new Set(session.edits.map((edit) => edit.paragraph.page));
  const mounted = [...new Set([...inView, ...edited])].sort((a, b) => a - b);

  return (
    <div
      ref={layerRef}
      className="pdf-edit-layer"
      onKeyDown={(event) => travelOnArrow(event, layerRef.current)}
    >
      {mounted.flatMap((page) =>
        session.slotsOf(page).map((slot) => {
          if (slot.edit) {
            return (
              <LiveParagraph key={slot.edit.id} session={session} edit={slot.edit} geometryOf={geometryOf} />
            );
          }
          if (!inView.has(page)) return null;
          return (
            <PageParagraph
              key={paragraphKey(slot.paragraph)}
              session={session}
              paragraph={slot.paragraph}
              geometryOf={geometryOf}
            />
          );
        }),
      )}
    </div>
  );
}
