"use client"

import { useLinkStatus } from "next/link"

import { cn } from "@workspace/ui/lib/utils"

/**
 * The label of the link being followed, pulsing while the next page is
 * still on its way — the wait a route costs before its skeleton can paint
 * (a not-yet-compiled one in dev, an unprefetched one on a slow link).
 * `animate-pulse` eases in over a second, so a page that lands in a blink
 * never shows it.
 */
export function NavPending({ className, children }: { className?: string; children: React.ReactNode }) {
    const { pending } = useLinkStatus()

    return <span className={cn(className, pending && "animate-pulse")}>{children}</span>
}
