import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext } from "react";
const ReaderHostContext = createContext(null);
export function ReaderHostProvider({ value, children, }) {
    return _jsx(ReaderHostContext.Provider, { value: value, children: children });
}
export function useReaderHost() {
    const host = useContext(ReaderHostContext);
    if (!host) {
        throw new Error("Reader components must be rendered inside <ReaderHostProvider>; " +
            "it supplies openExternal and the reader settings.");
    }
    return host;
}
//# sourceMappingURL=ReaderHost.js.map