const positions = new Map();
export function savePdfScrollPosition(url, position) {
    positions.set(url, position);
}
export function readPdfScrollPosition(url) {
    return positions.get(url) ?? null;
}
//# sourceMappingURL=pdfScrollMemory.js.map