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

import { primaryTransition } from "@workspace/domain/orders/transitions"

import { TransitionDialog } from "@/frontend/pages/orders/sections/transition-dialog"
import type { OrderDetail, TransitionOption, TransitionOptions } from "@/frontend/pages/orders/types"

/**
 * The carrier's controls: the one obvious next step, with everything else it
 * may legally do behind the menu. The targets come from the server, already
 * narrowed to what the tenant's own policy allows, so nothing offered here
 * can be refused for being the wrong actor.
 *
 * A "blocked" target still opens where the dialog is what unblocks it: an
 * order booked without a rig is exactly what the dispatch form fills in.
 */
export function TransitionBar({ order, options }: { order: OrderDetail; options: TransitionOptions }) {
    const t = useTranslations("App.orders.transition")
    const tStatus = useTranslations("App.orders.status")

    const [target, setTarget] = useState<TransitionOption | null>(null)

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

    // Nothing to fill in for a booking with no rig — that IS the dispatch form
    const openable = (option: TransitionOption) =>
        !option.blocked || option.blockedReason === "INCOMPLETE_FOR_DISPATCH"

    return (
        <>
            <div className="flex shrink-0 items-center gap-2">
                {primary && (
                    <Button size="sm" disabled={!openable(primary)} onClick={() => setTarget(primary)}>
                        {interrupted ? <IconPlayerPlay /> : primary.to === "to-loading" ? <IconSteeringWheel /> : <IconArrowRight />}
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
                                    onSelect={() => setTarget(option)}
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
                />
            )}
        </>
    )
}
