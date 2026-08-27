/** Locate every case-insensitive occurrence of `query` in the rendered text and
 *  return a DOM Range per match. Exported for testing without the Highlight API. */
export declare function findMatchRanges(root: HTMLElement, query: string): Range[];
interface Options {
    rootRef: React.RefObject<HTMLElement | null>;
    content: string;
    query: string;
    isOpen: boolean;
    currentIdx: number;
    onMatchCount: (count: number) => void;
}
/**
 * In-document find for the rendered Markdown viewer. Matches are painted with
 * the CSS Custom Highlight API rather than by wrapping DOM nodes, so React keeps
 * sole ownership of the tree and the source-map spans are left untouched.
 */
export declare function useMarkdownFind({ rootRef, content, query, isOpen, currentIdx, onMatchCount }: Options): void;
export {};
//# sourceMappingURL=useMarkdownFind.d.ts.map