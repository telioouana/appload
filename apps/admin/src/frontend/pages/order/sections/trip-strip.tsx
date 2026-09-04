"use client"

import { useEffect, useRef } from "react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { Order } from "@workspace/db/orders"

import { cn } from "@workspace/ui/lib/utils"
import { statusIcons } from "@workspace/ui/customs/badge/status-badge"

import { Scroller } from "@/components/list/scroller"
import { deriveMilestones, type MilestoneStep } from "@/lib/orders/milestones"
import { daysLate } from "@/frontend/pages/orders/types"
import type { HistoryEntry } from "@/frontend/pages/order/components/history-timeline"

import { ActivityPopover } from "./activity-popover"
import { Cell, CellRow } from "./section-card"

/**
 * Wide enough for two lines of the longest status name at 12px, in either
 * language. The track keeps this per node and scrolls rather than squeezing:
 * a regional trip that also waited for documents is eleven stages, and an
 * interruption makes twelve, which fits no viewport at a readable size.
 */
const NODE_WIDTH = 132

/**
 * Trips that are over. A leg with no recorded date on one of these is a
 * gap in the record, not something running late — saying "1,640 days late"
 * about an order delivered two years ago helps nobody.
 */
const SETTLED: Order["status"][] = ["delivered", "completed", "cancelled", "underbid"]

/**
 * Where the trip is, across the top of the page: one node per stage with the
 * date it was reached, the stage it is on marked, and — under the rule — the
 * five dates operations asks for first, with the full history one click away.
 *
 * The steps come from the same derivation the order panel's vertical rail
 * uses, so the two surfaces can never disagree about where a trip is.
 */
export function TripStrip({
    order,
    entries,
    today,
    lastSeenAt,
    lastSeenPending,
}: {
    order: Order
    /** The order's whole timeline: the stages read off it, and so does the activity popover. */
    entries: HistoryEntry[]
    /** One `today` for the whole page, so no two cells disagree mid-render. */
    today: string
    lastSeenAt: Date | null
    lastSeenPending: boolean
}) {
    const t = useTranslations("Admin.orders.detailPage")
    const tSheet = useTranslations("Admin.orders.list.sheet")
    const tValues = useTranslations("Admin.orders.list.values")
    const tStatus = useTranslations("Admin.orders.header.filters.status.options")
    const f = useFormatter()

    const steps = deriveMilestones(order, entries)
    const day = (value: Date) => f.dateTime(value, { day: "numeric", month: "short" })
    const lateLabel = (days: number) => tValues("late", { days })
    const showLate = !SETTLED.includes(order.status)

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <Scroller axis="x">
                <ol
                    aria-label={t("trip.label")}
                    className="relative flex"
                    style={{ minWidth: steps.length * NODE_WIDTH }}
                >
                    {steps.map((step, index) => (
                        <Node
                            key={step.status}
                            step={step}
                            first={index === 0}
                            last={index === steps.length - 1}
                            previousDone={index > 0 && steps[index - 1]!.state === "done"}
                            label={tStatus(step.status)}
                            date={dateLine(step, {
                                day,
                                since: (date) => tSheet("since", { date }),
                                expected: (date) => tSheet("expected", { date }),
                            })}
                            note={noteLine(step, showLate ? today : null, {
                                onTime: () => tSheet("on-time"),
                                late: () => tSheet("late"),
                                daysLate: lateLabel,
                            })}
                        />
                    ))}
                </ol>
            </Scroller>

            <div className="flex flex-col gap-3 border-t pt-3.5 sm:flex-row sm:items-end sm:gap-4">
                <CellRow className="min-w-0 flex-1 border-t-0 pt-0">
                    <Cell label={t("trip.dealDate")}>
                        {order.dealDate ? f.dateTime(order.dealDate, { dateStyle: "medium" }) : <Dash />}
                    </Cell>

                    <Cell label={t("trip.loading")}>
                        <StageDate
                            actual={order.actualLoadingDate}
                            expected={order.expectedLoadingDate}
                            today={showLate ? today : null}
                            actualLabel={(date) => tSheet("loaded", { date })}
                            expectedLabel={(date) => tSheet("expected", { date })}
                            lateLabel={lateLabel}
                            day={day}
                        />
                    </Cell>

                    <Cell label={t("trip.offloading")}>
                        <StageDate
                            actual={order.actualOffloadingDate}
                            expected={order.expectedOffloadingDate}
                            today={showLate ? today : null}
                            actualLabel={(date) => tSheet("offloaded", { date })}
                            expectedLabel={(date) => tSheet("expected", { date })}
                            lateLabel={lateLabel}
                            day={day}
                        />
                    </Cell>

                    <Cell label={t("metrics.daysTraveling")}>
                        {order.daysSpendTraveling ?? <Dash />}
                    </Cell>

                    <Cell label={t("trip.lastLocation")}>
                        {lastSeenPending
                            ? <span className="bg-muted inline-block h-4 w-24 animate-pulse rounded align-middle" />
                            : lastSeenAt
                                ? f.dateTime(lastSeenAt, { dateStyle: "medium", timeStyle: "short" })
                                : <span className="text-muted-foreground font-normal">{t("trip.noPings")}</span>}
                    </Cell>
                </CellRow>

                <ActivityPopover entries={entries} />
            </div>
        </section>
    )
}

function Node({
    step,
    first,
    last,
    previousDone,
    label,
    date,
    note,
}: {
    step: MilestoneStep
    first: boolean
    last: boolean
    previousDone: boolean
    label: string
    date: string | null
    note: { text: string; late: boolean } | null
}) {
    const ref = useRef<HTMLLIElement>(null)
    const current = step.state === "current"

    // A delivered order should not open showing "Booked"
    useEffect(() => {
        if (current) ref.current?.scrollIntoView({ block: "nearest", inline: "center" })
    }, [current])

    return (
        <li
            ref={ref}
            aria-current={current ? "step" : undefined}
            className="relative flex shrink-0 grow flex-col items-center gap-1.5 px-1 py-2 text-center"
            style={{ width: NODE_WIDTH }}
        >
            {/* The rule runs between node centres, so the ends stop half a
                column short instead of hanging off the track */}
            {!first && (
                <span
                    aria-hidden
                    className={cn(
                        "absolute top-6 right-1/2 left-0 h-0.5",
                        previousDone || step.state === "done" ? "bg-emerald-500" : "bg-border",
                    )}
                />
            )}
            {!last && (
                <span
                    aria-hidden
                    className={cn(
                        "absolute top-6 right-0 left-1/2 h-0.5",
                        step.state === "done" ? "bg-emerald-500" : "bg-border",
                    )}
                />
            )}

            <span
                className={cn(
                    "bg-card text-muted-foreground relative z-1 flex size-8 items-center justify-center rounded-full border-[1.5px] [&>svg]:size-4",
                    step.state === "pending" && "border-border",
                    step.state === "done" && "border-emerald-500 bg-emerald-500 text-white",
                    current && step.tone === "chain" && "border-primary bg-primary text-primary-foreground ring-primary/20 ring-4",
                    current && step.tone === "warning" && "border-amber-500 bg-amber-500 text-amber-950 ring-4 ring-amber-500/20",
                    current && step.tone === "danger" && "border-destructive bg-destructive ring-destructive/20 text-white ring-4",
                )}
            >
                {statusIcons[step.status]}
            </span>

            <span className={cn(
                "text-xs leading-tight text-balance",
                step.state === "pending" ? "text-muted-foreground" : "font-medium",
            )}>
                {label}
            </span>

            {/* Held even when empty, so a node with no date keeps its height */}
            <span className="text-muted-foreground min-h-8 text-[11px] leading-tight tabular-nums">
                {date}
                {note && (
                    <>
                        {date ? " · " : null}
                        <span className={note.late ? "text-destructive" : undefined}>{note.text}</span>
                    </>
                )}
            </span>
        </li>
    )
}

/** A leg's date: when it happened, or when it is due and how overdue. */
function StageDate({
    actual,
    expected,
    today,
    actualLabel,
    expectedLabel,
    lateLabel,
    day,
}: {
    actual: Date | null
    expected: Date | null
    /** null once the trip is over: a missing date is a gap, not a delay */
    today: string | null
    actualLabel: (date: string) => string
    expectedLabel: (date: string) => string
    lateLabel: (days: number) => string
    day: (value: Date) => string
}) {
    if (actual) return <>{actualLabel(day(actual))}</>
    if (!expected) return <Dash />

    const days = today === null ? 0 : daysLate(expected, today)

    return (
        <>
            {expectedLabel(day(expected))}
            {days > 0 && <span className="text-destructive font-normal"> · {lateLabel(days)}</span>}
        </>
    )
}

function Dash() {
    return <span className="text-muted-foreground/60 font-normal">—</span>
}

/** The date under a node: when it happened, since when, or when it is due. */
function dateLine(
    step: MilestoneStep,
    fmt: { day: (value: Date) => string; since: (date: string) => string; expected: (date: string) => string },
): string | null {
    if (step.at) return step.state === "current" ? fmt.since(fmt.day(step.at)) : fmt.day(step.at)
    if (step.expected) return fmt.expected(fmt.day(step.expected))
    return null
}

/**
 * Punctuality on a stage that has been reached, or how far past due one that
 * has not. Only the two arrivals carry an expected date, so every other
 * pending stage simply has nothing to say.
 */
function noteLine(
    step: MilestoneStep,
    today: string | null,
    fmt: { onTime: () => string; late: () => string; daysLate: (days: number) => string },
): { text: string; late: boolean } | null {
    if (step.onTime !== null) return { text: step.onTime ? fmt.onTime() : fmt.late(), late: !step.onTime }

    if (step.state === "pending" && step.expected && today !== null) {
        const days = daysLate(step.expected, today)
        if (days > 0) return { text: fmt.daysLate(days), late: true }
    }

    return null
}
