"use client"

import { useEffect, useRef } from "react"

import { useTranslations } from "@workspace/i18n"

import { Spinner } from "@workspace/ui/components/spinner"

import { cn } from "@workspace/ui/lib/utils"
import type { VIEW } from "@/frontend/pages/partners/types"

/**
 * The scrolling shell every partner list shares: the responsive container,
 * the empty state, and the sentinel that pulls the next page in shortly
 * before the end of the list reaches the viewport.
 *
 * Same contract as the orders list — the page itself only decides which row
 * component to render.
 */
export function PartnersList<T>({
    items,
    view,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isFiltered,
    getKey,
    children,
}: {
    items: T[]
    view: VIEW
    hasNextPage: boolean
    isFetchingNextPage: boolean
    fetchNextPage: () => void
    isFiltered: boolean
    getKey: (item: T) => string
    children: (item: T) => React.ReactNode
}) {
    const t = useTranslations("Admin.partners.data")
    const sentinelRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = sentinelRef.current
        if (!el) return

        const observer = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
                fetchNextPage()
            }
        }, { rootMargin: "200px" })

        observer.observe(el)
        return () => observer.disconnect()
    }, [hasNextPage, isFetchingNextPage, fetchNextPage])

    if (items.length === 0) {
        // "Nothing matched" and "nothing here yet" are different problems and
        // need different answers from the reader
        return (
            <p className="text-muted-foreground py-10 text-center text-sm">
                {t(isFiltered ? "no-results" : "empty")}
            </p>
        )
    }

    return (
        <>
            <div className={cn(
                view === "grid"
                    ? "grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3"
                    : "flex flex-col gap-4",
            )}>
                {items.map((item) => (
                    <div key={getKey(item)}>{children(item)}</div>
                ))}
            </div>

            {hasNextPage && (
                <div ref={sentinelRef} className="flex justify-center py-2">
                    {isFetchingNextPage && <Spinner className="text-primary" />}
                </div>
            )}
        </>
    )
}
