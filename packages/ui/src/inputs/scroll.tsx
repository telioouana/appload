"use client"

import { useEffect } from "react"
import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { useIntersectionObserver } from "@workspace/ui/hooks/use-intersection-observer"

interface Props {
    isManual?: boolean
    hasNextPage: boolean
    isFetchingNextPage: boolean
    fetchNextPage: () => void
}

export function InfiniteScroll({
    isManual = false,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
}: Props) {
    const { targetRef, isIntersecting } = useIntersectionObserver({
        threshold: 0.5,
        rootMargin: "100px"
    })
    const t = useTranslations("Miscellaneous.infinite-scroll")

    useEffect(() => {
        if (isIntersecting && hasNextPage && !isFetchingNextPage && !isManual) {
            fetchNextPage()
        }
    }, [
        isIntersecting,
        hasNextPage,
        isFetchingNextPage,
        isManual,
        fetchNextPage,
    ])
    return (
        <div className="flex flex-col items-center gap-4 p-4 w-full">
            <div ref={targetRef} className="h-1" />

            {hasNextPage
                ? (
                    <Button
                        variant="secondary"
                        disabled={!hasNextPage || isFetchingNextPage}
                        onClick={() => fetchNextPage()}
                    >
                        {isFetchingNextPage ? t("loading") : t("more")}
                    </Button>
                )
                : <p className="text-muted-foreground text-xs">{t("end")}</p>
            }
        </div>
    )
}