"use client"

import { IconChevronDown, IconChevronLeft, IconChevronRight } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { cn } from "@workspace/ui/lib/utils"

import { useListParams } from "@/components/list/use-list-params"

/** The page numbers worth showing around the current one: 1 … 4 5 6 … 29 */
function pageWindow(page: number, pages: number): (number | "gap")[] {
    if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1)

    const around = new Set([1, pages, page - 1, page, page + 1])
    if (page <= 3) [2, 3, 4].forEach((n) => around.add(n))
    if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => around.add(n))

    const sorted = [...around].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
    const result: (number | "gap")[] = []

    sorted.forEach((n, index) => {
        if (index > 0 && n - (sorted[index - 1] as number) > 1) result.push("gap")
        result.push(n)
    })

    return result
}

/**
 * "Showing x–y of N", the page numbers and the page-size menu. Writes
 * `page` and `size` to the URL like every other list control, so a paged
 * view survives a refresh and can be shared.
 */
export function ListFooter({
    page,
    pageSize,
    total,
    pageSizes,
}: {
    page: number
    pageSize: number
    total: number
    pageSizes: readonly number[]
}) {
    const t = useTranslations("App.list")
    const { set } = useListParams()

    const pages = Math.max(1, Math.ceil(total / pageSize))
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1
    const to = Math.min(page * pageSize, total)

    const goTo = (next: number) => set({ key: "page", value: next <= 1 ? null : String(next) })

    return (
        <div className="text-muted-foreground flex flex-col items-center gap-3 border-t px-4 py-2.5 text-[13px] sm:flex-row sm:justify-between">
            <span className="tabular-nums">{t("showing", { from, to, total })}</span>

            <nav aria-label={t("pagination")} className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => goTo(page - 1)} aria-label={t("previous")}>
                    <IconChevronLeft className="size-4" stroke={1.5} />
                </Button>

                {pageWindow(page, pages).map((entry, index) =>
                    entry === "gap" ? (
                        <span key={`gap-${index}`} className="px-1">…</span>
                    ) : (
                        <button
                            key={entry}
                            type="button"
                            aria-current={entry === page ? "page" : undefined}
                            onClick={() => goTo(entry)}
                            className={cn(
                                "text-foreground hover:bg-muted flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-full px-2 text-[13px] tabular-nums transition-colors",
                                entry === page && "bg-primary text-primary-foreground hover:bg-primary/90 font-medium",
                            )}
                        >
                            {entry}
                        </button>
                    ),
                )}

                <Button variant="ghost" size="icon-sm" disabled={page >= pages} onClick={() => goTo(page + 1)} aria-label={t("next")}>
                    <IconChevronRight className="size-4" stroke={1.5} />
                </Button>
            </nav>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button type="button" className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 tabular-nums">
                        {t("per-page", { count: pageSize })}
                        <IconChevronDown className="size-3.5" stroke={1.5} />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                    <DropdownMenuRadioGroup
                        value={String(pageSize)}
                        onValueChange={(value) => set([
                            { key: "size", value: Number(value) === pageSizes[0] ? null : value },
                            { key: "page", value: null },
                        ])}
                    >
                        {pageSizes.map((size) => (
                            <DropdownMenuRadioItem key={size} value={String(size)}>
                                {t("per-page", { count: size })}
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
