import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useSyncExternalStore } from "react";
import { act, render as rtlRender, } from "@testing-library/react";
import { vi } from "vitest";
import { ReaderHostProvider } from "../ReaderHost";
/** The one capability the readers ask a host to perform. */
export const openExternalSpy = vi.fn();
const DEFAULT_HOST = {
    openExternal: openExternalSpy,
    colorScheme: "light",
};
/**
 * Render a reader with a host, and let the test change that host afterwards --
 * appearance is something a real host changes at runtime, so a reader's
 * response to it has to be testable without re-mounting.
 */
export function renderWithReaderHost(ui, options = {}) {
    const { host: initialHost, ...renderOptions } = options;
    const listeners = new Set();
    let value = { ...DEFAULT_HOST, ...initialHost };
    function Wrapper({ children }) {
        const host = useSyncExternalStore((onChange) => {
            listeners.add(onChange);
            return () => listeners.delete(onChange);
        }, () => value);
        return _jsx(ReaderHostProvider, { value: host, children: children });
    }
    const result = rtlRender(ui, { wrapper: Wrapper, ...renderOptions });
    return {
        ...result,
        setHost(patch) {
            value = { ...value, ...patch };
            act(() => {
                listeners.forEach((onChange) => onChange());
            });
        },
    };
}
/**
 * Stand-in host chrome for the selection slot. Deliberately not any real
 * application's menu: what a reader owes the slot is a position, a selection
 * and a working pin, and those are what this exercises.
 */
export function stubSelectionSlot(handlers = {}) {
    return (selection, api) => (_jsxs("div", { children: [_jsx("button", { type: "button", onClick: () => {
                    handlers.onAction?.(selection);
                    api.clear();
                    api.dismiss();
                }, children: "Stub action" }), _jsx("input", { placeholder: "Stub input", onFocus: () => api.setPinned(true), onBlur: () => api.setPinned(false) })] }));
}
//# sourceMappingURL=readerHarness.js.map