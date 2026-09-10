"use client"

import { useCallback, useState, useTransition } from "react"
import { useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { Scroller } from "@/components/list/scroller"
import { analyticsInput, PARTNER_SORTS, type AnalyticsPartnerSort } from "@/frontend/pages/analytics/types"

/**
 * Who the company actually worked with over the period: the other party of
 * every order, ranked by whichever column matters today, with the share of
 * the period's orders each one carried.
 *
 * The ranking's own column is component state rather than a URL param: the
 * period in the address bar is what the whole page is read over, and a card
 * re-sorting itself is not a scope worth putting in a shared link. The write
 * goes through a transition, so the rows already on screen stay put while
 * the next order of them is fetched instead of collapsing to a skeleton.
 *
 * Money is USD from this company's own leg, converted at each trip's own
 * loading-day rate; a partner whose trips have no rate yet shows a dash
 * rather than a zero.
 */
export function PartnersRanking() {
    const t = useTranslations("App.analytics")
    const f = useFormatter()
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    // The order the RSC page prefetches with, so the first paint hydrates
    const [sort, setSort] = useState<AnalyticsPartnerSort>("orders")
    const [isPending, startTransition] = useTransition()

    const { data } = useSuspenseQuery(trpc.analytics.partners.queryOptions({ ...analyticsInput(get), sort }))

    const none = t("none")

    const percent = (value: number | null) =>
        value === null ? none : f.number(value, { style: "percent", maximumFractionDigits: 0 })

    const head = "h-8 px-2 text-xs font-normal"

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 pt-4 pb-2 ring-1">
            <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex flex-col">
                    <h2 className="text-sm font-medium">{t("partners.title")}</h2>
                    <p className="text-muted-foreground text-xs">{t("partners.hint")}</p>
                </div>

                <Select
                    value={sort}
                    onValueChange={(value) => startTransition(() => setSort(value as AnalyticsPartnerSort))}
                >
                    <SelectTrigger size="sm" aria-label={t("partners.sort.label")}>
                        <SelectValue />
                    </SelectTrigger>

                    <SelectContent position="popper">
                        {PARTNER_SORTS.map((option) => (
                            <SelectItem key={option} value={option}>
                                {t(`partners.sort.${option}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </header>

            {data.rows.length === 0 ? (
                <p className="text-muted-foreground pb-2 text-sm">{t("partners.empty")}</p>
            ) : (
                <Scroller axis="x" className={cn("transition-opacity", isPending && "opacity-60")}>
                    <Table className="text-xs">
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className={head}>{t("partners.columns.partner")}</TableHead>
                                <TableHead className={cn(head, "text-right")}>{t("partners.columns.orders")}</TableHead>
                                <TableHead className={cn(head, "text-right")}>{t("partners.columns.tons")}</TableHead>
                                <TableHead className={cn(head, "text-right")}>{t("partners.columns.on-time")}</TableHead>
                                <TableHead className={cn(head, "text-right")}>{t("partners.columns.usd")}</TableHead>
                                <TableHead className={cn(head, "text-right")}>{t("partners.columns.share")}</TableHead>
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {data.rows.map((row) => (
                                <TableRow key={row.organizationId} className="hover:bg-transparent">
                                    <TableCell className="px-2 py-2 font-medium">{row.name}</TableCell>
                                    <TableCell className="px-2 py-2 text-right tabular-nums">
                                        {f.number(row.orders)}
                                    </TableCell>
                                    <TableCell className="px-2 py-2 text-right tabular-nums">
                                        {f.number(row.tons, { maximumFractionDigits: 1 })}
                                    </TableCell>
                                    <TableCell className="px-2 py-2 text-right tabular-nums">
                                        {percent(row.onTimeRate)}
                                    </TableCell>
                                    <TableCell className="px-2 py-2 text-right tabular-nums">
                                        {row.usd === null ? none : f.number(row.usd, { maximumFractionDigits: 0 })}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground px-2 py-2 text-right tabular-nums">
                                        {percent(row.share)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Scroller>
            )}
        </section>
    )
}
