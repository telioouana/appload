"use client"

import { Fragment } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { Scroller } from "@workspace/ui/customs/list/scroller"
import { useKpiRows } from "@/frontend/pages/kpis/hooks/use-kpi-rows"
import { reportInput } from "@/frontend/pages/kpis/types"

/**
 * Every indicator the PDF carries, in the templates' own order and grouping,
 * so the page and the downloaded report can be read side by side without
 * hunting. The charts above answer "how did this go"; this answers "what
 * exactly does that mean", which is the table Claire quotes from.
 */
export function KpiTable() {
    const t = useTranslations("Admin.kpis")
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { party } = useParams<{ party: string }>()

    const { data } = useSuspenseQuery(
        trpc.kpis.report.queryOptions(reportInput(party, (key) => searchParams.get(key))),
    )
    const groups = useKpiRows(data)

    const head = "h-8 px-2 text-xs font-normal"

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 pt-4 pb-2 ring-1">
            <h2 className="text-sm font-medium">{t("table.title")}</h2>

            <Scroller axis="x" className="[&_[data-slot=table-container]]:overflow-visible">
                <Table className="text-xs">
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            <TableHead className={head}>{t("table.columns.indicator")}</TableHead>
                            <TableHead className={head}>{t("table.columns.unit")}</TableHead>
                            <TableHead className={cn(head, "text-right")}>{t("table.columns.value")}</TableHead>
                        </TableRow>
                    </TableHeader>

                    <TableBody>
                        {groups.map((group) => (
                            <Fragment key={group.key}>
                                <TableRow className="bg-muted/40 text-xs font-medium hover:bg-muted/40">
                                    <TableCell colSpan={3} className="px-2 py-1.5">
                                        {group.title}
                                    </TableCell>
                                </TableRow>

                                {group.rows.map((row) => (
                                    <TableRow
                                        key={row.key}
                                        className={cn("hover:bg-transparent", row.muted && "text-muted-foreground italic")}
                                    >
                                        <TableCell className="px-2 py-2">{row.label}</TableCell>
                                        <TableCell className="text-muted-foreground px-2 py-2">{row.unit}</TableCell>
                                        <TableCell className="px-2 py-2 text-right tabular-nums">{row.value}</TableCell>
                                    </TableRow>
                                ))}
                            </Fragment>
                        ))}
                    </TableBody>
                </Table>
            </Scroller>
        </section>
    )
}
