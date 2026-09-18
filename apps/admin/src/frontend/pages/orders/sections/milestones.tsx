"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { Order } from "@workspace/db/orders"

import { cn } from "@workspace/ui/lib/utils"

import { deriveMilestones, type MilestoneEntry } from "@workspace/domain/orders/milestones"

/**
 * Where the trip is on its chain, one line per stage with the date it was
 * reached. The steps themselves come from the shared derivation, so this rail
 * and the details page's horizontal strip can never disagree.
 */
export function Milestones({ order, history }: { order: Order; history: MilestoneEntry[] }) {
    const t = useTranslations("Admin.orders.list.sheet")
    const tStatus = useTranslations("Admin.orders.header.filters.status.options")
    const f = useFormatter()

    const steps = deriveMilestones(order, history)
    const date = (value: Date) => f.dateTime(value, { day: "numeric", month: "short" })

    return (
        <ol className="relative flex flex-col gap-0 pl-4 before:absolute before:top-2 before:bottom-2 before:left-[3px] before:w-px before:bg-border">
            {steps.map((step) => {
                const note = step.onTime === null ? null : step.onTime ? t("on-time") : t("late")

                return (
                    <li key={step.status} className="relative pb-3 text-[13px] last:pb-0">
                        <span
                            aria-hidden
                            className={cn(
                                "bg-card absolute top-1.5 -left-4 size-2 rounded-full border-[1.5px]",
                                step.state === "pending" && "border-border",
                                step.state === "done" && "border-emerald-500 bg-emerald-500",
                                step.state === "current" && step.tone === "chain" && "border-primary bg-primary ring-3 ring-primary/20",
                                step.state === "current" && step.tone === "warning" && "border-amber-500 bg-amber-500 ring-3 ring-amber-500/20",
                                step.state === "current" && step.tone === "danger" && "border-destructive bg-destructive ring-3 ring-destructive/20",
                            )}
                        />
                        <span className={cn("block leading-tight", step.state === "pending" && "text-muted-foreground", step.state === "current" && "font-medium")}>
                            {tStatus(step.status)}
                        </span>
                        <span className="text-muted-foreground block text-xs tabular-nums">
                            {step.at
                                ? step.state === "current" ? t("since", { date: date(step.at) }) : date(step.at)
                                : step.expected ? t("expected", { date: date(step.expected) }) : " "}
                            {note && ` · ${note}`}
                        </span>
                    </li>
                )
            })}
        </ol>
    )
}
