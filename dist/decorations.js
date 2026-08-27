export function elementAnchor(element) {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { left, top, right, bottom };
}
/** The rect-anchored decorations that fall on one page. */
export function rectDecorationsForPage(decorations, page) {
    return decorations.filter((decoration) => decoration.anchor.kind === "rects" && decoration.anchor.page === page);
}
/** The range-anchored decorations, in document order. */
export function rangeDecorations(decorations) {
    return decorations
        .filter((decoration) => decoration.anchor.kind === "range")
        .map((decoration) => ({
        id: decoration.id,
        range: decoration.anchor.range,
        className: decoration.className,
        ariaLabel: decoration.ariaLabel,
    }))
        .sort((a, b) => a.range.start - b.range.start);
}
/** Bounding envelope of a set of rectangles. */
export function unionBox(rects) {
    const x1 = Math.min(...rects.map((r) => r.x));
    const y1 = Math.min(...rects.map((r) => r.y));
    const x2 = Math.max(...rects.map((r) => r.x + r.width));
    const y2 = Math.max(...rects.map((r) => r.y + r.height));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
//# sourceMappingURL=decorations.js.map