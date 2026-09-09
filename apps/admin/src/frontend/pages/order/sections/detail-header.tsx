"use client"

import {
    IconArrowLeft,
    IconArrowRight,
    IconCancel,
    IconCheck,
    IconCloudX,
    IconDots,
    IconEdit,
    IconFlag,
    IconGavel,
    IconPlayerPlay,
    IconPlus,
    IconSend,
} from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import { Link } from "@/i18n/navigation"
import type { Order, SheetSync } from "@workspace/db/orders"

import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import type { OrderStatus } from "@workspace/domain/orders/transitions"
import { primaryOrderAction } from "@/frontend/pages/orders/lib/actions"
import { OrderStatusBadge, place } from "@/frontend/pages/orders/sections/order-item-shared"
import { ORDER_STATUS_SECTION, SECTION_PATHS } from "@/frontend/pages/orders/types"

/** Statuses whose every legal move needs the admin role. */
const CLOSED: OrderStatus[] = ["completed", "cancelled", "underbid"]

/** Cancelling is offered right up to delivery, and not after. */
const CANCELLABLE_UNTIL: OrderStatus[] = ["delivered", ...CLOSED]

/**
 * The top of the order page: where you are, what this order is, and the one
 * thing to do about it. Everything past that single primary button lives in
 * the menu, so the header never turns into a row of equal-weight choices.
 */
export function OrderDetailHeader({
    order,
    dispute,
    sheetSync,
    resumeStatus,
    pendingOffers,
    isAdmin,
    canOpenDispute,
    onTransition,
    onEdit,
    onAcceptOffer,
    onAddOffer,
    onSendPdf,
    onOpenDispute,
}: {
    order: Order
    dispute: { id: string } | null
    sheetSync: SheetSync | null
    resumeStatus: OrderStatus | null
    /** How many quotes are still awaiting a decision — what a prospect's button offers */
    pendingOffers: number
    isAdmin: boolean
    canOpenDispute: boolean
    onTransition: (to?: OrderStatus) => void
    onEdit: () => void
    onAcceptOffer: () => void
    onAddOffer: () => void
    onSendPdf: () => void
    onOpenDispute: () => void
}) {
    const t = useTranslations("Admin.orders.detailPage")
    const tActions = useTranslations("Admin.orders.list.actions")
    const tSheet = useTranslations("Admin.orders.list.sheet")
    const tStatus = useTranslations("Admin.orders.header.filters.status.options")
    const tCategory = useTranslations("Admin.orders.header.filters.category.options")
    const tList = useTranslations("Admin.orders.list")
    const f = useFormatter()

    const section = ORDER_STATUS_SECTION[order.status]
    const primary = primaryOrderAction(order, resumeStatus, pendingOffers)
    const interrupted = order.status === "stopped" || order.status === "issue"
    const closed = CLOSED.includes(order.status)

    // A closed order only moves with the admin role (every target's
    // requirements include it), so for anyone else the fallback button would
    // open a dialog with nothing in it
    const showFallback = !primary && (!closed || isAdmin)
    const canCancel = !CANCELLABLE_UNTIL.includes(order.status)

    return (
        <header className="flex flex-col gap-4 px-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
                <Button asChild size="icon" variant="outline" aria-label={t("back")} className="mt-4 shrink-0">
                    <Link href={SECTION_PATHS[section]}><IconArrowLeft className="size-4" stroke={1.5} /></Link>
                </Button>

                <div className="flex min-w-0 flex-col gap-1">
                    <nav className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <span>{tList("eyebrow")}</span>
                        <span aria-hidden>/</span>
                        <span>{tList("title")}</span>
                        <span aria-hidden>/</span>
                        <span className="text-foreground/70">{tList(`pages.${section}.title`)}</span>
                    </nav>

                    <div className="flex flex-wrap items-center gap-2.5">
                        <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">{order.orderId}</h1>
                        <OrderStatusBadge status={order.status} />

                        {dispute && (
                            <Badge variant="outline" className="border-destructive/40 text-destructive gap-1">
                                <IconGavel className="size-3" />
                                {tSheet("disputed")}
                            </Badge>
                        )}

                        {order.flaggedForReview && (
                            <Badge variant="outline" className="border-destructive/40 text-destructive gap-1">
                                <IconFlag className="size-3" />
                                {tSheet("flagged")}
                            </Badge>
                        )}

                        {/* A healthy sync is the expected state, not news */}
                        {sheetSync && sheetSync.state !== "done" && (
                            <Badge
                                variant="outline"
                                className={cn("gap-1", sheetSync.state === "failed" && "border-destructive/40 text-destructive")}
                            >
                                <IconCloudX className="size-3" />
                                {t(`sheetSync.${sheetSync.state}`)}
                            </Badge>
                        )}
                    </div>

                    <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-sm">
                        <span className="truncate">{order.shipperName}</span>
                        <span aria-hidden>·</span>
                        <span className="truncate">{place(order.loadingAddress)} → {place(order.offloadingAddress)}</span>
                        <span aria-hidden>·</span>
                        <span className="truncate">{tCategory(order.category)}</span>
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">
                            {f.number(Number(order.weight), { maximumFractionDigits: 1 })} {order.weightUnit}
                        </span>
                    </p>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 lg:mt-6">
                <Button size="sm" variant="outline" onClick={onSendPdf}>
                    <IconSend />
                    <span className="hidden sm:inline">{tActions("send-pdf")}</span>
                </Button>

                <Button size="sm" variant="outline" onClick={onEdit}>
                    <IconEdit />
                    <span className="hidden sm:inline">{tActions("edit")}</span>
                </Button>

                {primary?.kind === "accept-offer" ? (
                    <Button size="sm" onClick={onAcceptOffer}>
                        <IconCheck />
                        <span className="truncate">{tActions("accept-offer")}</span>
                    </Button>
                ) : primary?.kind === "add-offer" ? (
                    <Button size="sm" onClick={onAddOffer}>
                        <IconPlus />
                        <span className="truncate">{tActions("add-offer")}</span>
                    </Button>
                ) : primary ? (
                    <Button size="sm" onClick={() => onTransition(primary.to)}>
                        {interrupted ? <IconPlayerPlay /> : <IconArrowRight />}
                        <span className="truncate">
                            {interrupted ? `${t("resume")} · ${tStatus(primary.to)}` : tStatus(primary.to)}
                        </span>
                    </Button>
                ) : showFallback ? (
                    <Button size="sm" variant="outline" onClick={() => onTransition()}>
                        <IconArrowRight />
                        <span className="truncate">{tActions("change-status")}</span>
                    </Button>
                ) : null}

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="outline" aria-label={tActions("menu")}>
                            <IconDots />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                        {(primary || showFallback) && (
                            <DropdownMenuItem onSelect={() => onTransition()}>
                                <IconArrowRight stroke={1.5} />
                                {tActions("change-status")}
                            </DropdownMenuItem>
                        )}

                        {canOpenDispute && (
                            <DropdownMenuItem onSelect={onOpenDispute}>
                                <IconGavel stroke={1.5} />
                                {tActions("open-dispute")}
                            </DropdownMenuItem>
                        )}

                        {canCancel && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onSelect={() => onTransition("cancelled")}>
                                    <IconCancel stroke={1.5} />
                                    {tActions("cancel")}
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    )
}
