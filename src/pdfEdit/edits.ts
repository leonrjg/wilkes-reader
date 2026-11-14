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
  /** What this replaces on the page, and how it is set. A paragraph the reader
   *  made -- by pressing Enter in another -- replaces nothing: its `itemIds`
   *  are empty, and `after` says where it goes instead. */
  paragraph: Paragraph;
  /** The edit this one comes directly after, when it replaces nothing. */
  after: string | null;
  /** What the paragraph says now, in the styles of `paragraph.styles`. */
  runs: StyledRun[];
  /** Raised when `runs` is changed from outside the live text -- a paragraph
   *  cut in two keeps its first half -- so the text on screen is written
   *  again. What the reader types does not raise it: that is already there. */
  revision: number;
  /** True once the edit is part of a change to the document's paragraphs --
   *  one split, two joined. Such an edit is never handed back to the page for
   *  saying what the page says: its being there is the change. */
  structural: boolean;
  /** How many lines that wraps to, as the browser last laid it out. */
  lineCount: number;
  /** A line box's top to its baseline, as the browser sets this type. Null
   *  until it has been measured, and estimated meanwhile. */
  ascent: number | null;
}

export function createEdit(id: string, paragraph: Paragraph): ParagraphEdit {
  return {
    id,
    paragraph,
    after: null,
    runs: paragraph.runs,
    revision: 0,
    structural: false,
    lineCount: Math.max(1, paragraph.lineCount),
    ascent: null,
  };
}

/** Whether an edit stands in for something on the page, or only follows
 *  another edit. */
export const replacesItems = (edit: ParagraphEdit) => edit.paragraph.itemIds.length > 0;

/** Runs cut at an offset into their text. */
export function splitRuns(runs: readonly StyledRun[], offset: number): [StyledRun[], StyledRun[]] {
  const before: StyledRun[] = [];
  const after: StyledRun[] = [];
  let remaining = Math.max(0, offset);
  for (const run of runs) {
    if (remaining >= run.text.length) {
      before.push(run);
    } else if (remaining <= 0) {
      after.push(run);
    } else {
      before.push({ ...run, text: run.text.slice(0, remaining) });
      after.push({ ...run, text: run.text.slice(remaining) });
    }
    remaining -= run.text.length;
  }
  return [before, after];
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
  const replacing = own.filter(replacesItems);
  const following = own.filter((edit) => !replacesItems(edit));
  return {
    ...flow,
    regions: flow.regions.map((region) => ({
      ...region,
      columns: region.columns.map((column) =>
        insertFollowing(replacing.reduce(replaceParagraph, column), following),
      ),
    })),
  };
}

/** Put the paragraphs the reader made after the edits they follow. One can
 *  follow another of its kind, so this goes round until none is left that has
 *  somewhere to go. */
function insertFollowing(column: FlowColumn, following: readonly ParagraphEdit[]): FlowColumn {
  let items = column.items;
  let waiting = [...following];
  for (;;) {
    const placed: ParagraphEdit[] = [];
    for (const edit of waiting) {
      // The last line of the edit it follows: that edit may be many lines.
      let anchor = items.length - 1;
      while (anchor >= 0) {
        const { content } = items[anchor];
        if (content.kind === "edit" && content.editId === edit.after) break;
        anchor--;
      }
      if (anchor < 0) continue;
      const next = items[anchor + 1];
      // The space the page left after the paragraph this follows is the space
      // between paragraphs here, so it is what goes before the new one too.
      const gap = next ? next.gapBefore : edit.paragraph.lineHeight / 2;
      items = [
        ...items.slice(0, anchor + 1),
        ...editItems(edit, gap, items[anchor].trailing),
        ...items.slice(anchor + 1),
      ];
      placed.push(edit);
    }
    if (placed.length === 0) break;
    waiting = waiting.filter((edit) => !placed.includes(edit));
  }
  return items === column.items ? column : { ...column, items };
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
  const originalBottom = paragraph.lastBaseline - ascentOf(edit) + paragraph.lineHeight;
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
  // A paragraph that replaced nothing stood on nothing.
  if (!replacesItems(edit)) return [];
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
