import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
export const ZOOM_STEP = 0.1;
/**
 * The −/percentage/+ zoom cluster shared by the PDF and Markdown viewers. It is
 * purely presentational: each viewer keeps its own zoom state, clamping, and the
 * meaning of a zoom step (canvas scale vs. font size), and passes the handlers.
 * Rendered as a fragment so callers own the surrounding container.
 */
export default function ZoomControls({ zoom, onZoomIn, onZoomOut }) {
    return (_jsxs(_Fragment, { children: [_jsx("button", { onClick: onZoomOut, "aria-label": "Zoom out", className: "px-1.5 py-0.5 hover:text-[var(--accent-blue)]", children: "\u2212" }), _jsxs("span", { className: "w-12 text-center font-mono", children: [Math.round(zoom * 100), "%"] }), _jsx("button", { onClick: onZoomIn, "aria-label": "Zoom in", className: "px-1.5 py-0.5 hover:text-[var(--accent-blue)]", children: "+" })] }));
}
//# sourceMappingURL=ZoomControls.js.map