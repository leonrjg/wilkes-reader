import type { BoundingBox } from "../documentCoordinates.js";
import type { Backdrop } from "./edits.js";
import type { FlowItem, PageFlow, Placement } from "./flow.js";
import type { PagePlan } from "./reflow.js";

/**
 * The edited document, as something that can be written to a file.
 *
 * The editor is the authority on where everything went: it broke the lines and
 * it laid out the pages. A saved copy is therefore not computed again by
 * whoever writes it -- it is this, the result, stated as plainly as possible:
 * for each page that changed, which areas of which source pages are drawn
 * where, and which runs of text sit on which baselines.
 */
export interface PdfEditExport {
  pages: ExportPage[];
}

/** One changed page. Everything is in the page's own units, origin top-left. */
export interface ExportPage {
  /** 1-based. Past the document's last page, it is a page to append. */
  page: number;
  width: number;
  height: number;
  strips: ExportStrip[];
  text: ExportText[];
}

/** An area of a source page, drawn on this page. */
export interface ExportStrip {
  source: number;
  rect: BoundingBox;
  x: number;
  y: number;
  /** Drawn without its text: what an edited paragraph stood on. */
  graphicsOnly?: boolean;
}

/** A run of text on one baseline, in one font. */
export interface ExportText {
  x: number;
  baseline: number;
  text: string;
  /** The id the host resolved this text's font to. */
  font: string;
  size: number;
  color: [number, number, number];
}

/** Text as an edited paragraph's live DOM set it, before it is sorted onto
 *  pages. */
export interface TypesetText extends ExportText {
  page: number;
}

/** Positions are sums of measured heights: this close is the same place. */
const EPSILON = 0.01;

/**
 * @param follows Whether `next` is the item directly after `previous` in the
 *                column of the page they were read from.
 */
export function buildExport(
  plans: ReadonlyMap<number, PagePlan>,
  flowOf: (page: number) => PageFlow | null,
  follows: (previous: FlowItem, next: FlowItem) => boolean,
  text: readonly TypesetText[],
  backdrops: ReadonlyMap<number, readonly Backdrop[]> = new Map(),
): PdfEditExport {
  const pages: ExportPage[] = [];
  for (const plan of [...plans.values()].sort((a, b) => a.page - b.page)) {
    const flow = flowOf(plan.page);
    if (!flow) throw new Error(`PDF edit: page ${plan.page} has a layout but no flow to export`);
    pages.push({
      page: plan.page,
      width: flow.width,
      height: flow.height,
      strips: [
        ...flow.fixed.map((rect) => ({ source: plan.page, rect, x: rect.x, y: rect.y })),
        ...(backdrops.get(plan.page) ?? []).map(({ source, x, y }) => ({
          source: source.page,
          rect: source.rect,
          x,
          y,
          graphicsOnly: true,
        })),
        ...mergedStrips(plan.placements, follows),
      ],
      text: text
        .filter((chunk) => chunk.page === plan.page)
        .map(({ page: _page, ...chunk }) => chunk),
    });
  }
  return { pages };
}

/** A page's placed strips, with runs of lines that stayed together joined into
 *  one area each. Forty lines that all moved down by the same amount are one
 *  rectangle to whoever writes the file, not forty. */
function mergedStrips(
  placements: readonly Placement[],
  follows: (previous: FlowItem, next: FlowItem) => boolean,
): ExportStrip[] {
  const strips: ExportStrip[] = [];
  let previous: Placement | null = null;
  for (const placement of placements) {
    const { content } = placement.item;
    if (content.kind !== "slice") {
      previous = null;
      continue;
    }
    const last = strips[strips.length - 1];
    const joins =
      previous !== null &&
      last !== undefined &&
      last.source === content.page &&
      follows(previous.item, placement.item) &&
      Math.abs(last.rect.x - content.rect.x) < EPSILON &&
      Math.abs(last.rect.width - content.rect.width) < EPSILON &&
      Math.abs(placement.x - last.x) < EPSILON &&
      // Moved by the same amount: still the same distance apart as on the page
      // they came from, so the blank between them can travel with them.
      Math.abs(placement.y - content.rect.y - (last.y - last.rect.y)) < EPSILON;
    if (joins) {
      last.rect = { ...last.rect, height: content.rect.y + content.rect.height - last.rect.y };
    } else {
      strips.push({ source: content.page, rect: content.rect, x: placement.x, y: placement.y });
    }
    previous = placement;
  }
  return strips;
}
