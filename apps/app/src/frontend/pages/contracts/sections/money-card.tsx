"use client"

import { useTranslations } from "@workspace/i18n"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"
import { DetailRow, SectionCard } from "@workspace/ui/customs/detail/section-card"
import { Dash } from "@workspace/ui/customs/list/table-cells"

import type { ContractDetail } from "@/frontend/pages/contracts/types"
import { useMoney } from "@/frontend/pages/movements/components/badges"
import { useShareLabel } from "@/frontend/pages/contracts/sections/allocations-card"

/**
 * The order's money, rolled up from its trips: what it is worth at the
 * agreed price, what the trips filed so far come to, what has moved and
 * what is still owed — from where the reader stands. The owner reads both
 * sides (what the client pays it, what it pays its transporters, per
 * transporter); a client what it pays; a transporter what it is paid on
 * its share. Payments themselves are recorded on each trip (TripsCard);
 * this is the sum, never a store of its own.
 */
export function MoneyCard({ contract }: { contract: ContractDetail }) {
    const t = useTranslations("App.contracts.detail.money")
    const money = useMoney()
    const shareLabel = useShareLabel()

    const { role } = contract
    const { lines, byShare } = contract.money
    const earns = role !== "client"
    const pays = role !== "carrier"
    const shareOf = (allocationId: string) => contract.allocations.find((allocation) => allocation.id === allocationId)

    const head = "h-8 px-2 text-xs font-normal"
    const cell = "px-2 py-2 text-[13px] tabular-nums"

    return (
        <SectionCard title={t("title")}>
            {lines.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("empty")}</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {lines.map((line) => (
                        <dl key={line.currency} className="flex flex-col gap-2">
                            {lines.length > 1 && <dt className="text-muted-foreground text-xs font-medium">{line.currency}</dt>}
                            <DetailRow label={t("committed")}>
                                {line.committed === null ? <span className="text-muted-foreground">{t("open")}</span> : money(line.committed, line.currency)}
                            </DetailRow>
                            {earns && (
                                <>
                                    <DetailRow label={t(role === "owner" ? "filed-earn" : "filed")}>{money(line.filed, line.currency)}</DetailRow>
                                    <DetailRow label={t("received")}>{money(line.received, line.currency)}</DetailRow>
                                    <DetailRow label={t("receivable")}><span className={line.receivable > 0 ? "font-medium" : undefined}>{money(line.receivable, line.currency)}</span></DetailRow>
                                </>
                            )}
                            {pays && (role === "client" || line.payable > 0 || line.paid > 0) && (
                                <>
                                    <DetailRow label={t(role === "owner" ? "payable-carriers" : "filed")}>{money(line.payable, line.currency)}</DetailRow>
                                    <DetailRow label={t("paid")}>{money(line.paid, line.currency)}</DetailRow>
                                    <DetailRow label={t("outstanding")}><span className={line.outstanding > 0 ? "font-medium" : undefined}>{money(line.outstanding, line.currency)}</span></DetailRow>
                                </>
                            )}
                        </dl>
                    ))}

                    {role === "owner" && byShare.length > 0 && (
                        <div className="flex flex-col gap-2 border-t pt-3.5">
                            <span className="text-muted-foreground text-xs font-medium">{t("by-share")}</span>
                            <div className="container-snap -mx-5 overflow-x-auto px-5 [&_[data-slot=table-container]]:overflow-visible">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className={head}>{t("share")}</TableHead>
                                            <TableHead className={`${head} text-right`}>{t("filed-short")}</TableHead>
                                            <TableHead className={`${head} text-right`}>{t("paid")}</TableHead>
                                            <TableHead className={`${head} text-right`}>{t("outstanding")}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {byShare.map((share) => {
                                            const allocation = shareOf(share.allocationId)

                                            return (
                                                <TableRow key={`${share.allocationId}:${share.currency}`}>
                                                    <TableCell className={cell}>{allocation ? shareLabel(allocation) : <Dash />}</TableCell>
                                                    <TableCell className={`${cell} text-right`}>{money(share.filed, share.currency)}</TableCell>
                                                    <TableCell className={`${cell} text-right`}>{money(share.paid, share.currency)}</TableCell>
                                                    <TableCell className={`${cell} text-right ${share.outstanding > 0 ? "font-medium" : ""}`}>{money(share.outstanding, share.currency)}</TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </SectionCard>
    )
}
