"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconArrowRight } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"

import { Link, useRouter } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { Dash, Mono } from "@workspace/ui/customs/list/table-cells"
import { latestInput } from "@/frontend/pages/dashboard/types"
import { OrderStatusBadge } from "@/frontend/pages/orders/components/badges"
import { money, place } from "@/frontend/pages/orders/lib/format"

/**
 * The five orders filed most recently, as a plain table rather than the list
 * kit's `DataTable`: nothing here sorts, selects or pages. A row opens the
 * order's own page, which is where every decision on it is taken.
 *
 * Which five depends on the side of the trade: a client's own orders, or the
 * requests a carrier has been sent — the procedure resolves that from the
 * tenant, so the card asks for the newest of "your list" and the header names
 * whichever list that turned out to be.
 */
export function LatestOrders() {
    const t = useTranslations("App.dashboard")
    const columns = useTranslations("App.orders.columns")
    const f = useFormatter()
    const trpc = useTRPC()
    const router = useRouter()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data } = useSuspenseQuery(trpc.orders.list.queryOptions(latestInput()))

    const orgType = session.organization.type
    const section = orgType === "shipper" ? "all" : "requests"

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 pt-4 pb-2 ring-1">
            <header className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">{t(`latest.title.${orgType}`)}</h2>

                <Link
                    href={{ pathname: "/orders/[section]", params: { section } }}
                    className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 text-xs"
                >
                    {t("view-all")}
                    <IconArrowRight className="size-3.5" stroke={1.5} />
                </Link>
            </header>

            {data.items.length === 0 ? (
                <p className="text-muted-foreground pb-2 text-sm">{t(`latest.empty.${orgType}`)}</p>
            ) : (
                // The kit's table brings a scroll container of its own; opened
                // up so this one wrapper is what scrolls, with the scrollbar hidden
                <div className="container-snap -mx-5 overflow-x-auto px-5 [&_[data-slot=table-container]]:overflow-visible">
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="h-8 px-2 text-xs font-normal">{columns("order")}</TableHead>
                                <TableHead className="h-8 px-2 text-xs font-normal">{columns(`counterparty.${orgType}`)}</TableHead>
                                <TableHead className="hidden h-8 px-2 text-xs font-normal md:table-cell">{columns("route")}</TableHead>
                                <TableHead className="hidden h-8 px-2 text-xs font-normal md:table-cell">{columns("dates")}</TableHead>
                                <TableHead className="h-8 px-2 text-xs font-normal">{columns("status")}</TableHead>
                                <TableHead className="h-8 px-2 text-right text-xs font-normal">{columns("money")}</TableHead>
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {data.items.map((order) => (
                                <TableRow
                                    key={order.orderId}
                                    onClick={() => router.push({ pathname: "/orders/details/[orderId]", params: { orderId: order.orderId } })}
                                    className="cursor-pointer"
                                >
                                    <TableCell className="px-2 py-2.5">
                                        {/* The whole row opens the order for a
                                            mouse; this is the same door for a
                                            keyboard, which cannot click a `tr` */}
                                        <Link href={{ pathname: "/orders/details/[orderId]", params: { orderId: order.orderId } }}>
                                            <Mono>{order.orderId}</Mono>
                                        </Link>
                                    </TableCell>

                                    <TableCell className="px-2 py-2.5 text-[13px]">
                                        <span className="block max-w-44 truncate">{order.counterparty.name ?? <Dash />}</span>
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
                                        {money(f, order.money.total, order.money.currency) ?? <Dash />}
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
