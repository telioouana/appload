"use client"

import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@workspace/ui/components/dialog"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@workspace/trpc/errors"
import type { OrderStatus } from "@workspace/domain/orders/transitions"
import { offerValues, type OfferValues, type OfferValuesFormInput } from "@/backend/schemas/offer"
import type { OfferRow } from "@/frontend/pages/order/server/offers-procedures"

import type { RouteKind } from "@workspace/domain/orders/commission"
import { OfferFields, offerNames } from "./offer-fields"

// Domain codes the offers router puts in TRPCError.message. The carrier
// picker only offers registered carriers and the menus only offer actions
// the row's status allows, so these surface when a stale tab and the
// server disagree.
const OFFER_ERROR_CODES = [
    "CARRIER_NOT_FOUND",
    "OFFER_NOT_EDITABLE",
    "OFFER_NOT_PENDING",
    "NOT_ALLOWED",
    "NOT_FOUND",
    "UNKNOWN",
] as const

type OfferErrorCode = (typeof OFFER_ERROR_CODES)[number]

const EMPTY: OfferValuesFormInput = {
    carrierId: "",
    carrierName: "",
    fiscalRegime: undefined as never,
    subtotal: undefined,
    vat: undefined,
    total: undefined,
    currency: undefined as never,
    commissionTotal: undefined,
    includesGit: false,
    includesGps: false,
    notes: "",
}

/**
 * Everything the offers of one order can be invalidated through: the page's
 * own read, the list the dialogs fetch, and the rows on the orders pages
 * that count pending offers.
 */
function useRefreshOffers(orderId: string) {
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    return () => {
        queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId }))
        queryClient.invalidateQueries(trpc.offers.list.queryFilter({ orderId }))
        queryClient.invalidateQueries(trpc.order.transitionOptions.queryFilter({ orderId }))
        queryClient.invalidateQueries(trpc.orders.pathFilter())
    }
}

/**
 * Registers a carrier's quote, or corrects one that has not been decided.
 * On a prospect the offer is a candidate the booking can accept; from
 * booked onward it is Appload's own record of what the market offered and
 * the description says so, because nothing about the order will change.
 */
export function OfferDialog({
    orderId,
    orderStatus,
    route,
    offer,
    open,
    onClose,
}: {
    orderId: string
    orderStatus: OrderStatus
    /** The order's route, which decides whether the client price carries VAT */
    route: RouteKind
    offer?: OfferRow | null
    open: boolean
    onClose: () => void
}) {
    const t = useTranslations("Admin.orders.offers")
    // The offer schema speaks the create form's validation vocabulary
    const tCreate = useTranslations("Admin.order.create")

    const [error, setError] = useState<OfferErrorCode | null>(null)

    const trpc = useTRPC()
    const refresh = useRefreshOffers(orderId)
    const create = useMutation(trpc.offers.create.mutationOptions())
    const update = useMutation(trpc.offers.update.mutationOptions())
    const isPending = create.isPending || update.isPending

    const FormSchema = useMemo(
        () => offerValues((field) => ({ error: tCreate(`form.errors.validation.${field}`) })),
        [tCreate],
    )

    const values: OfferValuesFormInput = useMemo(() => (offer ? {
        carrierId: offer.carrierId,
        carrierName: offer.carrierName,
        fiscalRegime: offer.fiscalRegime,
        subtotal: offer.subtotal ?? undefined,
        vat: offer.vat ?? undefined,
        total: offer.total,
        currency: offer.currency,
        commissionTotal: offer.commissionTotal ?? undefined,
        includesGit: offer.includesGit,
        includesGps: offer.includesGps,
        notes: offer.notes ?? "",
    } : EMPTY), [offer])

    const form = useForm<OfferValuesFormInput, unknown, OfferValues>({
        resolver: zodResolver(FormSchema),
        values,
    })

    async function submit(parsed: OfferValues) {
        setError(null)

        try {
            if (offer) {
                await update.mutateAsync({ offerId: offer.id, patch: parsed })
            } else {
                await create.mutateAsync({ orderId, values: parsed })
            }

            refresh()
            onClose()
        } catch (caught) {
            setError(domainErrorCode(caught, OFFER_ERROR_CODES, "UNKNOWN"))
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
            <DialogContent className="w-full sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t(offer ? "dialog.editTitle" : "dialog.createTitle")}</DialogTitle>
                    <DialogDescription>
                        {t(orderStatus === "prospect" ? "dialog.description" : "dialog.recordedDescription")}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4">
                    <div className="max-h-[60vh] overflow-y-auto px-1 container-snap">
                        <OfferFields
                            control={form.control}
                            names={offerNames<OfferValuesFormInput>("")}
                            isPending={isPending}
                            watch={form.watch}
                            setValue={form.setValue}
                            route={route}
                        />
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}

                    <DialogFooter className="gap-2">
                        <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
                            {t("cancel")}
                        </Button>
                        <Button type="submit" disabled={isPending}>
                            {isPending && <Spinner />}
                            {t("dialog.save")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

/**
 * Saying no to a quote, or recording that the carrier pulled out. The row
 * stays either way — a declined offer is part of how the order was priced
 * — so the note is what the operator is really being asked for.
 */
export function OfferDecisionDialog({
    orderId,
    offer,
    status,
    onClose,
}: {
    orderId: string
    offer: OfferRow
    status: "declined" | "withdrawn"
    onClose: () => void
}) {
    const t = useTranslations("Admin.orders.offers")

    const [note, setNote] = useState("")
    const [error, setError] = useState<OfferErrorCode | null>(null)

    const trpc = useTRPC()
    const refresh = useRefreshOffers(orderId)
    const decide = useMutation(trpc.offers.decide.mutationOptions())

    async function confirm() {
        setError(null)

        try {
            await decide.mutateAsync({ offerId: offer.id, status, note: note.trim() || undefined })
            refresh()
            onClose()
        } catch (caught) {
            setError(domainErrorCode(caught, OFFER_ERROR_CODES, "UNKNOWN"))
        }
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
            <DialogContent className="w-full sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t(status === "declined" ? "decide.declinedTitle" : "decide.withdrawnTitle")}</DialogTitle>
                    <DialogDescription>
                        {t("decide.description", { carrier: offer.carrierName })}
                    </DialogDescription>
                </DialogHeader>

                <Textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t("decide.note")}
                    rows={3}
                    maxLength={1000}
                    disabled={decide.isPending}
                />

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={decide.isPending}>
                        {t("cancel")}
                    </Button>
                    <Button type="button" onClick={confirm} disabled={decide.isPending}>
                        {decide.isPending && <Spinner />}
                        {t("decide.confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** Deleting a quote typed by mistake. A decided offer is the record and never comes here. */
export function RemoveOfferDialog({
    orderId,
    offer,
    onClose,
}: {
    orderId: string
    offer: OfferRow
    onClose: () => void
}) {
    const t = useTranslations("Admin.orders.offers")

    const [error, setError] = useState<OfferErrorCode | null>(null)

    const trpc = useTRPC()
    const refresh = useRefreshOffers(orderId)
    const remove = useMutation(trpc.offers.remove.mutationOptions())

    async function confirm() {
        setError(null)

        try {
            await remove.mutateAsync({ offerId: offer.id })
            refresh()
            onClose()
        } catch (caught) {
            setError(domainErrorCode(caught, OFFER_ERROR_CODES, "UNKNOWN"))
        }
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
            <DialogContent className="w-full sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("remove.title")}</DialogTitle>
                    <DialogDescription>
                        {t("remove.description", { carrier: offer.carrierName })}
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={remove.isPending}>
                        {t("cancel")}
                    </Button>
                    <Button type="button" variant="destructive" onClick={confirm} disabled={remove.isPending}>
                        {remove.isPending && <Spinner />}
                        {t("remove.confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
