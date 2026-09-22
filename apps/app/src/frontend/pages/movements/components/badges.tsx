"use client"

import { IconArrowNarrowRight, IconFlag, IconGavel, IconMapPinOff, IconRouteOff } from "@tabler/icons-react"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { StatusBadge } from "@workspace/ui/customs/badge/status-badge"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { cn } from "@workspace/ui/lib/utils"

import {
    movementTone,
    type Currency,
    type Location,
    type MovementExecution,
    type MovementFlag,
    type MovementPing,
    type MovementRole,
    type MovementStatus,
} from "@/frontend/pages/movements/types"

/** How a place reads in a cell: the province, or the first line of the address. */
export const place = (location: Location) =>
    location.state || location.address.split(",")[0]?.trim() || location.address

/**
 * The label for a status: one word per stored value, the same on a chip, a
 * tab and a trail line, whichever list the load is on. "Planning" names a
 * section of Trips, never a status.
 */
export function useStatusLabel() {
    const t = useTranslations("App.loads.status")

    return (status: MovementStatus) => t(status)
}

/**
 * What taking a move is called. Leaving a stop or an issue is resuming the
 * stage the truck was held up at, and says so, rather than reading as if
 * the truck reached that stage again.
 */
export function useMoveLabel() {
    const t = useTranslations("App.loads.actions")
    const label = useStatusLabel()

    return (from: MovementStatus, to: MovementStatus) => {
        const held = from === "stopped" || from === "issue"
        const resumes = held && to !== "stopped" && to !== "issue" && to !== "cancelled"

        return resumes ? t("resume", { status: label(to) }) : t(`to.${to}`)
    }
}

/**
 * The colour tokens live on the order vocabulary, so each load status
 * borrows the order status that means the same thing (`movementTone`) — the
 * same pairing the map pins use, so a chip and a pin of one colour agree.
 */
export function MovementStatusChip({ status, className }: { status: MovementStatus; className?: string }) {
    const label = useStatusLabel()

    return <StatusBadge status={movementTone(status)} label={label(status)} className={cn("text-xs", className)} />
}

/**
 * A company on the load says something went wrong with it. Not a status: the
 * load keeps its own, and this sits beside it until the dispute is resolved.
 */
export function InDisputeChip() {
    const t = useTranslations("App.loads.disputes")

    return (
        <Badge variant="outline" className="border-destructive/40 text-destructive gap-1 rounded-full font-normal">
            <IconGavel className="size-3" stroke={1.5} />
            {t("chip")}
        </Badge>
    )
}

/**
 * The row's own warning, beside its number, so a load that needs a hand is
 * seen without opening it: a flag for what the load still lacks (named on
 * hover), and a pin for a driver asked today who has not answered.
 */
export function AttentionMarks({ flags, silent }: { flags: MovementFlag[]; silent: boolean }) {
    const t = useTranslations("App.loads.filters")
    const label = useFlagLabel()

    return (
        <>
            {flags.length > 0 && (
                <span title={flags.map(label).join(" · ")} className="flex shrink-0">
                    <IconFlag className="text-destructive size-3.5" stroke={1.5} aria-label={flags.map(label).join(", ")} />
                </span>
            )}
            {silent && (
                <span title={t("silent")} className="flex shrink-0">
                    <IconMapPinOff className="size-3.5 text-amber-600 dark:text-amber-400" stroke={1.5} aria-label={t("silent")} />
                </span>
            )}
        </>
    )
}

/** The truck answered a recent slot from beyond the planned route's corridor. */
export function OffRouteChip() {
    const t = useTranslations("App.loads.tracking")

    return (
        <Badge variant="outline" className="gap-1 rounded-full border-amber-500/40 font-normal text-amber-600 dark:text-amber-400">
            <IconRouteOff className="size-3" stroke={1.5} />
            {t("off-route-chip")}
        </Badge>
    )
}

/**
 * Who the reader is to a load somebody else owns: work a partner offered
 * it, or a load moved for it. The owner's own rows carry no chip.
 */
export function RoleChip({ role }: { role: MovementRole }) {
    const t = useTranslations("App.loads.role")

    if (role === "owner") return null

    return (
        <Badge variant="outline" className="rounded-full font-normal">
            {t(role)}
        </Badge>
    )
}

/**
 * What one missing thing is called. Nothing on a load is ever blocked for
 * want of a driver, a truck, a partner or a price — it is flagged, and the
 * flag is the name of what is still to be filled in.
 */
export function useFlagLabel() {
    const t = useTranslations("App.loads.flags")

    return (flag: MovementFlag) => t(flag)
}

/** Said in red where the value of a flagged field would have been. */
export function MissingValue({ flag, className }: { flag: MovementFlag; className?: string }) {
    const label = useFlagLabel()

    return <span className={cn("text-destructive", className)}>{label(flag)}</span>
}

/** Trip or order — which of the two shapes a load is. */
export function ExecutionChip({ execution }: { execution: MovementExecution }) {
    const t = useTranslations("App.loads.execution")

    return (
        <Badge variant="secondary" className="rounded-full font-normal">
            {t(execution)}
        </Badge>
    )
}

/** The lane, on one line: where it loads, where it offloads. */
export function LaneCell({ origin, destination }: { origin: Location; destination: Location }) {
    return (
        <span className="flex min-w-0 items-center gap-1 text-[13px]">
            <span className="truncate">{place(origin)}</span>
            <IconArrowNarrowRight className="text-muted-foreground size-3.5 shrink-0" stroke={1.5} />
            <span className="truncate">{place(destination)}</span>
        </span>
    )
}

/**
 * An amount in its own currency, the way the rest of the portal writes one.
 * Never converted: a load may be priced in two.
 */
export function useMoney() {
    const f = useFormatter()

    return (amount: number, currency: Currency) => `${f.number(amount, { maximumFractionDigits: 2 })} ${currency}`
}

export function Money({ amount, currency, className }: { amount: number; currency: Currency; className?: string }) {
    const money = useMoney()

    return <span className={cn("tabular-nums", className)}>{money(amount, currency)}</span>
}

/**
 * When the driver last reported, and from where. The clock ticks once a
 * minute so a list left open does not keep claiming the last pin is fresh.
 */
export function LastPingCell({ ping }: { ping: MovementPing | null }) {
    const t = useTranslations("App.loads.values")
    const f = useFormatter()
    const now = useNow({ updateInterval: 60_000 })

    if (!ping) {
        return (
            <span className="text-muted-foreground/70 flex items-center gap-1.5 text-[13px]">
                <IconMapPinOff className="size-3.5 shrink-0" stroke={1.5} />
                {t("no-pings")}
            </span>
        )
    }

    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px]">{f.relativeTime(ping.recordedAt, now)}</span>
            {ping.placeName ? (
                <span className="text-muted-foreground truncate text-xs">{ping.placeName}</span>
            ) : (
                <span className="text-muted-foreground text-xs">
                    {f.dateTime(ping.recordedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
            )}
        </div>
    )
}

/** A date that was never recorded says so rather than leaving a blank. */
export function LoadDate({ value, empty }: { value: Date | null; empty: string }) {
    const f = useFormatter()

    if (!value) return <EmptyValue label={empty} />

    return <span className="text-[13px]">{f.dateTime(value, { dateStyle: "medium" })}</span>
}
