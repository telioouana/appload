"use client"

import { useState } from "react"
import { IconArrowLeft, IconChevronDown, IconPencil, IconPlayerPlay, IconPlus, IconTruck, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu"

import { Link } from "@/i18n/navigation"
import { AllocationDialog } from "@/frontend/pages/contracts/sections/allocation-dialog"
import { shareExecution, useShareLabel } from "@/frontend/pages/contracts/sections/allocations-card"
import { ContractRoleChip, ContractStateChip, unitOf, useUnitLabel } from "@/frontend/pages/contracts/sections/badges"
import { CloseContractDialog } from "@/frontend/pages/contracts/sections/close-contract-dialog"
import { ContractSheet } from "@/frontend/pages/contracts/sections/contract-sheet"
import { useContractMutations } from "@/frontend/pages/contracts/hooks/use-contract-mutations"
import type { AllocationView, ContractDetail } from "@/frontend/pages/contracts/types"
import { place } from "@/frontend/pages/movements/components/badges"
import { useNewLoad } from "@/frontend/pages/movements/hooks/use-new-load"

/**
 * The top of a contract's page: the way back to the tab it sits in, what
 * the contract is and where it stands, who is on the other side of it for
 * the reader, and the things the reader can do about it now — the owner
 * edits, activates, closes and allocates; anybody with a share files a
 * trip under it.
 */
export function ContractHeader({ contract }: { contract: ContractDetail }) {
    const t = useTranslations("App.contracts")
    const f = useFormatter()
    const shareLabel = useShareLabel()
    const unitLabel = useUnitLabel()

    const { transition } = useContractMutations()
    const { open: openNewLoad } = useNewLoad()

    const [editing, setEditing] = useState(false)
    const [allocating, setAllocating] = useState(false)
    const [closing, setClosing] = useState(false)

    const owner = contract.role === "owner"
    const { permissions, allocations } = contract

    // The other company on the contract, from where the reader stands
    const party = owner ? contract.client?.name : contract.owner.name
    const lane = contract.origin && contract.destination
        ? `${place(contract.origin)} → ${place(contract.destination)}`
        : t("values.any-lane")
    const period = `${f.dateTime(new Date(contract.startsOn), { dateStyle: "medium" })} – ${f.dateTime(new Date(contract.endsOn), { dateStyle: "medium" })}`

    // The countdown as trucks come to load: what is left, and roughly how
    // many more trucks at the size of the ones filed so far — once there
    // are enough of them to say
    const { remaining, consumed, trips } = contract.progress
    const trucksLeft = contract.basis === "weight" && remaining !== null && remaining > 0 && trips >= 3 && consumed > 0
        ? Math.ceil(remaining / (consumed / trips))
        : null

    // One share needs no asking which; several do
    const only = allocations.length === 1 ? allocations[0] : undefined
    const fileTrip = (allocation: AllocationView) =>
        openNewLoad(shareExecution(contract, allocation), { contractAllocationId: allocation.id })

    return (
        <>
            <header className="flex flex-col gap-4 px-2 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <Button asChild size="icon" variant="outline" aria-label={t("title")} className="mt-4 shrink-0">
                        <Link href={{ pathname: "/orders/[section]", params: { section: "multi" }, query: { tab: owner ? "own" : "partners" } }}>
                            <IconArrowLeft className="size-4" stroke={1.5} />
                        </Link>
                    </Button>

                    <div className="flex min-w-0 flex-col gap-1">
                        <nav className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            <span>{t("title")}</span>
                            <span aria-hidden>/</span>
                            <span className="text-foreground/70">{t(`tabs.${owner ? "own" : "partners"}`)}</span>
                        </nav>

                        <div className="flex flex-wrap items-center gap-2.5">
                            <h1 className="font-heading truncate font-mono text-2xl font-semibold tracking-tight">{contract.ref}</h1>
                            <ContractStateChip state={contract.state} />
                            {!owner && <ContractRoleChip role={contract.role} />}
                        </div>

                        <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-sm">
                            {party && (
                                <>
                                    <span className="truncate">{party}</span>
                                    <span aria-hidden>·</span>
                                </>
                            )}
                            <span className="truncate">{lane}</span>
                            <span aria-hidden>·</span>
                            <span className="truncate">{period}</span>
                        </p>

                        {remaining !== null && contract.state !== "closed" && (
                            <p className="text-sm tabular-nums">
                                <span className={remaining > 0 ? "font-medium" : "text-muted-foreground"}>
                                    {t("detail.remaining-line", { remaining: unitLabel(unitOf(contract.basis), Math.max(remaining, 0)) })}
                                </span>
                                {trucksLeft !== null && <span className="text-muted-foreground"> · {t("detail.trucks-left", { count: trucksLeft })}</span>}
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 lg:mt-6">
                    {permissions.canFileTrip && (
                        only ? (
                            <Button size="sm" onClick={() => fileTrip(only)}>
                                <IconTruck className="size-4" stroke={1.5} />
                                {t("detail.actions.file-trip")}
                            </Button>
                        ) : (
                            // Several shares: the trip has to say which one it draws down
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button size="sm">
                                        <IconTruck className="size-4" stroke={1.5} />
                                        {t("detail.actions.file-trip")}
                                        <IconChevronDown className="size-3.5" stroke={1.5} />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-52">
                                    {allocations.map((allocation) => (
                                        <DropdownMenuItem key={allocation.id} onSelect={() => fileTrip(allocation)}>
                                            {shareLabel(allocation)}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )
                    )}

                    {permissions.canAllocate && (
                        <Button size="sm" variant="outline" onClick={() => setAllocating(true)}>
                            <IconPlus className="size-4" stroke={1.5} />
                            {t("detail.actions.allocate")}
                        </Button>
                    )}

                    {permissions.canAccept && (
                        <Button
                            size="sm"
                            disabled={transition.isPending}
                            onClick={() => transition.mutate({ id: contract.id, to: "active", expectedVersion: contract.version })}
                        >
                            {t("detail.actions.accept")}
                        </Button>
                    )}
                    {permissions.canDecline && (
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={transition.isPending}
                            onClick={() => transition.mutate({ id: contract.id, to: "closed", expectedVersion: contract.version })}
                        >
                            {t("detail.actions.decline")}
                        </Button>
                    )}
                    {permissions.canActivate && (
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={transition.isPending}
                            onClick={() => transition.mutate({ id: contract.id, to: "active", expectedVersion: contract.version })}
                        >
                            <IconPlayerPlay className="size-4" stroke={1.5} />
                            {t("detail.actions.activate")}
                        </Button>
                    )}

                    {permissions.canEdit && (
                        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                            <IconPencil className="size-4" stroke={1.5} />
                            {t("detail.actions.edit")}
                        </Button>
                    )}

                    {permissions.canClose && (
                        <Button size="sm" variant="ghost" onClick={() => setClosing(true)}>
                            <IconX className="size-4" stroke={1.5} />
                            {t("detail.actions.close")}
                        </Button>
                    )}
                </div>
            </header>

            {permissions.canEdit && (
                <ContractSheet open={editing} onOpenChange={setEditing} mode={{ kind: "edit", contract }} />
            )}

            {allocating && <AllocationDialog mode={{ kind: "create", contract }} onClose={() => setAllocating(false)} />}

            {permissions.canClose && <CloseContractDialog contract={contract} open={closing} onOpenChange={setClosing} />}
        </>
    )
}
