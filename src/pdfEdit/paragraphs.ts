import type { FlowColumn, FlowItem, PageFlow } from "./flow.js";
import { median } from "./pageLayout.js";

/**
 * Which of a page's lines are one paragraph, and what it says.
 *
 * The flow knows where the lines are and nothing about what is on them; the
 * file's text layer knows the words and nothing about paragraphs. Editing needs
 * the two joined: the run of items a paragraph occupies -- so they can be
 * replaced -- and the text and type it was set in -- so it can be set again.
 *
 * The grouping is typographic guesswork, the same guesses every PDF text
 * extractor makes: a wider gap, a change of size, a short line, an indent. A
 * host whose own extraction already knows the page's blocks could supply them
 * instead; nothing downstream depends on how a `Paragraph` was arrived at.
 */

/** One run of text as the file places it, in page units, origin top-left. */
export interface TextRun {
  text: string;
  x: number;
  width: number;
  baseline: number;
  fontSize: number;
  /** The name pdf.js loaded the run's embedded font under. */
  fontName: string;
  /** The colour the run is drawn in, as CSS. */
  color: string;
}

/** One line of a paragraph as the page set it. */
export interface ParagraphLine {
  /** The item whose strip of the page this line is on. */
  itemId: string;
  text: string;
  /** Where this line's text begins in the paragraph's. */
  start: number;
  /** How many of the line's characters the paragraph's text keeps: all of
   *  them, or one fewer when the line ended in a typesetter's hyphen. */
  kept: number;
  /** The line's baseline, measured down from the top of its item. */
  baselineOffset: number;
  /** The line's left edge, measured in from its column's. */
  inset: number;
  width: number;
}

export type TextAlign = "left" | "justify";

export interface Paragraph {
  page: number;
  /** The consecutive items of one column this paragraph occupies. */
  itemIds: string[];
  /** False where the paragraph sits beside another column: its lines cannot
   *  then be split between two places, and it moves as one block. */
  splittable: boolean;
  text: string;
  lineCount: number;
  firstBaseline: number;
  /** Baseline to baseline. */
  lineHeight: number;
  /** The left edge of the paragraph's lines, first-line indent aside, measured
   *  in from its column's left edge. */
  inset: number;
  width: number;
  indent: number;
  fontName: string;
  fontSize: number;
  color: string;
  align: TextAlign;
  /** The lines as the page set them, for placing a caret over the page's own
   *  rendering of a paragraph nobody has changed. */
  lines: ParagraphLine[];
}

interface Line {
  text: string;
  baseline: number;
  left: number;
  right: number;
  fontSize: number;
  fontName: string;
  color: string;
}

/** A gap this much wider than the column's usual one starts a new paragraph. */
const PARAGRAPH_GAP_RATIO = 1.6;
/** Sizes within this fraction of each other are the same size. */
const FONT_SIZE_TOLERANCE = 0.08;
/** A line this many ems short of the column's right edge ends its paragraph. */
const SHORT_LINE_EMS = 1.5;
/** A line starting this many ems in from the column's left edge is indented. */
const INDENT_EMS = 0.6;
/** Runs this many ems apart on a line have a space between them. */
const WORD_GAP_EMS = 0.2;
/** Baselines within this many ems are one line: a superscript does not start
 *  a line of its own. */
const SAME_LINE_EMS = 0.5;

export function paragraphsOf(flow: PageFlow, runs: TextRun[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const region of flow.regions) {
    for (const column of region.columns) {
      paragraphs.push(...columnParagraphs(flow.page, column, runs, region.columns.length === 1));
    }
  }
  return paragraphs;
}

function columnParagraphs(
  page: number,
  column: FlowColumn,
  runs: TextRun[],
  splittable: boolean,
): Paragraph[] {
  const lined = column.items.map((item) => ({ item, lines: linesOf(item, runs) }));
  const allLines = lined.flatMap((entry) => entry.lines);
  if (allLines.length === 0) return [];

  const columnLeft = Math.min(...allLines.map((line) => line.left));
  const columnRight = Math.max(...allLines.map((line) => line.right));
  const textGaps = lined
    .slice(1)
    .filter((entry, index) => entry.lines.length > 0 && lined[index].lines.length > 0)
    .map((entry) => entry.item.gapBefore);
  const usualGap = textGaps.length > 0 ? median(textGaps) : 0;

  const paragraphs: Paragraph[] = [];
  let group: typeof lined = [];
  const close = () => {
    if (group.length > 0) {
      paragraphs.push(paragraphFrom(page, group, column, columnRight, splittable));
    }
    group = [];
  };

  for (const entry of lined) {
    if (entry.lines.length === 0) {
      close();
      continue;
    }
    const previous = group[group.length - 1];
    if (previous) {
      const last = previous.lines[previous.lines.length - 1];
      const next = entry.lines[0];
      const em = last.fontSize;
      const breaks =
        entry.item.gapBefore > usualGap * PARAGRAPH_GAP_RATIO + 1 ||
        Math.abs(next.fontSize - last.fontSize) > FONT_SIZE_TOLERANCE * last.fontSize ||
        columnRight - last.right > SHORT_LINE_EMS * em ||
        (next.left - columnLeft > INDENT_EMS * em && last.left - columnLeft <= INDENT_EMS * em);
      if (breaks) close();
    }
    group.push(entry);
  }
  close();
  return paragraphs;
}

/** The text lines whose runs sit on an item's strip of the page. */
function linesOf(item: FlowItem, runs: TextRun[]): Line[] {
  if (item.content.kind !== "slice") return [];
  const { rect } = item.content;
  const inside = runs
    .filter((run) => {
      // A run belongs to the strip its x-height is in; its baseline alone can
      // sit a hair under the ink of a line with no descenders.
      const middle = run.baseline - run.fontSize * 0.3;
      const centre = run.x + run.width / 2;
      return (
        middle >= rect.y && middle <= rect.y + rect.height &&
        centre >= rect.x && centre <= rect.x + rect.width
      );
    })
    .sort((a, b) => a.baseline - b.baseline || a.x - b.x);

  const lines: TextRun[][] = [];
  for (const run of inside) {
    const current = lines[lines.length - 1];
    if (current && run.baseline - dominant(current).baseline <= SAME_LINE_EMS * dominant(current).fontSize) {
      current.push(run);
    } else {
      lines.push([run]);
    }
  }
  return lines.map(lineFrom).filter((line) => line.text.length > 0);
}

/** The run that sets a line's size and baseline: its longest. */
function dominant(runs: TextRun[]): TextRun {
  return runs.reduce((best, run) => (run.text.length > best.text.length ? run : best));
}

function lineFrom(runs: TextRun[]): Line {
  const ordered = [...runs].sort((a, b) => a.x - b.x);
  const main = dominant(ordered);
  let text = "";
  let right = -Infinity;
  for (const run of ordered) {
    const spaced = text.endsWith(" ") || run.text.startsWith(" ");
    if (text && !spaced && run.x - right > WORD_GAP_EMS * main.fontSize) text += " ";
    text += run.text;
    right = Math.max(right, run.x + run.width);
  }
  const inked = ordered.filter((run) => run.text.trim().length > 0);
  return {
    text: text.replace(/\s+/g, " ").trim(),
    baseline: main.baseline,
    left: inked.length > 0 ? Math.min(...inked.map((run) => run.x)) : main.x,
    right: inked.length > 0 ? Math.max(...inked.map((run) => run.x + run.width)) : main.x,
    fontSize: main.fontSize,
    fontName: main.fontName,
    color: main.color,
  };
}

function paragraphFrom(
  page: number,
  group: Array<{ item: FlowItem; lines: Line[] }>,
  column: FlowColumn,
  columnRight: number,
  splittable: boolean,
): Paragraph {
  const lines = group.flatMap((entry) => entry.lines);
  const itemOf = group.flatMap((entry) => entry.lines.map(() => entry.item));
  const joined = joinLines(lines.map((line) => line.text));
  const first = lines[0];
  const x = Math.min(...lines.map((line) => line.left));
  const right = Math.max(...lines.map((line) => line.right));
  const fontSize = median(lines.map((line) => line.fontSize));
  const steps = lines.slice(1).map((line, index) => line.baseline - lines[index].baseline);

  // A paragraph of full lines is as wide as its lines. A single line says
  // nothing about how far it may run, so it gets the rest of its column.
  const reach = lines.length > 1 ? right : Math.max(right, column.x + column.width, columnRight);
  const fullLines = lines.slice(0, -1);
  const justified =
    fullLines.length >= 2 && fullLines.every((line) => right - line.right < 0.5 * fontSize);

  return {
    page,
    itemIds: group.map((entry) => entry.item.id),
    splittable,
    text: joined.text,
    lineCount: lines.length,
    firstBaseline: first.baseline,
    lineHeight: steps.length > 0 ? median(steps) : fontSize * 1.2,
    inset: x - column.x,
    width: reach - x,
    indent: first.left - x,
    fontName: mostCommon(lines.map((line) => line.fontName)),
    fontSize,
    color: mostCommon(lines.map((line) => line.color)),
    align: justified ? "justify" : "left",
    lines: lines.map((line, index) => {
      const item = itemOf[index];
      const itemTop = item.content.kind === "slice" ? item.content.rect.y : line.baseline;
      return {
        itemId: item.id,
        text: line.text,
        ...joined.spans[index],
        baselineOffset: line.baseline - itemTop,
        inset: line.left - column.x,
        width: line.right - line.left,
      };
    }),
  };
}

/** Lines back into running text, and where each line went in it. A hyphen at
 *  a line's end that the next line continues in lower case was put there by
 *  the typesetter, not the author. */
function joinLines(lines: string[]): {
  text: string;
  spans: Array<{ start: number; kept: number }>;
} {
  let text = "";
  const spans: Array<{ start: number; kept: number }> = [];
  for (const line of lines) {
    const previous = spans[spans.length - 1];
    if (previous && /\p{L}-$/u.test(text) && /^\p{Ll}/u.test(line)) {
      text = text.slice(0, -1);
      previous.kept -= 1;
    } else if (text) {
      text += " ";
    }
    spans.push({ start: text.length, kept: line.length });
    text += line;
  }
  return { text, spans };
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}
