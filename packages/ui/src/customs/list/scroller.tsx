"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * The one element that scrolls, with the edges faded so a cut-off row or
 * node says so. Scrollbars are hidden app-wide (`container-snap`), which is
 * what makes the fades necessary: content wider than its container would
 * otherwise just stop mid-column with nothing to say it continues. One fade
 * per side, each shown only while there is something left to reach that way.
 *
 * Two shapes, because the two callers need different things:
 *
 * - `both` (the tables): fills the height the card leaves between toolbar and
 *   footer, so the column headers (sticky inside it) and everything outside
 *   stay fixed, and scrolls on both axes — a narrow viewport reaches the
 *   off-screen columns through nothing else. The UI kit's table wrapper is a
 *   scroll container of its own, which would trap the sticky header, so it is
 *   opened up here.
 * - `x` (the trip strip): height comes from the content, and only the
 *   horizontal axis scrolls. Declaring both axes here would give a strip one
 *   pixel too tall a vertical scroll context and clip its focus rings.
 *
 * The fades are painted in the card colour, so keep this on a `bg-card`
 * surface or pass a `fadeClassName` that matches the ground it sits on.
 */
export function Scroller({
    children,
    axis = "both",
    className,
    fadeClassName,
}: {
    children: React.ReactNode
    axis?: "both" | "x"
    className?: string
    fadeClassName?: string
}) {
    const ref = useRef<HTMLDivElement>(null)
    const [overflow, setOverflow] = useState({ left: false, right: false })

    // Read through the ref rather than a captured node, so re-rendered
    // content is never measured through the element it used to have
    const measure = useCallback(() => {
        const el = ref.current
        if (!el) return

        setOverflow((current) => {
            const left = el.scrollLeft > 1
            const right = el.scrollWidth - el.clientWidth - el.scrollLeft > 1
            return current.left === left && current.right === right ? current : { left, right }
        })
    }, [])

    // No dep array: everything that changes the content's width also renders
    // it — a page of rows, a column dropped from the Columns menu, the card
    // itself resizing — and this is the one signal that catches all of them.
    useEffect(measure)

    useEffect(() => {
        const el = ref.current
        if (!el) return

        el.addEventListener("scroll", measure, { passive: true })

        // Belt and braces for a width change that renders nothing, like the
        // window being dragged narrower
        const observer = new ResizeObserver(measure)
        observer.observe(el)

        return () => {
            el.removeEventListener("scroll", measure)
            observer.disconnect()
        }
    }, [measure])

    return (
        <div className={cn("relative", axis === "both" && "flex min-h-0 flex-1 flex-col", className)}>
            <div
                ref={ref}
                className={cn(
                    "container-snap",
                    axis === "both"
                        ? "min-h-0 flex-1 overflow-auto [&_[data-slot=table-container]]:overflow-visible"
                        : "overflow-x-auto",
                )}
            >
                {children}
            </div>

            <Fade side="left" show={overflow.left} className={fadeClassName} />
            <Fade side="right" show={overflow.right} className={fadeClassName} />
        </div>
    )
}

/** A soft edge over the content, hinting at what lies past it. */
function Fade({ side, show, className }: { side: "left" | "right"; show: boolean; className?: string }) {
    return (
        <div
            aria-hidden
            className={cn(
                "from-card to-card/0 pointer-events-none absolute inset-y-0 w-8 transition-opacity duration-200",
                side === "left" ? "left-0 bg-linear-to-r" : "right-0 bg-linear-to-l",
                show ? "opacity-100" : "opacity-0",
                className,
            )}
        />
    )
}
