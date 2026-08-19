"use client"

import { IconChevronRight } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Card, CardContent } from "@workspace/ui/components/card"

import { cn } from "@workspace/ui/lib/utils"

/**
 * The shell every partner row and card shares: an identity block, a set of
 * labelled fields, and the row actions.
 *
 * The single responsive decision lives here. Fields are a two-column grid on
 * a phone and a twelve-track row from `xl` up, so the same markup serves
 * both the card grid and the list view — no separate mobile component to
 * keep in sync, and no horizontal scrolling.
 */
export function PartnerRow({
    view,
    name,
    image,
    fallback,
    meta,
    badges,
    fields,
    onReview,
}: {
    view: "grid" | "list"
    name: string
    image?: string | null
    /** Initials or a plate fragment when there is no image */
    fallback: string
    meta?: React.ReactNode
    badges?: React.ReactNode
    /**
     * Rendered through `<Fields view={view}>` so the twelve-track classes
     * only apply where a twelve-track container exists
     */
    fields: React.ReactNode
    onReview: () => void
}) {
    const t = useTranslations("Admin.partners.review")
    const isList = view === "list"

    return (
        <Card className="transition-colors hover:border-primary/40">
            <CardContent className={cn(
                "flex flex-col gap-4 p-4",
                isList && "xl:flex-row xl:items-center xl:gap-6",
            )}>
                <div className={cn(
                    "flex min-w-0 items-center gap-3",
                    isList && "xl:w-64 xl:shrink-0",
                )}>
                    <Avatar className="size-10 shrink-0">
                        {image && <AvatarImage src={image} alt={name} />}
                        <AvatarFallback className="text-xs font-medium">{fallback}</AvatarFallback>
                    </Avatar>

                    <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate text-sm font-medium">{name}</span>
                        {meta && <span className="text-muted-foreground truncate text-xs">{meta}</span>}
                        {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
                    </div>
                </div>

                <div className={cn(
                    "grid grid-cols-2 gap-4",
                    isList ? "min-w-0 flex-1 xl:grid-cols-12" : "sm:grid-cols-3",
                )}>
                    {fields}
                </div>

                <Button
                    variant="outline"
                    size="sm"
                    onClick={onReview}
                    className={cn("w-full shrink-0", isList && "xl:w-auto")}
                >
                    {t("open")}
                    <IconChevronRight className="size-4" stroke={1.5} />
                </Button>
            </CardContent>
        </Card>
    )
}

/**
 * Applies a field's desktop track span only in list view.
 *
 * In grid view the container is `sm:grid-cols-3`, so an `xl:col-span-4` from
 * a row component would land on a three-track grid and blow the card apart
 * at ≥1280px. Row components declare the span they want and this decides
 * whether it is meaningful.
 */
export function trackSpan(view: "grid" | "list", span: string) {
    return view === "list" ? span : undefined
}

/** Initials for an avatar fallback: at most two letters, always uppercase. */
export function initials(value: string) {
    return value
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase() ?? "")
        .join("") || "?"
}
