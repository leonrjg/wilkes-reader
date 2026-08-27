import type { DocumentFind } from "./useDocumentFind";
interface FindBarProps {
    find: DocumentFind;
    matchCount: number;
    /** Optional spinner shown while an async matcher (e.g. PDF) is still scanning. */
    isSearching?: boolean;
}
/**
 * Presentational find bar shared by every viewer that offers in-document find.
 * All state lives in the {@link DocumentFind} controller; this only renders it.
 */
export default function FindBar({ find, matchCount, isSearching }: FindBarProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=FindBar.d.ts.map