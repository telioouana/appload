"use client"

import { IconArrowUpRight } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { Dash, Mono } from "@workspace/ui/customs/list/table-cells"

import { Link } from "@/i18n/navigation"
import type { ContractDetail } from "@/frontend/pages/contracts/types"
import { MovementStatusChip, useMoney } from "@/frontend/pages/movements/components/badges"

/**
 * The trips filed under the contract so far — under the shares the reader
 * may see. Each opens its own load page; the loads list, filtered on the
 * contract, has the rest of the kit.
 */
export function TripsCard({ contract }: { contract: ContractDetail }) {
    const t = useTranslations("App.contracts.detail")
    const tv = useTranslations("App.orders")
    const f = useFormatter()
    const money = useMoney()

    const head = "h-8 px-2 text-xs font-normal"
    const cell = "px-2 py-2.5 text-[13px]"

    return (
        <SectionCard
            title={t("trips")}
            count={contract.trips.length}
            aside={contract.trips.length > 0 ? (
                <Link
                    href={{ pathname: "/orders/[section]", params: { section: "all" }, query: { contract: contract.id } }}
                    className="hover:text-foreground inline-flex items-center gap-0.5"
                >
                    {t("open-all")}
                    <IconArrowUpRight className="size-3.5" stroke={1.5} />
                </Link>
            ) : undefined}
        >
            {contract.trips.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("no-trips")}</p>
            ) : (
                // The kit's table brings a scroll container of its own; opened
                // up so this one wrapper is what scrolls, with the scrollbar hidden
                <div className="container-snap -mx-5 overflow-x-auto px-5 [&_[data-slot=table-container]]:overflow-visible">
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className={head}>{t("trip-columns.reference")}</TableHead>
                                <TableHead className={head}>{t("trip-columns.status")}</TableHead>
                                <TableHead className={head}>{t("trip-columns.loading")}</TableHead>
                                <TableHead className={`${head} text-right`}>{t("trip-columns.weight")}</TableHead>
                                <TableHead className={`${head} text-right`}>{t("trip-columns.total")}</TableHead>
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {contract.trips.map((trip) => (
                                <TableRow key={trip.id}>
                                    <TableCell className={cell}>
                                        <Link href={{ pathname: "/orders/load/[loadId]", params: { loadId: trip.id } }} className="hover:underline">
                                            <Mono className="font-medium">{trip.ref}</Mono>
                                        </Link>
                                    </TableCell>
                                    <TableCell className={cell}>
                                        <MovementStatusChip status={trip.status} />
                                    </TableCell>
                                    <TableCell className={`${cell} text-muted-foreground tabular-nums`}>
                                        {trip.expectedLoadingDate ? f.dateTime(trip.expectedLoadingDate, { dateStyle: "medium" }) : <Dash />}
                                    </TableCell>
                                    <TableCell className={`${cell} text-right tabular-nums`}>
                                        {trip.weight !== null
                                            ? `${f.number(trip.weight, { maximumFractionDigits: 3 })} ${trip.weightUnit ? tv(`weightUnit.${trip.weightUnit}`) : ""}`
                                            : <Dash />}
                                    </TableCell>
                                    <TableCell className={`${cell} text-right tabular-nums`}>
                                        {trip.total !== null && trip.currency ? money(trip.total, trip.currency) : <Dash />}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </SectionCard>
    )
}
