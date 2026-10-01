"use client"

import { useState } from "react"
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { IconArrowUpRight, IconCash, IconDownload } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Spinner } from "@workspace/ui/components/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { Dash, Mono } from "@workspace/ui/customs/list/table-cells"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import type { ContractDetail } from "@/frontend/pages/contracts/types"
import { MovementStatusChip, useMoney } from "@/frontend/pages/movements/components/badges"
import { downloadLoadsCsv } from "@/frontend/pages/movements/lib/export-csv"
import { PaymentDialog } from "@/frontend/pages/movements/sections/payment-dialog"
import { movementsListInput } from "@/frontend/pages/movements/types"

/**
 * The trips filed under the contract so far — under the shares the reader
 * may see. Each opens its own load page; the loads list, filtered on the
 * contract, has the rest of the kit, and the same slice downloads from here
 * as the file that list would give. Where a trip's settlement stands is on
 * the row, and the owner records a payment on it from here — the same
 * dialog the load page opens, on the trip's own legs.
 */
export function TripsCard({ contract }: { contract: ContractDetail }) {
    const t = useTranslations("App.contracts.detail")
    const tv = useTranslations("App.orders")
    const ts = useTranslations("App.loads.money.settlement")
    const f = useFormatter()
    const money = useMoney()
    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const [payingId, setPayingId] = useState<string | null>(null)
    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const [isExporting, setExporting] = useState(false)

    const exportRows = async () => {
        setExporting(true)
        try {
            // The list's own builder, read as if the page were opened on this contract
            const { page: _page, pageSize: _pageSize, ...input } = movementsListInput(
                "all",
                (key) => (key === "contract" ? contract.id : null),
                session.organization.type,
            )
            const items = await queryClient.fetchQuery(trpc.movements.export.queryOptions(input))
            downloadLoadsCsv(`loads-${contract.ref}`, items)
        } finally {
            setExporting(false)
        }
    }

    const head = "h-8 px-2 text-xs font-normal"
    const cell = "px-2 py-2.5 text-[13px]"

    return (
        <SectionCard
            title={t("trips")}
            count={contract.trips.length}
            aside={contract.trips.length > 0 ? (
                <span className="inline-flex items-center gap-3">
                    <button
                        type="button"
                        disabled={isExporting}
                        onClick={exportRows}
                        className="hover:text-foreground inline-flex cursor-pointer items-center gap-0.5 disabled:cursor-default"
                    >
                        {t("export")}
                        {isExporting ? <Spinner className="size-3.5" /> : <IconDownload className="size-3.5" stroke={1.5} />}
                    </button>
                    <Link
                        href={{ pathname: "/orders/[section]", params: { section: "all" }, query: { contract: contract.id } }}
                        className="hover:text-foreground inline-flex items-center gap-0.5"
                    >
                        {t("open-all")}
                        <IconArrowUpRight className="size-3.5" stroke={1.5} />
                    </Link>
                </span>
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
                                <TableHead className={head}>{t("trip-columns.payment")}</TableHead>
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
                                    <TableCell className={cell}>
                                        {trip.settlement ? (
                                            <span className="flex items-center gap-1.5">
                                                <Badge variant={trip.settlement === "completed" ? "default" : "outline"} className="rounded-full font-normal">
                                                    {ts(trip.settlement)}
                                                </Badge>
                                                {trip.canRecordPayment && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setPayingId(trip.id)}
                                                        title={t("actions.record-payment")}
                                                        aria-label={t("actions.record-payment")}
                                                        className="text-muted-foreground hover:text-foreground cursor-pointer"
                                                    >
                                                        <IconCash className="size-4" stroke={1.5} />
                                                    </button>
                                                )}
                                            </span>
                                        ) : <Dash />}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {payingId && (
                <TripPayment
                    loadId={payingId}
                    onClose={() => {
                        setPayingId(null)
                        void queryClient.invalidateQueries({ queryKey: trpc.contracts.get.queryKey({ id: contract.id }) })
                    }}
                />
            )}
        </SectionCard>
    )
}

/** The load page's payment dialog, on a trip picked from the order: the trip is read when asked for. */
function TripPayment({ loadId, onClose }: { loadId: string; onClose: () => void }) {
    const trpc = useTRPC()
    const { data: load } = useQuery(trpc.movements.get.queryOptions({ id: loadId }))

    if (!load) return null

    return <PaymentDialog load={load} onClose={onClose} />
}
