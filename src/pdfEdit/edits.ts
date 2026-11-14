import type { BoundingBox } from "../documentCoordinates.js";
import type { FlowColumn, FlowItem, PageFlow } from "./flow.js";
import type { Paragraph, StyledRun } from "./paragraphs.js";
import type { PagePlan } from "./reflow.js";

/**
 * A paragraph the reader has taken over from the page.
 *
 * The page's own strips for those lines are dropped from the flow and the
 * paragraph's line boxes put in their place, as live text. From then on its
 * height is whatever the text wraps to, and the flow around it follows.
 *
 * An edit is described entirely in page units and is never written back to the
 * file: it is a statement about how the page should be drawn.
 */
export interface ParagraphEdit {
  id: string;
  paragraph: Paragraph;
  /** What the paragraph says now, in the styles of `paragraph.styles`. */
  runs: StyledRun[];
  /** How many lines that wraps to, as the browser last laid it out. */
  lineCount: number;
  /** A line box's top to its baseline, as the browser sets this type. Null
   *  until it has been measured, and estimated meanwhile. */
  ascent: number | null;
}

export function createEdit(id: string, paragraph: Paragraph): ParagraphEdit {
  return { id, paragraph, runs: paragraph.runs, lineCount: paragraph.lineCount, ascent: null };
}

/** A line box's top to its baseline for a paragraph's type, as a typical font
 *  has it. Good enough to put a caret over a line; an edit replaces it with
 *  what the browser measured. */
export function estimatedAscent({ lineHeight, fontSize }: Paragraph): number {
  return (lineHeight - fontSize * 1.15) / 2 + fontSize * 0.9;
}

function ascentOf(edit: ParagraphEdit): number {
  return edit.ascent ?? estimatedAscent(edit.paragraph);
}

/** The page's flow with each edited paragraph's strips replaced by its lines. */
export function applyEdits(flow: PageFlow, edits: readonly ParagraphEdit[]): PageFlow {
  const own = edits.filter((edit) => edit.paragraph.page === flow.page);
  if (own.length === 0) return flow;
  return {
    ...flow,
    regions: flow.regions.map((region) => ({
      ...region,
      columns: region.columns.map((column) => own.reduce(replaceParagraph, column)),
    })),
  };
}

function replaceParagraph(column: FlowColumn, edit: ParagraphEdit): FlowColumn {
  const { paragraph } = edit;
  const start = column.items.findIndex((item) => item.id === paragraph.itemIds[0]);
  if (start < 0) return column;
  const end = start + paragraph.itemIds.length;
  const first = column.items[start];
  const last = column.items[end - 1];
  if (first.content.kind !== "slice" || last?.content.kind !== "slice") return column;

  // The strips were ink: they began at a line's ascenders and ended at its
  // descenders. Line boxes are taller than their ink, so the paragraph's box
  // starts a little above the first strip and ends a little below the last.
  // Both differences come off the gaps on either side, which is what puts an
  // edit that changed nothing exactly where the page drew it.
  const top = paragraph.firstBaseline - ascentOf(edit);
  const inkTop = first.content.rect.y;
  const inkBottom = last.content.rect.y + last.content.rect.height;
  const raise = inkTop - top;
  const originalBottom = top + paragraph.lineCount * paragraph.lineHeight;

  const drop = originalBottom - inkBottom;

  const lines = editItems(edit, first.gapBefore - raise, Math.max(0, drop));
  const after = column.items.slice(end);
  if (after.length > 0) after[0] = { ...after[0], gapBefore: after[0].gapBefore - drop };
  return {
    ...column,
    lead: start === 0 ? column.lead - raise : column.lead,
    items: [...column.items.slice(0, start), ...lines, ...after],
  };
}

function editItems(edit: ParagraphEdit, gapBefore: number, trailing: number): FlowItem[] {
  const { lineHeight, splittable } = edit.paragraph;
  if (!splittable) {
    return [
      {
        id: `${edit.id}:0`,
        height: edit.lineCount * lineHeight,
        gapBefore,
        trailing,
        content: { kind: "edit", editId: edit.id, line: 0, lines: edit.lineCount },
      },
    ];
  }
  return Array.from({ length: edit.lineCount }, (_, line) => ({
    id: `${edit.id}:${line}`,
    height: lineHeight,
    gapBefore: line === 0 ? gapBefore : 0,
    trailing,
    content: { kind: "edit" as const, editId: edit.id, line, lines: 1 },
  }));
}

/** A piece of the page drawn *behind* an edited paragraph: the paper it stood
 *  on, without the words. */
export interface Backdrop {
  /** The page it is drawn on. */
  page: number;
  /** Where on the paragraph's own page it is cut from. */
  source: { page: number; rect: BoundingBox };
  x: number;
  y: number;
}

/**
 * What an edited paragraph stands on, cut to fit the lines it has now.
 *
 * A paragraph is often set on something -- a tinted box, a border, a rule down
 * its side. That belongs to the paragraph, not to its words, so it stays when
 * the words are replaced; and it has to grow and shrink with them. The area
 * the paragraph covered is cut into what was above its first line, one piece
 * per line, and what was below its last. Each line the paragraph has now gets
 * a line's piece -- its own for as long as there is one, the last *inner*
 * line's again for every line added -- and the top and bottom go above the
 * first line and below the last, wherever those have ended up.
 */
export function editBackdrops(edit: ParagraphEdit, plans: ReadonlyMap<number, PagePlan>): Backdrop[] {
  const { paragraph } = edit;
  const { area, lineHeight } = paragraph;
  const original = paragraph.lineCount;
  const top = paragraph.firstBaseline - ascentOf(edit);
  const cut = (y: number, height: number) => ({
    page: paragraph.page,
    rect: { x: area.x, y, width: area.width, height },
  });
  const lineSource = (line: number) => {
    const last = edit.lineCount - 1;
    const index = line === last ? original - 1 : Math.min(line, Math.max(0, original - 2));
    return cut(top + index * lineHeight, lineHeight);
  };

  const lines: Array<{ page: number; x: number; y: number }> = [];
  for (const plan of [...plans.values()].sort((a, b) => a.page - b.page)) {
    for (const placement of plan.placements) {
      const { content } = placement.item;
      if (content.kind !== "edit" || content.editId !== edit.id) continue;
      for (let offset = 0; offset < content.lines; offset++) {
        lines[content.line + offset] = {
          page: plan.page,
          x: placement.x,
          y: placement.y + offset * lineHeight,
        };
      }
    }
  }

  const backdrops: Backdrop[] = [];
  lines.forEach((at, line) => {
    backdrops.push({ ...at, source: lineSource(line) });
  });
  const first = lines[0];
  const last = lines[edit.lineCount - 1];
  const above = top - area.y;
  if (first && above > EPSILON) {
    backdrops.push({ ...first, y: first.y - above, source: cut(area.y, above) });
  }
  const below = area.y + area.height - (top + original * lineHeight);
  if (last && below > EPSILON) {
    backdrops.push({ ...last, y: last.y + lineHeight, source: cut(top + original * lineHeight, below) });
  }
  return backdrops;
}

/** Heights are sums of measurements: less than this is nothing. */
const EPSILON = 0.01;

/** A run of an edit's lines that sit together on one page. */
export interface EditFragment {
  page: number;
  /** Top-left of the fragment's first line box, in that page's units. */
  x: number;
  y: number;
  lines: number;
}

/** Where an edit's lines were placed, as the fewest contiguous runs. A
 *  paragraph that crosses a page break is two. */
export function editFragments(
  edit: ParagraphEdit,
  plans: ReadonlyMap<number, PagePlan>,
): EditFragment[] {
  const { lineHeight, inset } = edit.paragraph;
  const fragments: EditFragment[] = [];
  let expectedLine = 0;
  for (const plan of [...plans.values()].sort((a, b) => a.page - b.page)) {
    for (const placement of plan.placements) {
      const { content } = placement.item;
      if (content.kind !== "edit" || content.editId !== edit.id) continue;
      if (content.line !== expectedLine) continue;
      expectedLine += content.lines;
      const previous = fragments[fragments.length - 1];
      const x = placement.x + inset;
      const continues =
        previous &&
        previous.page === plan.page &&
        Math.abs(previous.x - x) < 0.01 &&
        Math.abs(previous.y + previous.lines * lineHeight - placement.y) < 0.01;
      if (continues) {
        previous.lines += content.lines;
      } else {
        fragments.push({ page: plan.page, x, y: placement.y, lines: content.lines });
      }
    }
  }
  return fragments;
}
