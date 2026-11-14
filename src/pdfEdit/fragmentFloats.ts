/**
 * How one block of text is made to occupy several places.
 *
 * An edited paragraph is a single run of text, so that the caret, selection,
 * undo and input methods are the browser's. Its lines may still have to stand
 * in more than one place: the foot of one page and the head of the next, the
 * foot of one column and the head of the one beside it. Two things in CSS move
 * later lines of the same text somewhere else, and this works out how to set
 * them up:
 *
 *   - A float as wide as the block, which no line fits beside, moves the lines
 *     after it *down*; a narrower one beside the lines moves them sideways.
 *   - A multi-column container moves the lines that do not fit in its height
 *     back *up*, to the top of its next column. Its columns are given no width
 *     to speak of -- the block inside is wider than they are and overflows
 *     them -- so a new column changes where a line is vertically and nothing
 *     else, and the floats place it sideways as they do everywhere.
 *
 * So the fragments are dealt into columns, a new one at every fragment that
 * starts higher than the last one ended, and within a column floats do the
 * rest.
 */

/** A fragment of a paragraph, in CSS px within the scrolled content. */
export interface FragmentBox {
  left: number;
  top: number;
  lines: number;
}

export interface FloatSpec {
  side: "left" | "right";
  /** CSS px, or the whole width of the block. */
  width: number | "100%";
  height: number;
  /** Whether it goes below every float before it. */
  clear: boolean;
}

export interface FragmentLayout {
  left: number;
  top: number;
  /** The width of the block the text is set in. */
  width: number;
  /** More than one where a fragment starts higher than the one before ended. */
  columns: number;
  /** The height of each column. Only meaningful with more than one. */
  columnHeight: number;
  floats: FloatSpec[];
}

/** How much taller a fragment's spacer is than its lines. Any positive amount
 *  under a line height keeps a fragment's last line clear of the float below. */
const FLOAT_SLACK_PX = 0.5;
/** How far short of a column's foot its last float stops, so that rounding
 *  never has it reach into the next column. */
const COLUMN_EDGE_PX = 0.5;
/** Lines of room under the last fragment. A line typed past what the layout
 *  allowed for is shown there for the moment it takes the layout to follow. */
const SPARE_LINES = 4;

export function layoutFragments(
  boxes: readonly FragmentBox[],
  lineHeight: number,
  textWidth: number,
): FragmentLayout {
  if (boxes.length === 0) {
    return { left: 0, top: 0, width: textWidth, columns: 1, columnHeight: 0, floats: [] };
  }
  const bottomOf = (box: FragmentBox) => box.top + box.lines * lineHeight;
  // A fragment that starts above where the last one ended cannot be reached by
  // moving down: it opens a column.
  let column = 0;
  const columnOf = boxes.map((box, index) => {
    if (index > 0 && box.top < bottomOf(boxes[index - 1]) - FLOAT_SLACK_PX) column++;
    return column;
  });
  const columns = column + 1;
  const top = Math.min(...boxes.map((box) => box.top));
  // Column boxes are a pixel wide and a pixel apart; the block starts that
  // much further left so no fragment needs a negative indent.
  const left = Math.min(...boxes.map((box) => box.left)) - (columns > 1 ? columns : 0);
  const width = Math.max(...boxes.map((box) => box.left)) - left + textWidth;
  const columnHeight =
    Math.max(...boxes.map(bottomOf)) - top + FLOAT_SLACK_PX + SPARE_LINES * lineHeight;

  const floats: FloatSpec[] = [];
  const gap = (height: number) => {
    if (height > 0) floats.push({ side: "left", width: "100%", height, clear: true });
  };
  // Where the flow stands in the current column, below the column's top.
  let cursor = 0;
  let current = 0;
  boxes.forEach((box, index) => {
    if (columnOf[index] !== current) {
      gap(columnHeight - cursor - COLUMN_EDGE_PX);
      current = columnOf[index];
      cursor = 0;
    }
    const offset = box.top - top;
    gap(offset - cursor);
    const indent = box.left - left - columnOf[index];
    const height = box.lines * lineHeight + FLOAT_SLACK_PX;
    // Always there, even with no width: it is what the next gap goes below.
    floats.push({ side: "left", width: indent, height, clear: true });
    const beyond = width - indent - textWidth;
    if (beyond > 0) floats.push({ side: "right", width: beyond, height, clear: false });
    cursor = offset + height;
  });
  return { left, top, width, columns, columnHeight, floats };
}
