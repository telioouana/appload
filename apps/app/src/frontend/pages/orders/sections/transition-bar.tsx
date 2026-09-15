"use client"

import { useState } from "react"
import { IconArrowRight, IconDots, IconPlayerPlay, IconSteeringWheel } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { isDispatchMove } from "@workspace/domain/orders/dispatch-readiness"
import { primaryTransition } from "@workspace/domain/orders/transitions"

import { PlanDialog, type PlanReason } from "@/components/plan-dialog"
import { TransitionDialog } from "@/frontend/pages/orders/sections/transition-dialog"
import type { OrderDetail, TransitionOption, TransitionOptions } from "@/frontend/pages/orders/types"

/** The plan reason a blocked target carries, or null when it is blocked for anything else. */
const planReasonOf = (option: TransitionOption): PlanReason | null =>
    option.blockedReason === "SUBSCRIPTION_REQUIRED" || option.blockedReason === "QUOTA_EXCEEDED"
        ? option.blockedReason
        : null

/**
 * The carrier's controls: the one obvious next step, with everything else it
 * may legally do behind the menu. The targets come from the server, already
 * narrowed to what the tenant's own policy allows, so nothing offered here
 * can be refused for being the wrong actor.
 *
 * A "blocked" target still opens where something can be said about it: an
 * order booked without a rig is exactly what the dispatch form fills in, and
 * a dispatch the plan cannot pay for opens the dialog that explains why.
 */
export function TransitionBar({
    order,
    options,
    organizationName,
}: {
    order: OrderDetail
    options: TransitionOptions
    organizationName: string
}) {
    const t = useTranslations("App.orders.transition")
    const tStatus = useTranslations("App.orders.status")

    const [target, setTarget] = useState<TransitionOption | null>(null)
    const [planReason, setPlanReason] = useState<PlanReason | null>(null)

    const interrupted = order.status === "stopped" || order.status === "issue"

    // The chain's own next step, or where an interrupted trip resumes
    const next = primaryTransition({
        status: order.status,
        route: order.route,
        role: "user",
        resumeStatus: options.resumeStatus,
    })

    const primary = options.targets.find((option) => option.to === next) ?? null
    const rest = options.targets.filter((option) => option !== primary)

    if (options.targets.length === 0) return null

    // Nothing to fill in for a booking with no rig — that IS the dispatch
    // form, and its papers block is the one place a missing paper can be
    // uploaded in the flow; the dialog keeps Confirm disabled until the rig
    // it picks has everything, and the server refuses it again anyway
    const openable = (option: TransitionOption) =>
        !option.blocked
        || option.blockedReason === "INCOMPLETE_FOR_DISPATCH"
        || option.blockedReason === "PAPERS_MISSING"
        || planReasonOf(option) !== null

    // A plan refusal is not a move the transition dialog can complete, so it
    // goes to the one that explains the allowance instead
    const pick = (option: TransitionOption) => {
        const reason = planReasonOf(option)

        if (reason) setPlanReason(reason)
        else setTarget(option)
    }

    return (
        <>
            <div className="flex shrink-0 items-center gap-2">
                {primary && (
                    <Button size="sm" disabled={!openable(primary)} onClick={() => pick(primary)}>
                        {interrupted ? <IconPlayerPlay /> : isDispatchMove(order.status, primary.to) ? <IconSteeringWheel /> : <IconArrowRight />}
                        <span className="truncate">
                            {interrupted ? t("resume", { status: tStatus(primary.to) }) : tStatus(primary.to)}
                        </span>
                    </Button>
                )}

                {rest.length > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button size="icon-sm" variant="outline" aria-label={t("menu")}>
                                <IconDots />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            {rest.map((option) => (
                                <DropdownMenuItem
                                    key={option.to}
                                    disabled={!openable(option)}
                                    onSelect={() => pick(option)}
                                >
                                    <IconArrowRight stroke={1.5} />
                                    {tStatus(option.to)}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            {target && (
                <TransitionDialog
                    orderId={order.orderId}
                    status={order.status}
                    target={target}
                    version={options.version}
                    onClose={() => setTarget(null)}
                    onPlanRequired={(reason) => { setTarget(null); setPlanReason(reason) }}
                />
            )}

            {planReason && (
                <PlanDialog
                    reason={planReason}
                    allowance={options.allowance}
                    organizationName={organizationName}
                    onClose={() => setPlanReason(null)}
                />
            )}
        </>
    )
}
