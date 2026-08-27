// ReadableStream async iteration, for engines that lack it.
//
// pdf.js 6 implements `PDFPageProxy.getTextContent()` as `for await (const
// value of readableStream)`. That needs `ReadableStream.prototype[Symbol
// .asyncIterator]`, which WebKit does not implement — verified against a bare
// WKWebView on macOS 26.5, where both the prototype and instance property read
// `undefined`. So in Tauri's macOS webview every getTextContent() call throws
// "undefined is not a function", taking down auto-zoom, link previews and
// in-document search. pdf.js 5 read the same stream through a reader and was
// unaffected, so this arrived with the version bump.
//
// This installs the standard behaviour when it is missing; it is not an
// alternative path. Iteration stays pdf.js' single mechanism for draining the
// text stream — the engine simply gains the operator the spec says it has.
//
// Callers install it explicitly, immediately before the pdf.js call that needs
// it, rather than relying on an import for its side effect: a bundler told the
// package is side-effect-free would tree-shake such an import away and silently
// drop the fix on the two of three platforms that need it. Installing is a
// typeof check once the operator is there, so calling it per use costs nothing.
/** WHATWG `ReadableStream.prototype.values`, which `Symbol.asyncIterator` aliases. */
function values({ preventCancel = false } = {}) {
    const reader = this.getReader();
    const iterator = {
        async next() {
            try {
                const result = await reader.read();
                if (result.done)
                    reader.releaseLock();
                return result;
            }
            catch (error) {
                reader.releaseLock();
                throw error;
            }
        },
        async return(value) {
            if (!preventCancel)
                await reader.cancel(value);
            reader.releaseLock();
            return { done: true, value };
        },
        [Symbol.asyncIterator]() {
            return iterator;
        },
    };
    return iterator;
}
/** Returns true when the engine was missing the operator and it was installed. */
export function installReadableStreamAsyncIterator() {
    if (typeof ReadableStream === "undefined")
        return false;
    const proto = ReadableStream.prototype;
    if (typeof proto[Symbol.asyncIterator] === "function")
        return false;
    for (const key of ["values", Symbol.asyncIterator]) {
        Object.defineProperty(proto, key, {
            value: values,
            writable: true,
            configurable: true,
        });
    }
    console.info("Installed ReadableStream async iteration: this engine lacks it and pdf.js requires it to read page text.");
    return true;
}
//# sourceMappingURL=readableStreamAsyncIterator.js.map