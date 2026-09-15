"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconArrowRight } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"

/**
 * The company's own fleet, in two numbers: what is in progress, and whose
 * driver was asked for a position today and has not answered. Both open the
 * trips list already narrowed to exactly what they counted — the same stats
 * the list's own tiles read.
 */
export function TripsTile() {
    const t = useTranslations("App.dashboard")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.movements.stats.queryOptions({ scope: "trips" }))

    const inProgress = data.bySection["in-progress"] ?? 0

    const figures = [
        {
            key: "in-progress",
            label: t("trips.in-progress"),
            value: inProgress,
            query: undefined,
            warn: false,
        },
        {
            key: "no-response",
            label: t("trips.no-response"),
            value: data.silent,
            query: { silent: "1" },
            warn: data.silent > 0,
        },
    ]

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <header className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">{t("trips.title")}</h2>

                <Link
                    href={{ pathname: "/trips/[section]", params: { section: "all" } }}
                    className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 text-xs"
                >
                    {t("view-all")}
                    <IconArrowRight className="size-3.5" stroke={1.5} />
                </Link>
            </header>

            <div className="grid grid-cols-2 gap-3">
                {figures.map((figure) => (
                    <Link
                        key={figure.key}
                        href={{ pathname: "/trips/[section]", params: { section: "in-progress" }, query: figure.query }}
                        className="hover:bg-muted/50 flex flex-col rounded-xl px-1 py-0.5 transition-colors"
                    >
                        <span className="text-muted-foreground truncate text-xs font-medium">{figure.label}</span>
                        <span className={cn(
                            "text-xl leading-tight font-semibold tracking-tight tabular-nums",
                            figure.warn && "text-amber-600 dark:text-amber-400",
                        )}>
                            {f.number(figure.value)}
                        </span>
                    </Link>
                ))}
            </div>
        </section>
    )
}
