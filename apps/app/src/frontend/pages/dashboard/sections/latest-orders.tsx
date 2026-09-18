"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconArrowRight } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"

import { Link, useRouter } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { Dash, Mono } from "@workspace/ui/customs/list/table-cells"
import { LATEST_LIMIT, latestLoadsInput } from "@/frontend/pages/dashboard/types"
import { MovementStatusChip, place as loadPlace, useMoney } from "@/frontend/pages/movements/components/badges"
import { defaultTab, type MovementRow } from "@/frontend/pages/movements/types"

/** The other company on a load, from where the reader stands. */
const partyOf = (row: MovementRow) =>
    row.role === "owner" ? (row.execution === "partner" ? row.carrier : row.client)?.name ?? null : row.owner?.name ?? null

/**
 * The loads filed most recently, whichever tab they are on: the company's
 * own trucks and its partners' — Appload's among them, which are loads of
 * its own like any other. One table, newest first, as a plain table rather
 * than the list kit's: nothing here sorts, selects or pages. A row opens the
 * page where every decision on it is taken.
 */
export function LatestOrders() {
    const t = useTranslations("App.dashboard")
    const columns = useTranslations("App.loads.columns")
    const f = useFormatter()
    const loadMoney = useMoney()
    const trpc = useTRPC()
    const router = useRouter()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: orders } = useSuspenseQuery(trpc.movements.list.queryOptions(latestLoadsInput("orders")))
    const { data: trips } = useSuspenseQuery(trpc.movements.list.queryOptions(latestLoadsInput("trips")))

    const lines: MovementRow[] = [...orders.items, ...trips.items]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, LATEST_LIMIT)

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 pt-4 pb-2 ring-1">
            <header className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">{t("loads.latest.title")}</h2>

                {/* Both tabs feed this table; "view all" opens the one the
                    company lands on */}
                <Link
                    href={{ pathname: "/orders/[section]", params: { section: "all" }, query: { tab: defaultTab(session.organization.type) } }}
                    className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 text-xs"
                >
                    {t("view-all")}
                    <IconArrowRight className="size-3.5" stroke={1.5} />
                </Link>
            </header>

            {lines.length === 0 ? (
                <p className="text-muted-foreground pb-2 text-sm">{t("loads.latest.empty")}</p>
            ) : (
                // The kit's table brings a scroll container of its own; opened
                // up so this one wrapper is what scrolls, with the scrollbar hidden
                <div className="container-snap -mx-5 overflow-x-auto px-5 [&_[data-slot=table-container]]:overflow-visible">
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="h-8 px-2 text-xs font-normal">{columns("ref")}</TableHead>
                                <TableHead className="h-8 px-2 text-xs font-normal">{columns("partner")}</TableHead>
                                <TableHead className="hidden h-8 px-2 text-xs font-normal md:table-cell">{columns("lane")}</TableHead>
                                <TableHead className="hidden h-8 px-2 text-xs font-normal md:table-cell">{columns("dates")}</TableHead>
                                <TableHead className="h-8 px-2 text-xs font-normal">{columns("status")}</TableHead>
                                <TableHead className="h-8 px-2 text-right text-xs font-normal">{t("loads.latest.amount")}</TableHead>
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {lines.map((row) => {
                                const figure = row.receivable ?? row.payable

                                return (
                                    <TableRow
                                        key={row.id}
                                        onClick={() => router.push({ pathname: "/orders/load/[loadId]", params: { loadId: row.id } })}
                                        className="cursor-pointer"
                                    >
                                        <TableCell className="px-2 py-2.5">
                                            {/* The whole row opens the load for a mouse;
                                                this is the same door for a keyboard */}
                                            <Link href={{ pathname: "/orders/load/[loadId]", params: { loadId: row.id } }}>
                                                <Mono>{row.ref}</Mono>
                                            </Link>
                                        </TableCell>
                                        <TableCell className="px-2 py-2.5 text-[13px]">
                                            <span className="block max-w-44 truncate">{partyOf(row) ?? <Dash />}</span>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground hidden px-2 py-2.5 text-[13px] md:table-cell">
                                            {`${loadPlace(row.origin)} → ${loadPlace(row.destination)}`}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground hidden px-2 py-2.5 text-[13px] tabular-nums md:table-cell">
                                            {row.expectedLoadingDate ? f.dateTime(row.expectedLoadingDate, { dateStyle: "medium" }) : <Dash />}
                                        </TableCell>
                                        <TableCell className="px-2 py-2.5">
                                            <MovementStatusChip status={row.status} />
                                        </TableCell>
                                        <TableCell className="px-2 py-2.5 text-right text-[13px] tabular-nums">
                                            {figure ? loadMoney(figure.total, figure.currency) : <Dash />}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </section>
    )
}
