"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconArrowRight } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"

import { useTRPC } from "@/backend/api/client"
import { Link } from "@/i18n/navigation"
import { Mono } from "@/components/list/table-cells"
import { latestInput } from "@/frontend/pages/dashboard/types"
import { useOrderSheet } from "@/frontend/pages/orders/hooks/use-order-sheet"
import { useMoney } from "@/frontend/pages/orders/sections/order-item-parts"
import { OrderStatusBadge, place } from "@/frontend/pages/orders/sections/order-item-shared"

/**
 * The eight orders touched most recently, as a plain table rather than the
 * list kit's `DataTable`: nothing here sorts, selects or pages, and a row
 * opens the same `?id=` sheet the lists open, so the dashboard never has to
 * hand the order over to another page to show it.
 */
export function LatestOrders() {
    const t = useTranslations("Admin.dashboard")
    const f = useFormatter()
    const trpc = useTRPC()
    const money = useMoney()
    const { open } = useOrderSheet()

    const { data } = useSuspenseQuery(trpc.orders.list.queryOptions(latestInput()))

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 pt-4 pb-2 ring-1">
            <header className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">{t("latest.title")}</h2>

                <Link
                    href={{ pathname: "/orders/all", query: { sort: "updated" } }}
                    className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 text-xs"
                >
                    {t("view-all")}
                    <IconArrowRight className="size-3.5" stroke={1.5} />
                </Link>
            </header>

            {data.items.length === 0 ? (
                <p className="text-muted-foreground pb-2 text-sm">{t("latest.empty")}</p>
            ) : (
                // The kit's table brings a scroll container of its own; opened up
                // so this one wrapper is what scrolls, with the scrollbar hidden
                <div className="container-snap -mx-5 overflow-x-auto px-5 [&_[data-slot=table-container]]:overflow-visible">
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="h-8 px-2 text-xs font-normal">{t("latest.columns.order")}</TableHead>
                                <TableHead className="h-8 px-2 text-xs font-normal">{t("latest.columns.parties")}</TableHead>
                                <TableHead className="hidden h-8 px-2 text-xs font-normal md:table-cell">{t("latest.columns.route")}</TableHead>
                                <TableHead className="hidden h-8 px-2 text-xs font-normal md:table-cell">{t("latest.columns.loading")}</TableHead>
                                <TableHead className="h-8 px-2 text-xs font-normal">{t("latest.columns.status")}</TableHead>
                                <TableHead className="h-8 px-2 text-right text-xs font-normal">{t("latest.columns.total")}</TableHead>
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {data.items.map((order) => (
                                <TableRow
                                    key={order.orderId}
                                    onClick={() => open(order.orderId)}
                                    className="cursor-pointer"
                                >
                                    <TableCell className="px-2 py-2.5">
                                        {/* The whole row opens the sheet for a
                                            mouse; this is the same door for a
                                            keyboard, which cannot click a `tr` */}
                                        <button
                                            type="button"
                                            onClick={() => open(order.orderId)}
                                            className="cursor-pointer"
                                        >
                                            <Mono>{order.orderId}</Mono>
                                        </button>
                                    </TableCell>

                                    <TableCell className="px-2 py-2.5 text-[13px]">
                                        <span className="block max-w-44 truncate">{order.shipperName}</span>
                                        <span className="text-muted-foreground block max-w-44 truncate text-xs">
                                            {/* A prospect has no carrier yet; the dash keeps the column in line */}
                                            {order.carrierName ?? "—"}
                                        </span>
                                    </TableCell>

                                    <TableCell className="text-muted-foreground hidden px-2 py-2.5 text-[13px] md:table-cell">
                                        {`${place(order.loadingAddress)} → ${place(order.offloadingAddress)}`}
                                    </TableCell>

                                    <TableCell className="text-muted-foreground hidden px-2 py-2.5 text-[13px] tabular-nums md:table-cell">
                                        {f.dateTime(order.expectedLoadingDate, { dateStyle: "medium" })}
                                    </TableCell>

                                    <TableCell className="px-2 py-2.5">
                                        <OrderStatusBadge status={order.status} />
                                    </TableCell>

                                    <TableCell className="px-2 py-2.5 text-right text-[13px] tabular-nums">
                                        {money(order.shipperTotal, order.shipperCurrency)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </section>
    )
}
