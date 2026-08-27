/** Session-scoped reader positions for text documents. Positions are keyed by
 * document path and presentation mode so Source and Rendered Markdown views do
 * not overwrite one another. A normalized ratio survives viewport resizing. */
export type TextViewerMode = "source" | "rendered";
export declare const MARKDOWN_MIN_ZOOM = 0.6;
export declare const MARKDOWN_MAX_ZOOM = 2.5;
export declare function saveTextScrollPosition(path: string, mode: TextViewerMode, ratio: number): void;
export declare function readTextScrollPosition(path: string, mode: TextViewerMode): number | null;
export declare function saveMarkdownZoom(path: string, zoom: number): void;
export declare function readMarkdownZoom(path: string): number;
//# sourceMappingURL=textScrollMemory.d.ts.map