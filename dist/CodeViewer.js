import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { EditorState, RangeSetBuilder, StateField, StateEffect } from "@codemirror/state";
import { EditorView, Decoration } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { xml } from "@codemirror/lang-xml";
import { sql } from "@codemirror/lang-sql";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { go } from "@codemirror/lang-go";
import { yaml } from "@codemirror/lang-yaml";
import SelectionLayer from "./SelectionLayer";
import { useSelectionSlot } from "./selectionSlot";
import { textSelectionFromUtf16Range, utf8ByteRangeToUtf16Range } from "./textOffsets";
import { readTextScrollPosition, saveTextScrollPosition } from "./textScrollMemory";
// `Decoration` is CodeMirror's here; the reader contract's is aliased.
import { elementAnchor, rangeDecorations } from "./decorations";
import { useReaderHost } from "./ReaderHost";
// ── Highlight effect / field ──────────────────────────────────────────────────
const setHighlight = StateEffect.define();
const highlightField = StateField.define({
    create: () => Decoration.none,
    update(deco, tr) {
        for (const e of tr.effects) {
            if (e.is(setHighlight)) {
                if (e.value === null)
                    return Decoration.none;
                const { from, to } = e.value;
                const builder = new RangeSetBuilder();
                builder.add(from, to, Decoration.mark({ class: "cm-highlight-match" }));
                return builder.finish();
            }
        }
        return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
});
/** The reader's own navigation emphasis. Host decorations are *not* themed
 *  here: their classes are the host's, and so is their palette. Colours come
 *  from the shared highlight tokens in styles.css — `baseTheme` emits real CSS,
 *  so `var()` resolves against the app's `:root`. */
const highlightTheme = EditorView.baseTheme({
    ".cm-highlight-match": {
        backgroundColor: "var(--hl-active-bg)",
        borderBottom: "var(--hl-underline) solid var(--hl-active-border)",
    },
});
const setDecorations = StateEffect.define();
const decorationField = StateField.define({
    create: () => Decoration.none,
    update(deco, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setDecorations)) {
                const builder = new RangeSetBuilder();
                for (const { id, range, className } of [...effect.value].sort((a, b) => a.range.start - b.range.start)) {
                    if (range.end <= range.start)
                        continue;
                    builder.add(range.start, range.end, Decoration.mark({
                        class: className ?? "",
                        attributes: { "data-decoration-id": id },
                    }));
                }
                return builder.finish();
            }
        }
        return deco.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
});
// ── Language detection ────────────────────────────────────────────────────────
export function getLanguageExtension(lang) {
    switch (lang) {
        case "javascript":
        case "typescript":
            return javascript({ typescript: lang === "typescript" });
        case "python":
            return python();
        case "rust":
            return rust();
        case "json":
            return json();
        case "markdown":
            return markdown();
        case "html":
            return html();
        case "css":
            return css();
        case "xml":
            return xml();
        case "sql":
            return sql();
        case "cpp":
        case "c":
            return cpp();
        case "java":
            return java();
        case "go":
            return go();
        case "yaml":
            return yaml();
        default:
            return null;
    }
}
export default function CodeViewer({ content, language, documentPath, restoreScrollPosition = false, highlightLine, highlightRange, decorations = [], slots, ref, }) {
    const isDark = useReaderHost().colorScheme === "dark";
    const rootRef = useRef(null);
    const containerRef = useRef(null);
    const viewRef = useRef(null);
    const [selectionAction, setSelectionAction] = useState(null);
    const selectionSlot = useSelectionSlot({
        dismiss: () => setSelectionAction(null),
        clear: () => {
            const view = viewRef.current;
            if (!view)
                return;
            view.dispatch({ selection: { anchor: view.state.selection.main.head } });
        },
    });
    useEffect(() => {
        if (!containerRef.current)
            return;
        const langExt = getLanguageExtension(language);
        const extensions = [
            basicSetup,
            EditorState.readOnly.of(true),
            highlightField,
            decorationField,
            highlightTheme,
            EditorView.lineWrapping,
            EditorView.updateListener.of((update) => {
                if (!update.selectionSet)
                    return;
                const range = update.state.selection.main;
                if (range.empty) {
                    setSelectionAction(null);
                    return;
                }
                const from = Math.min(range.from, range.to);
                const to = Math.max(range.from, range.to);
                const quote = update.state.sliceDoc(from, to).trim();
                const root = rootRef.current;
                const coords = update.view.coordsAtPos(to);
                if (!quote || !root || !coords) {
                    setSelectionAction(null);
                    return;
                }
                const fullText = update.state.doc.toString();
                const line = update.state.doc.lineAt(from);
                const rootRect = root.getBoundingClientRect();
                setSelectionAction({
                    selection: textSelectionFromUtf16Range(fullText, from, to, line.number, line.from),
                    left: Math.min(Math.max(coords.left - rootRect.left, 8), Math.max(rootRect.width - 128, 8)),
                    top: Math.min(Math.max(coords.bottom - rootRect.top + 3, 8), Math.max(rootRect.height - 40, 8)),
                });
            }),
        ];
        if (isDark)
            extensions.push(oneDark);
        if (langExt)
            extensions.push(langExt);
        const state = EditorState.create({ doc: content, extensions });
        const view = new EditorView({ state, parent: containerRef.current });
        viewRef.current = view;
        const savePosition = () => {
            const maximum = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
            saveTextScrollPosition(documentPath, "source", maximum > 0 ? view.scrollDOM.scrollTop / maximum : 0);
        };
        const onScroll = () => savePosition();
        view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
        let frame = null;
        if (restoreScrollPosition) {
            const position = readTextScrollPosition(documentPath, "source");
            if (position !== null) {
                frame = window.requestAnimationFrame(() => {
                    view.scrollDOM.scrollTop = position * Math.max(view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight, 0);
                });
            }
        }
        return () => {
            if (frame !== null)
                window.cancelAnimationFrame(frame);
            savePosition();
            view.scrollDOM.removeEventListener("scroll", onScroll);
            view.destroy();
            viewRef.current = null;
        };
    }, [content, language, isDark, documentPath, restoreScrollPosition]);
    useEffect(() => {
        const view = viewRef.current;
        if (!view || !content)
            return;
        const docLen = view.state.doc.length;
        const from = Math.min(highlightRange.start, docLen);
        const to = Math.min(highlightRange.end, docLen);
        view.dispatch({ effects: setHighlight.of({ from, to }) });
        if (!restoreScrollPosition && highlightLine > 0 && highlightLine <= view.state.doc.lines) {
            const lineInfo = view.state.doc.line(highlightLine);
            view.dispatch({
                effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
            });
        }
    }, [content, highlightLine, highlightRange]);
    useEffect(() => {
        const view = viewRef.current;
        if (!view)
            return;
        const converted = rangeDecorations(decorations).map(({ id, range, className }) => ({
            id,
            className,
            range: utf8ByteRangeToUtf16Range(content, range),
        }));
        view.dispatch({ effects: setDecorations.of(converted) });
    }, [decorations, content]);
    useEffect(() => {
        const container = containerRef.current;
        if (!container)
            return;
        const activate = (event) => {
            const target = event.target instanceof Element
                ? event.target.closest("[data-decoration-id]")
                : null;
            const id = target?.dataset.decorationId;
            if (!id || !target)
                return;
            const decoration = decorations.find((candidate) => candidate.id === id);
            decoration?.onActivate?.(id, elementAnchor(target));
        };
        container.addEventListener("click", activate);
        return () => container.removeEventListener("click", activate);
    }, [decorations]);
    useImperativeHandle(ref, () => ({
        goToLine: (line) => {
            const view = viewRef.current;
            if (!view || line < 1 || line > view.state.doc.lines)
                return;
            view.dispatch({
                effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: "center" }),
            });
        },
        scrollToDecoration: (id) => {
            const view = viewRef.current;
            const decoration = decorations.find((candidate) => candidate.id === id);
            if (!view || decoration?.anchor.kind !== "range")
                return;
            const { start } = utf8ByteRangeToUtf16Range(content, decoration.anchor.range);
            view.dispatch({
                effects: EditorView.scrollIntoView(Math.min(start, view.state.doc.length), { y: "center" }),
            });
        },
    }), [ref, decorations, content]);
    return (_jsxs("div", { ref: rootRef, className: "relative h-full w-full overflow-hidden", children: [_jsx("div", { ref: containerRef, className: `plain-text-editor h-full w-full overflow-auto text-sm ${isDark ? "plain-text-editor--dark" : ""}` }), _jsx(SelectionLayer, { positioned: selectionAction, api: selectionSlot.api, slot: slots?.selectionActions })] }));
}
//# sourceMappingURL=CodeViewer.js.map