"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { IconArrowLeft, IconArrowRight, IconCheck, IconCloudX, IconDots, IconEdit, IconFlag, IconFlagCheck, IconSend, } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import { Link } from "@workspace/i18n/navigation"
import { authClient } from "@workspace/auth/client"
import { isAuthorized, type StaffRole } from "@workspace/auth/user-permissions"

import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, } from "@workspace/ui/components/dropdown-menu"

import { useTRPC } from "@/backend/api/client"
import { effectiveTotals } from "@/lib/orders/totals"
import { PROOF_OF_PAYMENT } from "@/lib/orders/payments"
import type { OrderStatus } from "@/lib/orders/transitions"
import { primaryOrderAction } from "@/frontend/pages/orders/lib/actions"
import { useCreateOrder } from "@/frontend/pages/order/hooks/use-create-order"
import { useUpdateOrder } from "@/frontend/pages/order/hooks/use-update-order"
import { CargoFlags } from "@/frontend/pages/orders/sections/order-item-shared"
import { UpdateOrderView } from "@/frontend/pages/order/views/update-order-view"
import { TransitionDialog } from "@/frontend/pages/orders/components/transition-dialog"
import { LoadingDateField, OperationsStrip, OrderIdentity, PartyBlock, RouteField, ShipmentTotal, } from "@/frontend/pages/orders/sections/order-item-parts"

import { DocumentsCard, type DocumentPreset } from "../components/documents-card"
import { PaymentLedger } from "../components/payment-ledger"
import { SendPdfDialog } from "../components/send-pdf-dialog"
import { HistoryTimeline } from "../components/history-timeline"

/**
 * The comprehensive order page: everything about one order — status and
 * actions, route and schedule, both parties' money (with debit/credit
 * notes applied), operations, documents and the full audit timeline.
 * Mobile-first single column; main + rail split from lg upward.
 */
export function OrderDetailsView({ orderId }: { orderId: string }) {
    const t = useTranslations("Admin.orders.detailPage")
    const tStatus = useTranslations("Admin.orders.header.filters.status.options")

    const f = useFormatter()

    const [dialog, setDialog] = useState<{ open: boolean; to?: OrderStatus }>({ open: false })
    const [pdfOpen, setPdfOpen] = useState(false)
    // "Record payment" hands the documents card a preset; the nonce makes
    // every click a fresh request even for the same party
    const [documentPreset, setDocumentPreset] = useState<DocumentPreset | null>(null)

    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const { data } = useSuspenseQuery(trpc.order.get.queryOptions({ orderId }))
    const { mutate: resolveFlag, isPending: resolving } = useMutation(trpc.order.resolveFlag.mutationOptions())
    
    const { onOpen } = useUpdateOrder()
    const { onEdit, onConfirm } = useCreateOrder()

    // Button states only — the server re-checks every permission
    const { data: session } = authClient.useSession()
    const role: StaffRole =
        session?.user.role === "admin" ? "admin" :
            session?.user.role === "manager" ? "manager" : "user"

    const order = data.order
    const primary = primaryOrderAction(order)
    const effective = effectiveTotals(order)
    // Mirrors both server gates: proofs are refused on prospects (payment
    // status is not-applicable before booking), and voiding one needs the
    // document:delete outer gate plus payment:void inside the procedure
    const canRecordPayment = isAuthorized(role, "payment", ["record"]) && order.status !== "prospect"
    const canVoidPayment =
        isAuthorized(role, "document", ["delete"]) && isAuthorized(role, "payment", ["void"])

    function recordPayment(party: "shipper" | "carrier") {
        setDocumentPreset({ type: PROOF_OF_PAYMENT, party, nonce: Date.now() })
    }
    const hasAdjustments =
        Number(order.shipperDebitTotal) !== 0 || Number(order.shipperCreditTotal) !== 0 ||
        Number(order.carrierDebitTotal) !== 0 || Number(order.carrierCreditTotal) !== 0

    function onResolveFlag() {
        resolveFlag(
            { orderId, expectedVersion: order.version },
            {
                onSuccess: () => {
                    queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId }))
                    toast(t("flagResolved"))
                },
                onError: () => toast(t("flagResolveFailed")),
            },
        )
    }

    return (
        <>
            {/* header: identity + status + actions */}
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <Button asChild size="icon-sm" variant="ghost" aria-label={t("back")}>
                        <Link href="/orders/all"><IconArrowLeft /></Link>
                    </Button>

                    <div className="min-w-0 space-y-2">
                        <OrderIdentity order={order} className="min-w-0" />

                        {/* Only anomalies are worth a badge — a healthy sync
                            is the expected state, not news */}
                        {data.sheetSync && data.sheetSync.state !== "done" && (
                            <Badge
                                variant="outline"
                                className={cn(
                                    "gap-1",
                                    data.sheetSync.state === "failed" && "border-destructive/40 text-destructive",
                                )}
                            >
                                <IconCloudX className="size-3" />
                                {t(`sheetSync.${data.sheetSync.state}`)}
                            </Badge>
                        )}
                    </div>

                    {/* One button — the single next step, a transition or the
                        deal form for a prospect — everything else (other
                        transitions, edit, PDF) lives in the menu */}
                    <div className="ml-auto flex items-center gap-2">
                        {primary?.kind === "confirm" ? (
                            <Button size="sm" onClick={() => onConfirm(order)}>
                                <IconCheck />
                                <span className="truncate">{t("confirm")}</span>
                            </Button>
                        ) : primary ? (
                            <Button size="sm" onClick={() => setDialog({ open: true, to: primary.to })}>
                                <IconArrowRight />
                                <span className="truncate">{tStatus(primary.to)}</span>
                            </Button>
                        ) : (
                            <Button size="sm" onClick={() => setDialog({ open: true })}>
                                <IconArrowRight />
                                {t("changeStatus")}
                            </Button>
                        )}

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button size="icon-sm" variant="outline" aria-label={t("more")}>
                                    <IconDots />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {primary && (
                                    <DropdownMenuItem onSelect={() => setDialog({ open: true })}>
                                        <IconArrowRight />
                                        {t("changeStatus")}
                                    </DropdownMenuItem>
                                )}
                                {/* A prospect edits via the create-shaped form
                                    (full validation); booked onward uses the
                                    patch tabs */}
                                <DropdownMenuItem
                                    onSelect={() =>
                                        order.status === "prospect" ? onEdit(order) : onOpen(order)
                                    }
                                >
                                    <IconEdit />
                                    {t("edit")}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setPdfOpen(true)}>
                                    <IconSend />
                                    {t("sendPdf")}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                {order.flaggedForReview && (
                    <Alert variant="destructive">
                        <IconFlag />
                        <AlertTitle>{t("flagged.title")}</AlertTitle>
                        <AlertDescription className="flex flex-col gap-2">
                            <span>{order.flagReason ?? t("flagged.noReason")}</span>
                            {isAuthorized(role, "order", ["flag-resolve"]) && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="w-fit"
                                    disabled={resolving}
                                    onClick={onResolveFlag}
                                >
                                    <IconFlagCheck />
                                    {t("flagged.resolve")}
                                </Button>
                            )}
                        </AlertDescription>
                    </Alert>
                )}
            </div>

            {/* main + rail */}
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
                <div className="flex min-w-0 flex-col gap-3">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">{t("sections.shipment")}</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <RouteField order={order} orientation="stacked" className="min-w-0 flex-1" />
                                <ShipmentTotal order={order} className="shrink-0" />
                            </div>

                            <CargoFlags order={order} />

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <LoadingDateField order={order} />
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                        {t("sections.description")}
                                    </span>
                                    <p className="text-sm">{order.description}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">{t("sections.payments")}</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            <PartyBlock order={order} party="shipper" layout="stacked" showPaid />
                            <PaymentLedger
                                party="shipper"
                                documents={data.documents}
                                currency={order.shipperCurrency}
                                canRecord={canRecordPayment}
                                onRecord={() => recordPayment("shipper")}
                            />
                            <Separator />
                            <PartyBlock order={order} party="carrier" layout="stacked" showPaid />
                            <PaymentLedger
                                party="carrier"
                                documents={data.documents}
                                currency={order.carrierCurrency}
                                canRecord={canRecordPayment}
                                onRecord={() => recordPayment("carrier")}
                            />

                            {hasAdjustments && (
                                <div className="rounded-xl border bg-muted/30 p-3 text-sm">
                                    <p className="mb-1 font-medium">{t("adjustments.title")}</p>
                                    <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                                        <div className="flex justify-between gap-2">
                                            <dt className="text-muted-foreground">{t("adjustments.shipperEffective")}</dt>
                                            <dd className="tabular-nums font-medium">
                                                {effective.shipperTotal !== null
                                                    ? `${f.number(effective.shipperTotal, { maximumFractionDigits: 2 })} ${order.shipperCurrency}`
                                                    : "—"}
                                            </dd>
                                        </div>
                                        <div className="flex justify-between gap-2">
                                            <dt className="text-muted-foreground">{t("adjustments.carrierEffective")}</dt>
                                            <dd className="tabular-nums font-medium">
                                                {effective.carrierTotal !== null
                                                    ? `${f.number(effective.carrierTotal, { maximumFractionDigits: 2 })} ${order.carrierCurrency}`
                                                    : "—"}
                                            </dd>
                                        </div>
                                    </dl>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">{t("sections.operations")}</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                            <OperationsStrip order={order} />
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <Metric label={t("metrics.distance")} value={order.distance ? `${f.number(order.distance)} km` : "—"} />
                                <Metric label={t("metrics.deliveries")} value={order.deliveries ?? "—"} />
                                <Metric label={t("metrics.daysTraveling")} value={order.daysSpendTraveling ?? "—"} />
                                <Metric label={t("metrics.podStatus")} value={order.podStatus ? t(`pod.${order.podStatus}`) : "—"} />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="flex min-w-0 flex-col gap-3">
                    <DocumentsCard
                        orderId={orderId}
                        documents={data.documents}
                        canDelete={isAuthorized(role, "document", ["delete"])}
                        canCreateNote={isAuthorized(role, "note", ["create"])}
                        canRecordPayment={canRecordPayment}
                        canVoidPayment={canVoidPayment}
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
                        preset={documentPreset}
                    />

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">{t("sections.history")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <HistoryTimeline entries={data.history} />
                        </CardContent>
                    </Card>
                </div>
            </div>

            {dialog.open && (
                <TransitionDialog
                    orderId={orderId}
                    open={dialog.open}
                    initialTarget={dialog.to}
                    onClose={() => setDialog({ open: false })}
                />
            )}

            {pdfOpen && (
                <SendPdfDialog order={order} open={pdfOpen} onClose={() => setPdfOpen(false)} />
            )}

            {/* quick-edit sheet, shared with the list page */}
            <UpdateOrderView />
        </>
    )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1 rounded-xl border p-3">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
            <span className="text-sm font-medium tabular-nums">{value}</span>
        </div>
    )
}
