"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"
import { authClient } from "@workspace/auth/client"
import { isAuthorized, type StaffRole } from "@workspace/auth/user-permissions"

import { useTRPC } from "@/backend/api/client"
import { today } from "@workspace/domain/kyc/derive"
import { PROOF_OF_PAYMENT } from "@workspace/domain/orders/payments"
import type { OrderStatus } from "@workspace/domain/orders/transitions"
import { TRAIL_POLL_MS } from "@/frontend/pages/map/types"
import { UNBILLABLE_STATUSES } from "@/frontend/pages/orders/types"
import { useCreateOrder } from "@/frontend/pages/order/hooks/use-create-order"
import { useUpdateOrder } from "@/frontend/pages/order/hooks/use-update-order"
import { UpdateOrderView } from "@/frontend/pages/order/views/update-order-view"
import { OpenDisputeDialog } from "@/frontend/pages/orders/components/open-dispute-dialog"
import { TransitionDialog } from "@/frontend/pages/orders/components/transition-dialog"

import { DocumentsCard } from "../components/documents-card"
import { SendPdfDialog } from "../components/send-pdf-dialog"
import { AddDocumentDialog, type DocumentPreset } from "../components/add-document-dialog"
import { OfferDecisionDialog, OfferDialog, RemoveOfferDialog } from "../components/offer-dialog"
import { OrderUpdatedSuccess, type UpdatedOrder } from "../section/order-updated-success"
import { OrderDetailHeader } from "../sections/detail-header"
import { DisputeBanner, FlagBanner } from "../sections/exception-banners"
import { LoadingCheckCard, showsLoadingCheck } from "../sections/loading-check-card"
import { OffersCard } from "../sections/offers-card"
import { OperationsCard } from "../sections/operations-card"
import { PartiesCard } from "../sections/parties-card"
import { RouteCard } from "../sections/route-card"
import { TrackingCard } from "../sections/tracking-card"
import { TripStrip } from "../sections/trip-strip"
import type { OfferRow } from "../server/offers-procedures"

/**
 * Everything about one order on one page: where the trip is, where it is
 * going, both sides of the money, who is driving, what is attached and what
 * has happened. This file owns the queries, the permission gates and the
 * dialogs; each block below renders from what it is handed.
 */
export function OrderDetailsView({ orderId }: { orderId: string }) {
    const t = useTranslations("Admin.orders.detailPage")
    const tSheet = useTranslations("Admin.orders.list.sheet")
    const f = useFormatter()

    const [transition, setTransition] = useState<{ open: boolean; to?: OrderStatus; offerId?: string }>({ open: false })
    const [pdfOpen, setPdfOpen] = useState(false)
    const [disputeOpen, setDisputeOpen] = useState(false)
    const [adding, setAdding] = useState<DocumentPreset | null>(null)
    const [offerForm, setOfferForm] = useState<{ open: boolean; offer: OfferRow | null }>({ open: false, offer: null })
    const [deciding, setDeciding] = useState<{ offer: OfferRow; status: "declined" | "withdrawn" } | null>(null)
    const [removing, setRemoving] = useState<OfferRow | null>(null)
    const [updated, setUpdated] = useState<UpdatedOrder | null>(null)

    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const { data } = useSuspenseQuery(trpc.order.get.queryOptions({ orderId }))
    // The same options the embedded map polls with, so React Query serves
    // both from one request instead of two pollers on the same key
    const trail = useQuery(trpc.map.trail.queryOptions({ orderId }, { refetchInterval: TRAIL_POLL_MS }))
    const { mutate: resolveFlag, isPending: resolving } = useMutation(trpc.order.resolveFlag.mutationOptions())

    const { onOpen } = useUpdateOrder()
    const { onEdit } = useCreateOrder()

    // Button states only — the server re-checks every permission
    const { data: session } = authClient.useSession()
    const role: StaffRole =
        session?.user.role === "admin" ? "admin" :
            session?.user.role === "manager" ? "manager" : "user"

    const order = data.order
    const dispute = data.dispute

    // A prospect is booked by accepting one of these; from booked onward
    // they are Appload's record of what the market offered
    const offers = data.offers
    const pendingOffers = offers.filter((offer) => offer.status === "pending").length
    const acceptedOffer = offers.find((offer) => offer.status === "accepted") ?? null

    // Mirrors both server gates: proofs are refused on prospects (payment
    // status is not-applicable before booking), and voiding one needs the
    // document:delete outer gate plus payment:void inside the procedure.
    // An active dispute can hold either side's money on top of that.
    const canRecordPayment = isAuthorized(role, "payment", ["record"]) && order.status !== "prospect"
    const heldFor = (party: "shipper" | "carrier") =>
        Boolean(party === "shipper" ? dispute?.holdShipperPayments : dispute?.holdCarrierPayments)
    const canRecordFor = (party: "shipper" | "carrier") => canRecordPayment && !heldFor(party)
    const canVoidPayment =
        isAuthorized(role, "document", ["delete"]) && isAuthorized(role, "payment", ["void"])
    const canOpenDispute =
        !dispute && !UNBILLABLE_STATUSES.includes(order.status) && isAuthorized(role, "dispute", ["open"])
    // Offers are order data: registering, correcting or deciding one is the
    // same grant that edits the order
    const canUpdateOrder = isAuthorized(role, "order", ["update"])

    // One reading of "today" for the whole page, so the trip strip and its
    // date row can never disagree about what is overdue
    const on = today()

    // The oldest row is the creation; the timeline comes back newest first
    const created = data.history.at(-1)

    function onResolveFlag() {
        resolveFlag(
            { orderId, expectedVersion: order.version },
            {
                onSuccess: () => {
                    queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId }))
                    queryClient.invalidateQueries(trpc.orders.pathFilter())
                    toast(t("flagResolved"))
                },
                onError: () => toast(t("flagResolveFailed")),
            },
        )
    }

    return (
        <>
            <OrderDetailHeader
                order={order}
                dispute={dispute}
                sheetSync={data.sheetSync}
                resumeStatus={data.resumeStatus}
                pendingOffers={pendingOffers}
                isAdmin={role === "admin"}
                canOpenDispute={canOpenDispute}
                onTransition={(to) => setTransition({ open: true, to })}
                onEdit={() => (order.status === "prospect" ? onEdit(order, offers) : onOpen(order))}
                onAcceptOffer={() => setTransition({ open: true, to: "booked" })}
                onAddOffer={() => setOfferForm({ open: true, offer: null })}
                onSendPdf={() => setPdfOpen(true)}
                onOpenDispute={() => setDisputeOpen(true)}
            />

            {(dispute || order.flaggedForReview) && (
                <div className="flex flex-col gap-3 px-2">
                    {dispute && <DisputeBanner dispute={dispute} />}

                    {order.flaggedForReview && (
                        <FlagBanner
                            reason={order.flagReason}
                            canResolve={isAuthorized(role, "order", ["flag-resolve"])}
                            resolving={resolving}
                            onResolve={onResolveFlag}
                        />
                    )}
                </div>
            )}

            <div className="shrink-0 px-2">
                <TripStrip
                    order={order}
                    entries={data.history}
                    today={on}
                    lastSeenAt={trail.data?.at(-1)?.recordedAt ?? null}
                    lastSeenPending={trail.isPending}
                />
            </div>

            {/* From lg up this row owns the leftover height: the left column
                scrolls inside it and the rail stays put, so the map is always
                whole. Below lg it is one column and the page scrolls instead. */}
            <div className="grid gap-4 px-2 pb-2 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,700px)_minmax(320px,1fr)]">
                <div className="container-snap flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
                    <RouteCard order={order} />

                    <OffersCard
                        order={order}
                        offers={offers}
                        readOnly={!canUpdateOrder}
                        onAdd={() => setOfferForm({ open: true, offer: null })}
                        onAccept={(offer) => setTransition({ open: true, to: "booked", offerId: offer.id })}
                        onEdit={(offer) => setOfferForm({ open: true, offer })}
                        onDecide={(offer, status) => setDeciding({ offer, status })}
                        onRemove={(offer) => setRemoving(offer)}
                    />

                    <PartiesCard
                        order={order}
                        documents={data.documents}
                        acceptedOffer={acceptedOffer}
                        canRecordFor={canRecordFor}
                        heldFor={heldFor}
                        onRecord={(party) => setAdding({ type: PROOF_OF_PAYMENT, party })}
                    />

                    <OperationsCard order={order} onAssign={canUpdateOrder ? () => onOpen(order) : undefined} />

                    {/* What the truck was dispatched with, and the orderer's
                        confirmation at the loading site. The card renders
                        nothing when there is neither. */}
                    {showsLoadingCheck(order.status) && <LoadingCheckCard order={order} />}

                    <DocumentsCard
                        orderId={orderId}
                        documents={data.documents}
                        canDelete={isAuthorized(role, "document", ["delete"])}
                        canVoidPayment={canVoidPayment}
                        onAdd={() => setAdding({ type: "pod" })}
                    />

                    <p className="text-muted-foreground px-1 text-xs">
                        {created?.actorName
                            ? t("footer.created", {
                                date: f.dateTime(order.createdAt, { dateStyle: "medium" }),
                                actor: created.actorName,
                            })
                            : t("footer.createdUnknown", { date: f.dateTime(order.createdAt, { dateStyle: "medium" }) })}
                        {" · "}
                        {tSheet("updated", { date: f.dateTime(order.updatedAt, { dateStyle: "medium", timeStyle: "short" }) })}
                    </p>
                </div>

                <div className="flex min-w-0 flex-col gap-4 lg:h-full lg:min-h-0">
                    <TrackingCard order={order} />
                </div>
            </div>

            {transition.open && (
                <TransitionDialog
                    orderId={orderId}
                    open={transition.open}
                    initialTarget={transition.to}
                    initialOfferId={transition.offerId}
                    // Booking is what the two confirmation PDFs are printed
                    // from, so the download dialog follows the move that
                    // produced them
                    onSuccess={(booked) => {
                        // On the carrier leg the move actually committed, not
                        // on the status alone: an admin reversal back to
                        // booked accepts no offer, and there is no carrier
                        // price for the transport order to be printed from
                        if (booked.status === "booked" && booked.carrierTotal !== null) {
                            setUpdated({ orderId, order: booked, loadingBay: null })
                        }
                    }}
                    onClose={() => setTransition({ open: false })}
                />
            )}

            {pdfOpen && <SendPdfDialog order={order} open={pdfOpen} onClose={() => setPdfOpen(false)} />}

            {disputeOpen && (
                <OpenDisputeDialog
                    orderId={orderId}
                    currency={order.shipperCurrency}
                    open={disputeOpen}
                    onClose={() => setDisputeOpen(false)}
                />
            )}

            {adding && (
                <AddDocumentDialog
                    orderId={orderId}
                    initial={adding}
                    canCreateNote={isAuthorized(role, "note", ["create"])}
                    canRecordPayment={canRecordPayment}
                    orderStatus={order.status}
                    shipperCurrency={order.shipperCurrency}
                    carrierCurrency={order.carrierCurrency}
                    invoiceDefaults={{
                        shipper: { number: order.shipperInvoiceNumber, date: order.shipperInvoiceDate },
                        carrier: { number: order.carrierInvoiceNumber, date: order.carrierInvoiceDate },
                    }}
                    noteDefaults={{
                        demurrageDays: {
                            loading: order.demurrageChargedDaysAtLoading,
                            offloading: order.demurrageChargedDaysAtOffloading,
                            border: order.demurrageChargedDaysAtBorder,
                        },
                        damagedPercent: order.damagedPercent,
                        claimed: order.claimed,
                    }}
                    onClose={() => setAdding(null)}
                />
            )}

            {offerForm.open && (
                <OfferDialog
                    orderId={orderId}
                    orderStatus={order.status}
                    route={order.route}
                    offer={offerForm.offer}
                    open={offerForm.open}
                    onClose={() => setOfferForm({ open: false, offer: null })}
                />
            )}

            {deciding && (
                <OfferDecisionDialog
                    orderId={orderId}
                    offer={deciding.offer}
                    status={deciding.status}
                    onClose={() => setDeciding(null)}
                />
            )}

            {removing && (
                <RemoveOfferDialog orderId={orderId} offer={removing} onClose={() => setRemoving(null)} />
            )}

            <OrderUpdatedSuccess result={updated} onClose={() => setUpdated(null)} />

            {/* quick-edit sheet, shared with the list page */}
            <UpdateOrderView />
        </>
    )
}
