"use client"

import { useEffect, useRef } from "react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"
import { statusIcons } from "@workspace/ui/customs/badge/status-badge"

import { Scroller } from "@/components/list/scroller"
import type { MilestoneStep } from "@/frontend/pages/orders/lib/milestones"

/**
 * Wide enough for two lines of the longest status name at 12px in either
 * language. The track keeps this per node and scrolls rather than squeezing:
 * a regional trip that also waited for documents is eleven stages, and an
 * interruption makes twelve, which fits no phone at a readable size.
 */
const NODE_WIDTH = 132

/**
 * Where the trip is, across the top of the page: one node per stage with the
 * date it was reached, and the stage it is on marked. The steps come from
 * the shared derivation Appload's own order page uses, so the two surfaces
 * can never disagree about where a trip is.
 */
export function MilestoneRail({ steps }: { steps: MilestoneStep[] }) {
    const t = useTranslations("App.orders.detail")
    const tStatus = useTranslations("App.orders.status")
    const f = useFormatter()

    const day = (value: Date) => f.dateTime(value, { day: "numeric", month: "short" })

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 rounded-2xl px-5 py-4 ring-1">
            <Scroller axis="x">
                <ol
                    aria-label={t("trip")}
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
                            date={step.at
                                ? (step.state === "current" ? t("since", { date: day(step.at) }) : day(step.at))
                                : step.expected
                                    ? t("expected", { date: day(step.expected) })
                                    : null}
                        />
                    ))}
                </ol>
            </Scroller>
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
}: {
    step: MilestoneStep
    first: boolean
    last: boolean
    previousDone: boolean
    label: string
    date: string | null
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
            </span>
        </li>
    )
}
