import type { BoundingBox } from "../documentCoordinates.js";
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
 * extractor makes: a wider gap, a change of size, an indent, a line broken
 * before it was full. A
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
  /** The run's font, by the name the file gives it. */
  fontName: string;
  /** The colour the run is drawn in, as CSS. */
  color: string;
}

/** How a stretch of text is set. */
export interface RunStyle {
  /** The font, by the name the file gives it: the same in every session, and
   *  on every page that uses the font. */
  fontName: string;
  fontSize: number;
  color: string;
  /** How far its baseline sits above the line's: positive for a superscript. */
  rise: number;
  /** Set where the reader made the text bold or italic, or took either off:
   *  that face of the font's family, rather than what the font itself is. */
  bold?: boolean;
  italic?: boolean;
}

/** A stretch of a paragraph's text in one style, by index into its `styles`. */
export interface StyledRun {
  text: string;
  style: number;
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
  /** The part of the page those items cover: the paragraph's lines, and with
   *  them whatever it stands on -- a tint, a border, a rule beside it. */
  area: BoundingBox;
  text: string;
  /** The same text, as the runs of type it is set in. A paragraph is rarely
   *  one style: an italic phrase, a citation raised above the line, a symbol
   *  from another face. Editing it must not flatten those. */
  runs: StyledRun[];
  styles: RunStyle[];
  /** The style most of the paragraph is in, and that the three fields below
   *  repeat: what new text is set in when there is nothing beside it to match. */
  baseStyle: number;
  lineCount: number;
  firstBaseline: number;
  lastBaseline: number;
  /** Baseline to baseline. */
  lineHeight: number;
  /** The left edge of the paragraph's lines, its first line aside, measured in
   *  from its column's left edge. */
  inset: number;
  width: number;
  /** How far in from that edge the first line starts. Negative where it hangs
   *  out to the left of the rest, as a list item's does. */
  indent: number;
  fontName: string;
  fontSize: number;
  color: string;
  align: TextAlign;
  /** The lines as the page set them, for placing a caret over the page's own
   *  rendering of a paragraph nobody has changed. */
  lines: ParagraphLine[];
}

interface Segment {
  text: string;
  style: RunStyle;
}

interface Line {
  text: string;
  segments: Segment[];
  baseline: number;
  left: number;
  right: number;
  /** How far the line's first word reaches from its left edge. */
  firstWord: number;
  fontSize: number;
  fontName: string;
  color: string;
}

/** A gap this much wider than the column's usual one starts a new paragraph. */
const PARAGRAPH_GAP_RATIO = 1.6;
/** Sizes within this fraction of each other are the same size. */
const FONT_SIZE_TOLERANCE = 0.08;
/** The share of a column's lines that reach its right edge or stop short of
 *  it. The few that reach further have something beside them -- a note set in
 *  the margin -- and are not what the column is measured by. */
const MEASURE_QUANTILE = 0.9;
/** A word space, in ems. */
const SPACE_EMS = 0.25;
/** A first word is measured from its run's width, shared out among the run's
 *  characters. It has to fit by this much more than that estimate before the
 *  line above is taken to have been broken early. */
const FIT_MARGIN = 1.15;
/** A line starting this many ems in from the column's left edge is indented. */
const INDENT_EMS = 0.6;
/** Lines starting within this many ems of each other start at the same edge. */
const SAME_EDGE_EMS = 0.3;
/** What an item of a list opens with: a bullet or a dash, a number or a
 *  letter with its stop or bracket, a reference's number in brackets. */
const LIST_MARKER = /^(?:[\u2022\u25E6\u25AA\u25CF\u2023\u2043\u00B7\u2013\u2014*-]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|\[\d+\])\s/;
/** Runs this many ems apart on a line have a space between them. */
const WORD_GAP_EMS = 0.2;
/** Baselines within this many ems are one line: a superscript does not start
 *  a line of its own. */
const SAME_LINE_EMS = 0.5;
/** A baseline this many ems off the line's is noise, not a raised character. */
const RISE_TOLERANCE_EMS = 0.05;

export function paragraphsOf(flow: PageFlow, runs: TextRun[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const region of flow.regions) {
    for (const column of region.columns) {
      paragraphs.push(...columnParagraphs(flow.page, column, runs));
    }
  }
  return paragraphs;
}

function columnParagraphs(
  page: number,
  column: FlowColumn,
  runs: TextRun[],
): Paragraph[] {
  const lined = column.items.map((item) => ({ item, lines: linesOf(item, runs) }));
  const allLines = lined.flatMap((entry) => entry.lines);
  if (allLines.length === 0) return [];

  const columnLeft = Math.min(...allLines.map((line) => line.left));
  const columnRight = measureEdge(allLines);
  const textGaps = lined
    .slice(1)
    .filter((entry, index) => entry.lines.length > 0 && lined[index].lines.length > 0)
    .map((entry) => entry.item.gapBefore);
  const usualGap = textGaps.length > 0 ? median(textGaps) : 0;

  const paragraphs: Paragraph[] = [];
  let group: typeof lined = [];
  const close = () => {
    // A paragraph with a locked line in it -- a formula set in the middle of
    // a sentence -- is withheld whole. Offering the lines around the formula
    // would let the reader re-wrap a sentence with a hole in it.
    const locked = group.some(({ item }) => item.content.kind === "slice" && item.content.locked);
    if (group.length > 0 && !locked) {
      paragraphs.push(paragraphFrom(page, group, column, columnRight));
    }
    group = [];
  };

  for (const [index, entry] of lined.entries()) {
    if (entry.lines.length === 0) {
      close();
      continue;
    }
    const previous = group[group.length - 1];
    if (previous) {
      const last = previous.lines[previous.lines.length - 1];
      const next = entry.lines[0];
      const em = last.fontSize;
      // A line is broken where the next word no longer fits. Where it would
      // have fit, the break was meant: the paragraph ended. That holds for
      // text set ragged as for text set flush, which a fixed shortfall from
      // the right edge does not -- every line of ragged text falls short.
      const room = columnRight - last.right;
      // An indent under a line that is not indented starts a paragraph --
      // unless that line is all the paragraph has so far and is the first of
      // an item of a list, which hangs out to the left of the rest of it. It
      // is known by its bullet or its number, or by the line after the
      // indented one being indented with it.
      const indented =
        next.left - columnLeft > INDENT_EMS * em && last.left - columnLeft <= INDENT_EMS * em;
      const following = lined[index + 1];
      const after = following?.lines[0];
      const stays =
        after !== undefined &&
        following.item.gapBefore <= usualGap * PARAGRAPH_GAP_RATIO + 1 &&
        Math.abs(after.left - next.left) <= SAME_EDGE_EMS * em;
      const hanging =
        group.length === 1 && previous.lines.length === 1 && (LIST_MARKER.test(last.text) || stays);
      const breaks =
        entry.item.gapBefore > usualGap * PARAGRAPH_GAP_RATIO + 1 ||
        Math.abs(next.fontSize - last.fontSize) > FONT_SIZE_TOLERANCE * last.fontSize ||
        brokenEarly(room, next.firstWord, em) ||
        (indented && !hanging);
      if (breaks) close();
    }
    group.push(entry);
  }
  close();
  return alignedWithColumn(paragraphs);
}

/** The right edge a column's lines are set to. */
function measureEdge(lines: Line[]): number {
  const rights = lines.map((line) => line.right).sort((a, b) => a - b);
  return rights[Math.ceil(rights.length * MEASURE_QUANTILE) - 1];
}

/** A paragraph of one or two lines does not say how it is aligned: there are
 *  not two full lines to compare. Where the column's longer paragraphs in the
 *  same size are justified, it is taken to be too. */
function alignedWithColumn(paragraphs: Paragraph[]): Paragraph[] {
  const telling = paragraphs.filter((paragraph) => paragraph.lineCount >= 3);
  return paragraphs.map((paragraph) => {
    if (paragraph.lineCount >= 3 || paragraph.align === "justify") return paragraph;
    const alike = telling.filter(
      (other) => Math.abs(other.fontSize - paragraph.fontSize) <= FONT_SIZE_TOLERANCE * other.fontSize,
    );
    const justified = alike.filter((other) => other.align === "justify").length * 2 > alike.length;
    const right = paragraph.inset + paragraph.width;
    const full = paragraph.lines
      .slice(0, -1)
      .every((line) => right - (line.inset + line.width) < 0.5 * paragraph.fontSize);
    return justified && full ? { ...paragraph, align: "justify" } : paragraph;
  });
}

/** Whether a line with `room` left on it was broken early: the word that
 *  starts the next line would have fit. */
const brokenEarly = (room: number, firstWord: number, em: number) =>
  room > firstWord * FIT_MARGIN + SPACE_EMS * em;

/** Whether `next` is the rest of `paragraph`: the last line of the one was
 *  broken only because the first word of the other did not fit on it. They
 *  are then two pieces of one paragraph that a column or a page came between,
 *  and were never two paragraphs. */
export function continuesIn(paragraph: Paragraph, next: Paragraph): boolean {
  const last = paragraph.lines[paragraph.lines.length - 1];
  const first = next.lines[0];
  if (!last || !first) return false;
  const room = paragraph.inset + paragraph.width - (last.inset + last.width);
  const word = first.text.split(/\s/)[0];
  const firstWord = (first.width * advanceOf(word)) / advanceOf(first.text);
  return !brokenEarly(room, firstWord, paragraph.fontSize);
}

/** Runs ready to have `next` run straight on from them as part of the same
 *  sentence: with a space between, or without the hyphen a typesetter put at
 *  the break. */
export function runningOnInto(runs: readonly StyledRun[], next: readonly StyledRun[]): StyledRun[] {
  const last = runs[runs.length - 1];
  const following = next[0]?.text ?? "";
  if (!last || /\s$/.test(last.text) || following === "") return [...runs];
  const text =
    /\p{L}-$/u.test(last.text) && /^\p{Ll}/u.test(following) ? last.text.slice(0, -1) : `${last.text} `;
  return [...runs.slice(0, -1), { ...last, text }];
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
    const reference = current && dominant(current);
    // Measured against the larger of the two sizes: a raised character sorts
    // ahead of the line it belongs to, and is small.
    const sameLine =
      reference !== undefined &&
      run.baseline - reference.baseline <= SAME_LINE_EMS * Math.max(run.fontSize, reference.fontSize);
    if (sameLine) current.push(run);
    else lines.push([run]);
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
  const segments: Segment[] = [];
  let text = "";
  let right = -Infinity;
  for (const run of ordered) {
    let piece = run.text.replace(/\s+/g, " ");
    // Whitespace is collapsed against what is already there: none opens a
    // line, none follows a space, and a visible gap between two runs is one.
    if (text === "" || text.endsWith(" ")) piece = piece.replace(/^ /, "");
    else if (!piece.startsWith(" ") && run.x - right > WORD_GAP_EMS * main.fontSize) piece = ` ${piece}`;
    right = Math.max(right, run.x + run.width);
    if (piece === "") continue;
    text += piece;
    appendSegment(segments, piece, styleOf(run, main));
  }
  if (text.endsWith(" ")) dropLastCharacter(segments);

  const inked = ordered.filter((run) => run.text.trim().length > 0);
  return {
    text: text.trimEnd(),
    segments,
    baseline: main.baseline,
    left: inked.length > 0 ? Math.min(...inked.map((run) => run.x)) : main.x,
    right: inked.length > 0 ? Math.max(...inked.map((run) => run.x + run.width)) : main.x,
    firstWord: firstWordWidth(inked, main.fontSize),
    fontSize: main.fontSize,
    fontName: main.fontName,
    color: main.color,
  };
}

/** Roughly how wide a character is beside its neighbours in a proportional
 *  face. Only used to share a run's measured width out among its characters,
 *  so only the proportions matter. */
function advance(character: string): number {
  if (/[\siljtfrI.,;:'!|()[\]]/.test(character)) return 0.5;
  if (/[mwMW@%]/.test(character)) return 1.5;
  if (/\p{Lu}/u.test(character)) return 1.25;
  return 1;
}

const advanceOf = (text: string) => [...text].reduce((sum, character) => sum + advance(character), 0);

/** How far a line's first word reaches from the line's left edge. The file
 *  says how wide each run is, not each word, so the word's share of its run
 *  is estimated from its characters. `inked` is the line's runs, left to
 *  right, without the ones that are only space. */
function firstWordWidth(inked: TextRun[], em: number): number {
  const first = inked[0];
  if (!first) return 0;
  let right = first.x;
  for (const [index, run] of inked.entries()) {
    const lead = run.text.length - run.text.trimStart().length;
    // A space, written or left, before this run: the word ended with the last.
    if (index > 0 && (lead > 0 || run.x - right > WORD_GAP_EMS * em)) break;
    const end = run.text.slice(lead).search(/\s/);
    if (end >= 0) {
      right = run.x + (run.width * advanceOf(run.text.slice(0, lead + end))) / advanceOf(run.text);
      break;
    }
    right = run.x + run.width;
  }
  return right - first.x;
}

function styleOf(run: TextRun, main: TextRun): RunStyle {
  const rise = main.baseline - run.baseline;
  return {
    fontName: run.fontName,
    fontSize: Math.round(run.fontSize * 100) / 100,
    color: run.color,
    rise: Math.abs(rise) < RISE_TOLERANCE_EMS * main.fontSize ? 0 : Math.round(rise * 100) / 100,
  };
}

export const styleKey = (style: RunStyle) =>
  `${style.fontName}|${style.fontSize}|${style.color}|${style.rise}|${style.bold ?? ""}|${style.italic ?? ""}`;

function appendSegment(segments: Segment[], text: string, style: RunStyle): void {
  const last = segments[segments.length - 1];
  if (last && styleKey(last.style) === styleKey(style)) last.text += text;
  else segments.push({ text, style });
}

/** The style most of the text is in. */
function dominantStyle(segments: Segment[]): RunStyle {
  const weight = new Map<string, { style: RunStyle; characters: number }>();
  for (const { text, style } of segments) {
    const entry = weight.get(styleKey(style)) ?? { style, characters: 0 };
    entry.characters += text.length;
    weight.set(styleKey(style), entry);
  }
  return [...weight.values()].reduce((best, entry) =>
    entry.characters > best.characters ? entry : best,
  ).style;
}

/** Give the space at the edge of an inline phrase to the plain text beside
 *  it. A space set in a superscript's size is narrower than the one the
 *  reader typed, and one left inside an italic run makes the run's edge
 *  somewhere a caret cannot visibly be. */
function settleSpaces(segments: Segment[], base: RunStyle): Segment[] {
  const settled = segments.map((segment) => ({ ...segment }));
  const isBase = (segment: Segment | undefined) =>
    segment !== undefined && styleKey(segment.style) === styleKey(base);
  settled.forEach((segment, index) => {
    if (isBase(segment)) return;
    const before = settled[index - 1];
    const after = settled[index + 1];
    if (segment.text.startsWith(" ") && isBase(before)) {
      segment.text = segment.text.slice(1);
      before.text += " ";
    }
    if (segment.text.endsWith(" ") && isBase(after)) {
      segment.text = segment.text.slice(0, -1);
      after.text = ` ${after.text}`;
    }
  });
  return settled.filter((segment) => segment.text !== "");
}

function dropLastCharacter(segments: Segment[]): void {
  const last = segments[segments.length - 1];
  if (!last) return;
  last.text = last.text.slice(0, -1);
  if (last.text === "") segments.pop();
}

function paragraphFrom(
  page: number,
  group: Array<{ item: FlowItem; lines: Line[] }>,
  column: FlowColumn,
  columnRight: number,
): Paragraph {
  const lines = group.flatMap((entry) => entry.lines);
  const itemOf = group.flatMap((entry) => entry.lines.map(() => entry.item));
  const joined = joinLines(lines);
  const base = dominantStyle(joined.segments);
  const styles: RunStyle[] = [];
  const runs = settleSpaces(joined.segments, base).map(({ text, style }) => {
    let index = styles.findIndex((known) => styleKey(known) === styleKey(style));
    if (index < 0) index = styles.push(style) - 1;
    return { text, style: index };
  });
  const baseStyle = styles.findIndex((style) => styleKey(style) === styleKey(base));
  const first = lines[0];
  // The left edge is the one the lines after the first are set to. The first
  // can start to the right of it, indented, or to the left of it, hanging.
  const x = Math.min(...(lines.length > 1 ? lines.slice(1) : lines).map((line) => line.left));
  const right = Math.max(...lines.map((line) => line.right));
  const { fontSize } = base;
  const steps = lines.slice(1).map((line, index) => line.baseline - lines[index].baseline);

  // A paragraph of full lines is as wide as its lines. A single line says
  // nothing about how far it may run, so it gets the rest of its column.
  const reach = lines.length > 1 ? right : Math.max(right, column.x + column.width, columnRight);
  const fullLines = lines.slice(0, -1);
  const justified =
    fullLines.length >= 2 && fullLines.every((line) => right - line.right < 0.5 * fontSize);

  const rects = group.flatMap(({ item }) => (item.content.kind === "slice" ? [item.content.rect] : []));
  const areaTop = Math.min(...rects.map((rect) => rect.y));
  const areaBottom = Math.max(...rects.map((rect) => rect.y + rect.height));

  return {
    page,
    itemIds: group.map((entry) => entry.item.id),
    area: { x: column.x, y: areaTop, width: column.width, height: areaBottom - areaTop },
    text: joined.text,
    runs,
    styles,
    baseStyle,
    lineCount: lines.length,
    firstBaseline: first.baseline,
    lastBaseline: lines[lines.length - 1].baseline,
    lineHeight: steps.length > 0 ? median(steps) : fontSize * 1.2,
    inset: x - column.x,
    width: reach - x,
    indent: first.left - x,
    fontName: base.fontName,
    fontSize,
    color: base.color,
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

/** A paragraph with nothing in it, set like `paragraph` and replacing nothing
 *  on the page: what the reader starts by pressing Enter. */
export function paragraphAfter(paragraph: Paragraph): Paragraph {
  return {
    ...paragraph,
    itemIds: [],
    area: { ...paragraph.area, y: paragraph.area.y + paragraph.area.height, height: 0 },
    text: "",
    runs: [],
    lineCount: 0,
    lines: [],
  };
}

/** Runs written against one table of styles, rewritten against another. A
 *  style the other table lacks is added to it. */
export function adoptRuns(
  styles: RunStyle[],
  from: readonly RunStyle[],
  runs: readonly StyledRun[],
): StyledRun[] {
  return runs.map((run) => {
    const style = from[run.style];
    let index = styles.findIndex((known) => styleKey(known) === styleKey(style));
    if (index < 0) index = styles.push(style) - 1;
    return { text: run.text, style: index };
  });
}

/** Lines back into running text, and where each line went in it. A hyphen at
 *  a line's end that the next line continues in lower case was put there by
 *  the typesetter, not the author. */
function joinLines(lines: Line[]): {
  text: string;
  spans: Array<{ start: number; kept: number }>;
  segments: Segment[];
} {
  let text = "";
  const spans: Array<{ start: number; kept: number }> = [];
  const segments: Segment[] = [];
  for (const line of lines) {
    const previous = spans[spans.length - 1];
    if (previous && /\p{L}-$/u.test(text) && /^\p{Ll}/u.test(line.text)) {
      text = text.slice(0, -1);
      previous.kept -= 1;
      dropLastCharacter(segments);
    } else if (text) {
      text += " ";
      // The space belongs to the line it ends, in whatever that line ended in.
      segments[segments.length - 1].text += " ";
    }
    spans.push({ start: text.length, kept: line.text.length });
    text += line.text;
    for (const segment of line.segments) appendSegment(segments, segment.text, segment.style);
  }
  return { text, spans, segments };
}
