import React from "react";
interface TooltipProps {
    content: React.ReactNode;
    children: React.ReactElement<React.HTMLAttributes<HTMLElement> & React.RefAttributes<HTMLElement>>;
    className?: string;
    /** Delay pointer-triggered tooltips; keyboard focus always opens immediately. */
    delayMs?: number;
    /** Keep the tooltip open while it is hovered so its contents can be selected. */
    interactive?: boolean;
    size?: "default" | "wide";
}
export declare function Tooltip({ content, children, className, delayMs, interactive, size, }: TooltipProps): React.JSX.Element;
export {};
//# sourceMappingURL=Tooltip.d.ts.map