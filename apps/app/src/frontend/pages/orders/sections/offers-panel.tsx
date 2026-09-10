"use client"

import { useState } from "react"
import { IconCheck, IconDotsVertical, IconEdit, IconPlus, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import type { TrackingAllowance } from "@workspace/domain/subscription"

import { initials } from "@workspace/ui/customs/list/table-cells"
import { PlanDialog, planBlock, planRefusal, type PlanReason } from "@/components/plan-dialog"
import { money } from "@/frontend/pages/orders/lib/format"
import { orderErrorCode, orderErrorKey, type OrderErrorMessage } from "@/frontend/pages/orders/lib/errors"
import { IncludesChips, OfferStatusBadge } from "@/frontend/pages/orders/components/badges"
import { Dash, SectionCard } from "@/frontend/pages/orders/components/section-card"
import { useOrderMutations } from "@/frontend/pages/orders/hooks/use-order-mutations"
import { OfferFormDialog } from "@/frontend/pages/orders/sections/offer-form-dialog"
import type { OrderDetail, OrderOfferView, OrgType } from "@/frontend/pages/orders/types"

/**
 * The quotes on this order, from whichever side is reading.
 *
 * A client compares what its carriers are asking and books one of them —
 * accepting an offer IS the booking. A carrier only ever sees its own quote
 * (that other carriers were asked is not a secret; what they asked for is),
 * and while a request of its own is open it can write one.
 *
 * Booking is the one action here a plan pays for, so Accept stays where it
 * is when the allowance is spent and explains itself instead.
 */
export function OffersPanel({
    order,
    orgType,
    allowance,
    organizationName,
}: {
    order: OrderDetail
    orgType: OrgType
    allowance: TrackingAllowance
    organizationName: string
}) {
    const t = useTranslations("App.orders.offers")

    const [form, setForm] = useState<{ open: boolean; offer: OrderOfferView | null }>({ open: false, offer: null })
    const [accepting, setAccepting] = useState<OrderOfferView | null>(null)
    const [planReason, setPlanReason] = useState<PlanReason | null>(null)

    const { declineOffer, withdrawOffer } = useOrderMutations()

    const prospect = order.status === "prospect"
    const canQuote = orgType === "carrier" && order.permissions.canQuote
    const blocked = planBlock(allowance)

    return (
        <>
            <SectionCard
                title={t("title")}
                count={order.offers.length}
                actions={canQuote ? (
                    <Button size="sm" variant="outline" onClick={() => setForm({ open: true, offer: null })}>
                        <IconPlus />
                        {t("actions.quote")}
                    </Button>
                ) : undefined}
            >
                {order.offers.length === 0 ? (
                    <p className="text-muted-foreground py-2 text-sm">
                        {t(orgType === "carrier" ? "empty.carrier" : "empty.shipper")}
                    </p>
                ) : (
                    <ul className="flex flex-col divide-y">
                        {order.offers.map((offer) => (
                            <OfferRow
                                key={offer.id}
                                offer={offer}
                                onAccept={orgType === "shipper" && prospect && offer.status === "pending"
                                    ? () => (blocked ? setPlanReason(blocked) : setAccepting(offer))
                                    : undefined}
                                onDecline={orgType === "shipper" && prospect && offer.status === "pending"
                                    ? () => declineOffer.mutate({ offerId: offer.id })
                                    : undefined}
                                onEdit={orgType === "carrier" && offer.isMine && offer.status === "pending"
                                    ? () => setForm({ open: true, offer })
                                    : undefined}
                                onWithdraw={orgType === "carrier" && offer.isMine && offer.status === "pending"
                                    ? () => withdrawOffer.mutate({ offerId: offer.id })
                                    : undefined}
                            />
                        ))}
                    </ul>
                )}

                {!prospect && order.offers.length > 0 && (
                    <p className="text-muted-foreground text-xs italic">{t("settled-hint")}</p>
                )}
            </SectionCard>

            {form.open && (
                <OfferFormDialog
                    orderId={order.orderId}
                    offer={form.offer}
                    currency={order.money.currency}
                    open={form.open}
                    onOpenChange={(next) => setForm({ open: next, offer: next ? form.offer : null })}
                />
            )}

            {accepting && (
                <AcceptOfferDialog
                    orderId={order.orderId}
                    offer={accepting}
                    expectedVersion={order.version}
                    onClose={() => setAccepting(null)}
                    onPlanRequired={(reason) => { setAccepting(null); setPlanReason(reason) }}
                />
            )}

            {planReason && (
                <PlanDialog
                    reason={planReason}
                    allowance={allowance}
                    organizationName={organizationName}
                    onClose={() => setPlanReason(null)}
                />
            )}
        </>
    )
}

/** One quote: who, what it covers, what it costs — in the reader's own money. */
function OfferRow({
    offer,
    onAccept,
    onDecline,
    onEdit,
    onWithdraw,
}: {
    offer: OrderOfferView
    onAccept?: () => void
    onDecline?: () => void
    onEdit?: () => void
    onWithdraw?: () => void
}) {
    const t = useTranslations("App.orders.offers")
    const tv = useTranslations("App.orders")
    const f = useFormatter()

    const hasMenu = Boolean(onDecline || onEdit || onWithdraw)

    return (
        <li className={cn(
            "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 py-3 first:pt-0 last:pb-0",
            offer.status === "accepted" && "bg-primary/5 ring-primary/20 -mx-2 rounded-xl px-2 ring-1",
        )}>
            <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                {initials(offer.carrierName)}
            </span>

            <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{offer.carrierName}</span>
                    <OfferStatusBadge status={offer.status} />
                </div>

                <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                    <IncludesChips git={offer.includesGit} gps={offer.includesGps} />
                    <span aria-hidden>·</span>
                    <span className="whitespace-nowrap">
                        {offer.carrierSince
                            ? t("record", {
                                date: f.dateTime(offer.carrierSince, { month: "short", year: "numeric" }),
                                trips: offer.carrierTrips ?? 0,
                            })
                            : t("record-unknown")}
                    </span>
                    {offer.notes && (
                        <>
                            <span aria-hidden>·</span>
                            <span className="min-w-0 truncate">{offer.notes}</span>
                        </>
                    )}
                </div>

                {offer.decisionNote && (
                    <p className="text-muted-foreground text-xs">{offer.decisionNote}</p>
                )}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-sm font-medium tabular-nums">
                    {money(f, offer.total, offer.currency) ?? <Dash />}
                </span>
                <span className="text-muted-foreground text-[11px]">{tv(`fiscalRegime.${offer.fiscalRegime}`)}</span>

                <div className="flex items-center gap-1">
                    {onAccept && (
                        <Button size="sm" onClick={onAccept}>
                            <IconCheck />
                            {t("actions.accept")}
                        </Button>
                    )}

                    {hasMenu && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button size="icon-sm" variant="ghost" aria-label={t("actions.menu")}>
                                    <IconDotsVertical />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                                {onEdit && (
                                    <DropdownMenuItem onSelect={onEdit}>
                                        <IconEdit stroke={1.5} />
                                        {t("actions.edit")}
                                    </DropdownMenuItem>
                                )}
                                {onDecline && (
                                    <DropdownMenuItem onSelect={onDecline}>
                                        <IconX stroke={1.5} />
                                        {t("actions.decline")}
                                    </DropdownMenuItem>
                                )}
                                {onWithdraw && (
                                    <DropdownMenuItem variant="destructive" onSelect={onWithdraw}>
                                        <IconX stroke={1.5} />
                                        {t("actions.withdraw")}
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            </div>
        </li>
    )
}

/**
 * Booking. Accepting a quote is not a preference — it commits the cargo to
 * that carrier, closes every request on the order and tells the others they
 * lost — so it is confirmed, and under the order's own version.
 */
function AcceptOfferDialog({
    orderId,
    offer,
    expectedVersion,
    onClose,
    onPlanRequired,
}: {
    orderId: string
    offer: OrderOfferView
    expectedVersion: number
    onClose: () => void
    /** The allowance ran out between opening this dialog and confirming it */
    onPlanRequired: (reason: PlanReason) => void
}) {
    const t = useTranslations("App.orders.offers.accept")
    const tError = useTranslations("App.orders")
    const f = useFormatter()

    const { acceptOffer, refresh } = useOrderMutations()
    const [error, setError] = useState<OrderErrorMessage | null>(null)

    function confirm() {
        setError(null)

        acceptOffer.mutate(
            { orderId, offerId: offer.id, expectedVersion },
            {
                onSuccess: onClose,
                onError: (failure) => {
                    const refusal = planRefusal(failure)

                    // Not a booking this dialog can fix: hand over to the one
                    // that explains the plan
                    if (refusal) {
                        onPlanRequired(refusal)
                        return
                    }

                    setError(orderErrorKey(failure))

                    // The page was built from a version that has since moved on
                    if (orderErrorCode(failure) === "VERSION_CONFLICT") void refresh()
                },
            },
        )
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>
                        {t("description", {
                            carrier: offer.carrierName,
                            amount: money(f, offer.total, offer.currency) ?? "",
                        })}
                    </DialogDescription>
                </DialogHeader>

                <p className="text-muted-foreground text-sm">{t("consequences")}</p>

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{tError(`errors.${error}`)}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter>
                    <Button variant="outline" disabled={acceptOffer.isPending} onClick={onClose}>
                        {t("back")}
                    </Button>
                    <Button disabled={acceptOffer.isPending} onClick={confirm}>
                        {acceptOffer.isPending ? <Spinner className="size-4" /> : <IconCheck />}
                        {t("confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
