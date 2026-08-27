/**
 * Resolve a PDF GoTo destination to a concrete page and spatial anchor.
 *
 * Handles both named destinations (looked up via `getDestination`) and explicit
 * destination arrays. All consumers (navigation, hover previews, and future
 * link affordances) share this resolver so a link cannot point to one place on
 * click and describe another place on hover.
 */
export async function resolveDestination(pdf, dest) {
    const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0)
        return null;
    const pageRef = explicit[0];
    const pageIndex = await pdf.getPageIndex(pageRef);
    const mode = explicit[1]?.name;
    let destX = null;
    let destY = null;
    if (mode === "XYZ") {
        destX = typeof explicit[2] === "number" ? explicit[2] : null;
        destY = typeof explicit[3] === "number" ? explicit[3] : null;
    }
    else if (mode === "FitH" || mode === "FitBH") {
        destY = typeof explicit[2] === "number" ? explicit[2] : null;
    }
    else if (mode === "FitV" || mode === "FitBV") {
        destX = typeof explicit[2] === "number" ? explicit[2] : null;
    }
    else if (mode === "FitR") {
        // FitR packs [ref, {name:"FitR"}, left, bottom, right, top]. The upper-left
        // corner is the natural text-preview/navigation anchor.
        destX = typeof explicit[2] === "number" ? explicit[2] : null;
        destY = typeof explicit[5] === "number" ? explicit[5] : null;
    }
    let offsetX = null;
    let offsetY = null;
    if (destX !== null || destY !== null) {
        const page = await pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 1 });
        const pageLeft = page.view[0];
        const pageTop = page.view[3];
        // Supply the page's upper-left coordinate for an unconstrained axis. This
        // keeps conversion correct on cropped/rotated pages without pretending the
        // destination constrained that axis (its returned offset remains null).
        const [vx, vy] = viewport.convertToViewportPoint(destX ?? pageLeft, destY ?? pageTop);
        const [a, b, c, d] = viewport.transform;
        const epsilon = 1e-8;
        // A cropped/rotated viewport can swap or mix PDF-space axes. Mark a
        // viewport coordinate precise only when every source axis contributing to
        // it was constrained by the destination.
        const exactViewportX = (Math.abs(a) <= epsilon || destX !== null) &&
            (Math.abs(c) <= epsilon || destY !== null);
        const exactViewportY = (Math.abs(b) <= epsilon || destX !== null) &&
            (Math.abs(d) <= epsilon || destY !== null);
        if (exactViewportX)
            offsetX = vx;
        if (exactViewportY)
            offsetY = vy;
    }
    return { pageIndex, mode: mode ?? null, offsetX, offsetY };
}
//# sourceMappingURL=pdfDestinations.js.map