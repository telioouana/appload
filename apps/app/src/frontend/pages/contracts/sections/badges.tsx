"use client"

import { useCallback } from "react"
import { IconArrowNarrowRight } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { cn } from "@workspace/ui/lib/utils"

import type { ContractBasis, ContractRole, ContractState, Currency, Location, PriceModel } from "@/frontend/pages/contracts/types"

export type ContractUnit = "trip" | "ton" | "day"

/** What a contract counts in: loads, tons, or the days a truck is rented for. */
export const unitOf = (basis: ContractBasis): ContractUnit =>
    basis === "weight" ? "ton" : basis === "days" ? "day" : "trip"

/**
 * A quantity in the contract's unit, the same string on a cell, a bar and a
 * form hint. The messages carry the plural; ICU formats the number with the
 * locale's default of up to three decimals, which is all a tonnage needs.
 */
export function useUnitLabel() {
    const t = useTranslations("App.contracts.unit")

    // Stable, so a column set memoised on it is not rebuilt every render
    return useCallback((unit: ContractUnit, qty: number) => t(unit, { count: qty }), [t])
}

/**
 * Where the contract stands. Derived, not stored: the two amber ones are
 * what a contract becomes on its own — used up, or past its end date — and
 * the ones the owner sets read as plain history.
 */
const STATE_CLASS: Record<ContractState, string> = {
    draft: "text-muted-foreground",
    proposed: "border-sky-500/40 text-sky-600 dark:text-sky-400",
    active: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
    exhausted: "border-amber-500/40 text-amber-600 dark:text-amber-400",
    expired: "border-orange-500/40 text-orange-600 dark:text-orange-400",
    closed: "",
}

export function ContractStateChip({ state }: { state: ContractState }) {
    const t = useTranslations("App.contracts.states")

    return (
        <Badge variant="outline" className={cn("rounded-full font-normal", STATE_CLASS[state])}>
            {t(state)}
        </Badge>
    )
}

/** Who the reader is to the contract: its owner, its client, or a transporter with a share. */
export function ContractRoleChip({ role }: { role: ContractRole }) {
    const t = useTranslations("App.contracts.role")

    return (
        <Badge variant="outline" className="rounded-full font-normal">
            {t(role)}
        </Badge>
    )
}

/**
 * How far along the commitment is: the consumed quantity over the whole,
 * and a thin bar. Filed beyond the commitment the bar stays full and turns
 * amber — a contract can be over-drawn, and that is worth seeing. An
 * open-ended one (no total) has nothing to be far along: the consumed
 * figure alone, over an empty track.
 */
export function ProgressBar({
    consumed,
    total,
    unit,
    className,
}: {
    consumed: number
    total: number | null
    unit: ContractUnit
    className?: string
}) {
    const t = useTranslations("App.contracts.values")
    const label = useUnitLabel()

    const share = total !== null && total > 0 ? (consumed / total) * 100 : 0
    const over = share > 100

    return (
        <div className={cn("flex min-w-0 flex-col gap-1", className)}>
            <span className="truncate text-[13px] tabular-nums">
                {label(unit, consumed)}{" "}
                <span className="text-muted-foreground">
                    {total === null ? `· ${t("open")}` : t("of", { total: label(unit, total) })}
                </span>
            </span>
            <span className="bg-muted h-1.5 w-full max-w-28 overflow-hidden rounded-full">
                {total !== null && (
                    <span
                        className={cn("block h-full rounded-full", over ? "bg-amber-500" : "bg-primary")}
                        style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
                    />
                )}
            </span>
        </div>
    )
}

/**
 * A price model in one line: the amount, then how it is applied. The
 * currency is appended by hand like every money string in the portal, since
 * Intl only prints it under `style: "currency"`.
 */
export function PriceModelText({ model, currency }: { model: PriceModel | null; currency: Currency }) {
    const t = useTranslations("App.contracts.price-models")
    const f = useFormatter()
    const label = useUnitLabel()

    if (!model) return <EmptyValue label={t("none")} />

    const money = (amount: number) => `${f.number(amount, { maximumFractionDigits: 2 })} ${currency}`
    const how = t(model.model).toLocaleLowerCase()

    const text = model.model === "per-trip" ? `${money(model.rate)} ${how}`
        : model.model === "per-ton" ? `${money(model.rate)} ${how}${model.minBillableTons ? ` (≥ ${label("ton", model.minBillableTons)})` : ""}`
        : model.model === "per-day" ? `${money(model.rate)} ${how}, ${t(model.billableDays).toLocaleLowerCase()}`
        : `${money(model.total)} ${how}`

    return <span className="tabular-nums">{text}</span>
}

/** The lane, on two lines: where it loads, where it offloads. */
export function LaneCell({ origin, destination }: { origin: Location; destination: Location }) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px]">{origin.address}</span>
            <span className="text-muted-foreground flex min-w-0 items-center gap-1 truncate text-xs">
                <IconArrowNarrowRight className="size-3.5 shrink-0" stroke={1.5} />
                <span className="truncate">{destination.address}</span>
            </span>
        </div>
    )
}
