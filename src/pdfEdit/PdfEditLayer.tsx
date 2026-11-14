import { useRef } from "react";
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

interface PdfEditLayerProps {
  session: PdfEditSession;
  /** The pages on screen. */
  pages: number[];
  geometryOf: (page: number) => PageGeometry | null;
}

export default function PdfEditLayer({ session, pages, geometryOf }: PdfEditLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);

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
      {mounted.flatMap((page) => {
        const paragraphs = session.paragraphsOf(page);
        const listed = new Set(paragraphs.map(paragraphKey));
        // An edit holds the paragraph as it was when taken over. Should a later
        // analysis group that page's lines differently, the edit still stands.
        const orphaned = session.edits.filter(
          (edit) => edit.paragraph.page === page && !listed.has(paragraphKey(edit.paragraph)),
        );
        return [
          ...paragraphs.map((paragraph) => {
            const edit = session.editOf(paragraph);
            if (edit) {
              return <LiveParagraph key={edit.id} session={session} edit={edit} geometryOf={geometryOf} />;
            }
            if (!inView.has(page)) return null;
            return (
              <PageParagraph
                key={paragraphKey(paragraph)}
                session={session}
                paragraph={paragraph}
                geometryOf={geometryOf}
              />
            );
          }),
          ...orphaned.map((edit) => (
            <LiveParagraph key={edit.id} session={session} edit={edit} geometryOf={geometryOf} />
          )),
        ];
      })}
    </div>
  );
}
