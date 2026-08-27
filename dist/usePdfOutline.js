import { useEffect, useState } from "react";
function normalize(items) {
    return items.map((item) => ({
        title: item.title,
        dest: item.dest ?? null,
        url: item.url ?? null,
        items: item.items ? normalize(item.items) : [],
    }));
}
/**
 * Loads the document outline (the PDF's own table of contents / bookmarks tree)
 * via `pdf.getOutline()`. Returns `null` while loading or when the document has
 * no outline, letting callers hide the TOC affordance entirely.
 */
export function usePdfOutline(pdf) {
    const [outline, setOutline] = useState(null);
    useEffect(() => {
        let cancelled = false;
        setOutline(null);
        if (!pdf)
            return;
        pdf
            .getOutline()
            .then((items) => {
            if (cancelled)
                return;
            setOutline(items && items.length > 0 ? normalize(items) : null);
        })
            .catch((e) => {
            if (!cancelled)
                console.error("Failed to load PDF outline:", e);
        });
        return () => {
            cancelled = true;
        };
    }, [pdf]);
    return outline;
}
//# sourceMappingURL=usePdfOutline.js.map