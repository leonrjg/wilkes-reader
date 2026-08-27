/**
 * Substrate-agnostic controller for an in-document find bar: open/close state,
 * the query string, and which of `matchCount` matches is active. It owns the
 * keyboard contract (Cmd/Ctrl+F to open, Esc to close, Enter / Shift+Enter to
 * step) so every viewer -- PDF, Markdown -- shares one behaviour. How matches
 * are computed and drawn is left entirely to the caller.
 */
export declare function useDocumentFind(matchCount: number): {
    inputRef: import("react").RefObject<HTMLInputElement | null>;
    isOpen: boolean;
    open: () => void;
    close: () => void;
    query: string;
    setQuery: import("react").Dispatch<import("react").SetStateAction<string>>;
    currentIdx: number;
    next: () => void;
    prev: () => void;
    onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
};
export type DocumentFind = ReturnType<typeof useDocumentFind>;
//# sourceMappingURL=useDocumentFind.d.ts.map