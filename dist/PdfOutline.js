import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { X } from "react-feather";
import { Tooltip } from "./Tooltip";
function OutlineItems({ nodes, depth, onNavigateToDestination, onOpenExternal, }) {
    return (_jsx("ul", { className: "text-xs text-[var(--text-main)]", children: nodes.map((node, index) => {
            const navigable = Boolean(node.dest || node.url);
            return (_jsxs("li", { children: [_jsx(Tooltip, { content: node.title, children: _jsx("button", { type: "button", disabled: !navigable, onClick: () => {
                                if (node.url)
                                    onOpenExternal(node.url);
                                else if (node.dest)
                                    onNavigateToDestination(node.dest);
                            }, style: { paddingLeft: `${8 + depth * 12}px` }, className: "block w-full text-left truncate py-1 pr-2 rounded hover:bg-[var(--bg-active)] disabled:opacity-60 disabled:cursor-default", children: node.title }) }), node.items.length > 0 && (_jsx(OutlineItems, { nodes: node.items, depth: depth + 1, onNavigateToDestination: onNavigateToDestination, onOpenExternal: onOpenExternal }))] }, `${depth}-${index}`));
        }) }));
}
/**
 * Docked sidebar listing the PDF's own outline (table of contents). Entries
 * navigate through the same destination resolver used by in-page links.
 */
export default function PdfOutline({ outline, onNavigateToDestination, onOpenExternal, onClose, }) {
    return (_jsxs("aside", { className: "w-64 shrink-0 flex flex-col border-r border-[var(--border-main)] bg-[var(--bg-app)] overflow-hidden", children: [_jsxs("div", { className: "flex items-center justify-between px-3 py-2 border-b border-[var(--border-main)]", children: [_jsx("span", { className: "text-xs font-semibold text-[var(--text-dim)] uppercase tracking-wide", children: "Contents" }), _jsx(Tooltip, { content: "Close table of contents", children: _jsx("button", { type: "button", onClick: onClose, className: "p-1 rounded hover:bg-[var(--bg-active)] text-[var(--text-dim)] hover:text-[var(--accent-red)]", children: _jsx(X, { size: 14 }) }) })] }), _jsx("div", { className: "flex-1 overflow-auto py-1", children: _jsx(OutlineItems, { nodes: outline, depth: 0, onNavigateToDestination: onNavigateToDestination, onOpenExternal: onOpenExternal }) })] }));
}
//# sourceMappingURL=PdfOutline.js.map