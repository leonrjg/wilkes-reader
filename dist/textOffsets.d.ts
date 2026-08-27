import type { ByteRange } from "./documentCoordinates";
import type { DocumentSelection } from "./selection";
/** Convert a CodeMirror/JavaScript UTF-16 offset to a persisted UTF-8 byte offset. */
export declare function utf16OffsetToUtf8ByteOffset(text: string, offset: number): number;
/** Convert a persisted UTF-8 byte offset to a CodeMirror/JavaScript UTF-16 offset. */
export declare function utf8ByteOffsetToUtf16Offset(text: string, offset: number): number;
export declare function utf8ByteRangeToUtf16Range(text: string, range: ByteRange): ByteRange;
export declare function textSelectionFromUtf16Range(text: string, from: number, to: number, line: number, lineStart: number): DocumentSelection;
//# sourceMappingURL=textOffsets.d.ts.map