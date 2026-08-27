import type { ByteRange } from "./documentCoordinates";
/** A byte range the rendered markdown should mark up.
 *
 *  `className` rather than a fixed `kind`: what a mark *means* is the host's
 *  business, and this plugin only needs to know which runs share a class so it
 *  can cut spans at the boundaries between them. */
export interface TextAnnotation {
    id: string;
    range: ByteRange;
    className?: string;
}
interface HastNode {
    type: string;
    tagName?: string;
    value?: string;
    position?: {
        start: {
            offset?: number;
        };
        end: {
            offset?: number;
        };
    };
    properties?: Record<string, unknown>;
    children?: HastNode[];
}
/**
 * Map every UTF-16 boundary in rendered text back to a UTF-16 source boundary.
 * Markdown punctuation is skipped; escapes and entities are consumed as one
 * visible character. Positions supplied by mdast bound the search to the
 * originating source node, so repeated text elsewhere cannot interfere.
 */
export declare function renderedBoundaries(source: string, rendered: string, start: number, end: number): number[];
/** Rehype plugin that makes every rendered text run addressable in source bytes. */
export declare function sourceMappedMarkdown(content: string, annotations: TextAnnotation[]): () => (tree: HastNode) => void;
export declare function sourceBoundaryForDomPoint(node: Node, offset: number): number | null;
export {};
//# sourceMappingURL=markdownSourceMap.d.ts.map