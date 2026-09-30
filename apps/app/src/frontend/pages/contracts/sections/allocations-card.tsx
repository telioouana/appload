"use client"

import { useState } from "react"
import { IconPencil, IconPlus, IconTrash, IconTruck } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { PlateChip } from "@workspace/ui/customs/list/table-cells"

import { useContractMutations } from "@/frontend/pages/contracts/hooks/use-contract-mutations"
import { AllocationDialog } from "@/frontend/pages/contracts/sections/allocation-dialog"
import { PriceModelText, ProgressBar, unitOf, useUnitLabel } from "@/frontend/pages/contracts/sections/badges"
import type { AllocationView, ContractDetail } from "@/frontend/pages/contracts/types"
import type { MovementExecution } from "@/frontend/pages/movements/types"
import { useNewLoad } from "@/frontend/pages/movements/hooks/use-new-load"

/**
 * Which shape a trip filed under a share takes: the owner's own fleet is a
 * trip, a share handed to a transporter an order; a transporter's own
 * share is always its own trucks.
 */
export const shareExecution = (contract: ContractDetail, allocation: AllocationView): MovementExecution =>
    contract.role === "carrier" || allocation.carrier === null ? "own-fleet" : "partner"

/** What a share is called: the company it went to, or the owner's own fleet. */
export function useShareLabel() {
    const t = useTranslations("App.contracts.values")

    return (allocation: AllocationView) => allocation.carrier ? allocation.carrier.name ?? "—" : t("own-fleet")
}

/**
 * How the contract is split: one row per share, who moves it, how much of
 * the commitment it is and how far along, what it pays. The owner reads all
 * of them and rearranges them while the contract is open; a transporter
 * reads only its own, as what it earns.
 */
export function AllocationsCard({ contract }: { contract: ContractDetail }) {
    const t = useTranslations("App.contracts")
    const unitLabel = useUnitLabel()
    const shareLabel = useShareLabel()

    const { removeAllocation } = useContractMutations()
    const { open: openNewLoad } = useNewLoad()

    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<AllocationView | null>(null)
    const [removing, setRemoving] = useState<AllocationView | null>(null)

    const owner = contract.role === "owner"
    const { canAllocate, canFileTrip } = contract.permissions
    const unit = unitOf(contract.basis)

    return (
        <>
            <SectionCard
                title={t("detail.allocations")}
                count={contract.allocations.length}
                actions={canAllocate ? (
                    <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                        <IconPlus className="size-4" stroke={1.5} />
                        {t("detail.actions.allocate")}
                    </Button>
                ) : undefined}
            >
                <ul className="flex flex-col divide-y">
                    {contract.allocations.map((allocation) => (
                        <li key={allocation.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 flex-col gap-0.5">
                                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                                        <span className="truncate">{shareLabel(allocation)}</span>
                                        {allocation.carrier && allocation.carrier.id === null && (
                                            <Badge variant="outline" className="shrink-0 rounded-full font-normal">{t("values.typed")}</Badge>
                                        )}
                                    </span>
                                    <span className="text-muted-foreground text-xs">
                                        {t("values.trips-filed", { count: allocation.progress.trips })}
                                    </span>
                                </div>

                                <div className="flex shrink-0 items-center gap-1">
                                    {canFileTrip && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => openNewLoad(shareExecution(contract, allocation), { contractAllocationId: allocation.id })}
                                        >
                                            <IconTruck className="size-4" stroke={1.5} />
                                            {t("detail.actions.file-trip")}
                                        </Button>
                                    )}
                                    {canAllocate && (
                                        <>
                                            <Button size="icon-sm" variant="ghost" aria-label={t("allocation-form.edit-title")} onClick={() => setEditing(allocation)}>
                                                <IconPencil className="size-4" stroke={1.5} />
                                            </Button>
                                            <Button
                                                size="icon-sm"
                                                variant="ghost"
                                                aria-label={t("allocation-form.remove")}
                                                disabled={removeAllocation.isPending}
                                                onClick={() => setRemoving(allocation)}
                                            >
                                                <IconTrash className="size-4" stroke={1.5} />
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-col gap-1">
                                <ProgressBar consumed={allocation.progress.consumed} total={allocation.shareQty} unit={unit} />
                                <span className="text-muted-foreground text-xs tabular-nums">
                                    {unitLabel(unit, allocation.progress.consumed)} {t("values.of", { total: unitLabel(unit, allocation.shareQty) })}
                                    {" · "}
                                    {t("values.remaining", { qty: unitLabel(unit, allocation.progress.remaining) })}
                                </span>
                            </div>

                            {/* The owner's own fleet has no buy price: the contract's price is what the client pays */}
                            {(allocation.buyPrice || allocation.truck || allocation.driver || allocation.truckPlate) && (
                                <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                                    {allocation.buyPrice && (
                                        <div className="flex items-baseline gap-1.5">
                                            <dt className="text-muted-foreground">{t(owner ? "detail.fields.buy-price" : "detail.fields.earn-price")}</dt>
                                            <dd className="tabular-nums"><PriceModelText model={allocation.buyPrice} currency={contract.currency} /></dd>
                                        </div>
                                    )}
                                    {(allocation.truck || allocation.truckPlate) && (
                                        <div className="flex items-baseline gap-1.5">
                                            <dt className="text-muted-foreground">{t("detail.fields.truck")}</dt>
                                            <dd><PlateChip plate={allocation.truck?.plate ?? allocation.truckPlate ?? ""} /></dd>
                                        </div>
                                    )}
                                    {allocation.driver && (
                                        <div className="flex items-baseline gap-1.5">
                                            <dt className="text-muted-foreground">{t("detail.fields.driver")}</dt>
                                            <dd>{allocation.driver.name}</dd>
                                        </div>
                                    )}
                                </dl>
                            )}

                            {allocation.notes && (
                                <p className="text-muted-foreground text-xs whitespace-pre-line">{allocation.notes}</p>
                            )}
                        </li>
                    ))}
                </ul>
            </SectionCard>

            {adding && <AllocationDialog mode={{ kind: "create", contract }} onClose={() => setAdding(false)} />}
            {editing && <AllocationDialog mode={{ kind: "edit", contract, allocation: editing }} onClose={() => setEditing(null)} />}

            <AlertDialog open={removing !== null} onOpenChange={(next) => { if (!next) setRemoving(null) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("allocation-form.remove")}</AlertDialogTitle>
                        <AlertDialogDescription>{t("allocation-form.remove-confirm")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("form.cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { if (removing) removeAllocation.mutate({ id: removing.id }) }}>
                            {t("allocation-form.remove")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
