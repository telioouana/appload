"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    IconArrowRight,
    IconCancel,
    IconCheck,
    IconCloudX,
    IconDots,
    IconEdit,
    IconExternalLink,
    IconFlag,
    IconFlagCheck,
    IconGavel,
    IconMapPin,
    IconPackage,
    IconSend,
    IconX,
} from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import { Link } from "@/i18n/navigation"
import { authClient } from "@workspace/auth/client"
import { isAuthorized, type StaffRole } from "@workspace/auth/user-permissions"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Separator } from "@workspace/ui/components/separator"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { PROOF_OF_PAYMENT } from "@/lib/orders/payments"
import { primaryOrderAction } from "@/frontend/pages/orders/lib/actions"
import { OrderRouteMapLazy } from "@/frontend/pages/map/components/order-route-map.lazy"
import { useCreateOrder } from "@/frontend/pages/order/hooks/use-create-order"
import { useUpdateOrder } from "@/frontend/pages/order/hooks/use-update-order"
import { PaymentLedger } from "@/frontend/pages/order/components/payment-ledger"
import { SendPdfDialog } from "@/frontend/pages/order/components/send-pdf-dialog"
import { HistoryTimeline } from "@/frontend/pages/order/components/history-timeline"
import { DocumentsCard } from "@/frontend/pages/order/components/documents-card"
import { AddDocumentDialog, type DocumentPreset } from "@/frontend/pages/order/components/add-document-dialog"
import { OpenDisputeDialog } from "@/frontend/pages/orders/components/open-dispute-dialog"
import { TransitionDialog } from "@/frontend/pages/orders/components/transition-dialog"
import { DisputeBanner, FlagBanner } from "@/frontend/pages/order/sections/exception-banners"
import { Milestones } from "@/frontend/pages/orders/sections/milestones"
import { OperationsStrip, PartyBlock } from "@/frontend/pages/orders/sections/order-item-parts"
import { CargoFlags, OrderStatusBadge, place } from "@/frontend/pages/orders/sections/order-item-shared"
import { useOrderSheet, type OrderTab } from "@/frontend/pages/orders/hooks/use-order-sheet"
import { UNBILLABLE_STATUSES, type OrderStatus } from "@/frontend/pages/orders/types"

/**
 * The order panel the list mounts once. Which order it shows comes from the
 * URL (`?id=APPL021.26`), so a row click, a ⌘K result and a shared link all
 * open the same thing. It reads the same query as the full page and reuses
 * its parts — parties, payments, documents, history — so nothing is shown
 * here that the page would disagree with.
 */
export function OrderSheet() {
    const t = useTranslations("Admin.orders.list.sheet")
    const { id, tab, close, setTab } = useOrderSheet()

    return (
        <Sheet open={Boolean(id)} onOpenChange={(next) => { if (!next) close() }}>
            <SheetContent
                side="right"
                showCloseButton={false}
                className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-3/5 2xl:data-[side=right]:w-[920px]"
            >
                <SheetHeader className="sr-only">
                    <SheetTitle>{t("title")}</SheetTitle>
                    <SheetDescription>{t("description")}</SheetDescription>
                </SheetHeader>

                {id && <OrderPanel key={id} orderId={id} tab={tab} onTab={setTab} onClose={close} />}
            </SheetContent>
        </Sheet>
    )
}

type PanelProps = { orderId: string; tab: OrderTab; onTab: (tab: OrderTab) => void; onClose: () => void }

function OrderPanel({ orderId, tab, onTab, onClose }: PanelProps) {
    const t = useTranslations("Admin.orders")
    const f = useFormatter()
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { data, isPending, isError } = useQuery(trpc.order.get.queryOptions({ orderId }))
    const { mutate: resolveFlag, isPending: resolving } = useMutation(trpc.order.resolveFlag.mutationOptions())

    const { onOpen } = useUpdateOrder()
    const { onEdit, onConfirm } = useCreateOrder()

    // Button states only — the server re-checks every permission
    const { data: session } = authClient.useSession()
    const role: StaffRole =
        session?.user.role === "admin" ? "admin" :
            session?.user.role === "manager" ? "manager" : "user"

    const [dialog, setDialog] = useState<{ open: boolean; to?: OrderStatus }>({ open: false })
    const [pdfOpen, setPdfOpen] = useState(false)
    const [disputeOpen, setDisputeOpen] = useState(false)
    // "Record payment" opens the add-document dialog on a proof for that
    // leg; the dialog is mounted per open, so no nonce is needed to tell two
    // clicks apart
    const [adding, setAdding] = useState<DocumentPreset | null>(null)

    if (isPending) return <PanelSkeleton />
    if (isError || !data) return <PanelError onClose={onClose} />

    const order = data.order
    const dispute = data.dispute
    const primary = primaryOrderAction(order, data.resumeStatus)
    const isProspect = order.status === "prospect"

    const canRecordPayment = isAuthorized(role, "payment", ["record"]) && !isProspect
    // A dispute can hold either side's money until it is settled
    const canRecordFor = (party: "shipper" | "carrier") =>
        canRecordPayment && !(party === "shipper" ? dispute?.holdShipperPayments : dispute?.holdCarrierPayments)
    const canVoidPayment = isAuthorized(role, "document", ["delete"]) && isAuthorized(role, "payment", ["void"])
    const canOpenDispute = !dispute && !UNBILLABLE_STATUSES.includes(order.status) && isAuthorized(role, "dispute", ["open"])

    const recordPayment = (party: "shipper" | "carrier") =>
        setAdding({ type: PROOF_OF_PAYMENT, party })

    const onResolveFlag = () =>
        resolveFlag(
            { orderId, expectedVersion: order.version },
            {
                onSuccess: () => {
                    queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId }))
                    queryClient.invalidateQueries(trpc.orders.pathFilter())
                    toast(t("detailPage.flagResolved"))
                },
                onError: () => toast(t("detailPage.flagResolveFailed")),
            },
        )

    const day = (value: Date) => f.dateTime(value, { day: "numeric", month: "short" })

    const tabs: { value: OrderTab; label: string; count?: number }[] = [
        { value: "overview", label: t("list.sheet.tabs.overview") },
        { value: "payments", label: t("list.sheet.tabs.payments") },
        { value: "documents", label: t("list.sheet.tabs.documents"), count: data.documents.length },
        { value: "history", label: t("list.sheet.tabs.history"), count: data.history.length },
    ]

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-col gap-4 px-5 pt-5 pb-3 md:px-6">
                <div className="flex items-start gap-3.5">
                    <span className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-2xl">
                        <IconPackage className="size-6" stroke={1.5} />
                    </span>

                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-heading truncate text-lg font-semibold tracking-tight">{order.orderId}</h2>
                            <OrderStatusBadge status={order.status} />
                        </div>
                        <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-[13px]">
                            <span className="truncate">{order.shipperName}</span>
                            <span>·</span>
                            <span className="truncate">{place(order.loadingAddress)} → {place(order.offloadingAddress)}</span>
                            <span>·</span>
                            <span className="truncate">
                                {t(`header.filters.category.options.${order.category}`)}
                                {" · "}
                                {f.number(Number(order.weight), { maximumFractionDigits: 1 })} {order.weightUnit}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <CargoFlags order={order} />
                            {order.route === "regional" && <Badge variant="outline">{t("list.values.regional")}</Badge>}
                            {order.flaggedForReview && (
                                <Badge variant="outline" className="border-destructive/40 text-destructive gap-1">
                                    <IconFlag className="size-3" />
                                    {t("list.sheet.flagged")}
                                </Badge>
                            )}
                            {dispute && (
                                <Badge variant="outline" className="border-destructive/40 text-destructive gap-1">
                                    <IconGavel className="size-3" />
                                    {t("list.sheet.disputed")}
                                </Badge>
                            )}
                            {data.sheetSync && data.sheetSync.state !== "done" && (
                                <Badge variant="outline" className={cn("gap-1", data.sheetSync.state === "failed" && "border-destructive/40 text-destructive")}>
                                    <IconCloudX className="size-3" />
                                    {t(`detailPage.sheetSync.${data.sheetSync.state}`)}
                                </Badge>
                            )}
                        </div>
                    </div>

                    <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("list.sheet.close")} className="bg-secondary shrink-0">
                        <IconX className="size-4" stroke={1.5} />
                    </Button>
                </div>

                {/* One primary button — the single next step — then edit and PDF; the rest in the menu */}
                <div className="flex flex-wrap items-center gap-2">
                    {primary?.kind === "confirm" ? (
                        <Button size="sm" onClick={() => onConfirm(order)}>
                            <IconCheck />
                            {t("list.actions.confirm")}
                        </Button>
                    ) : primary ? (
                        <Button size="sm" onClick={() => setDialog({ open: true, to: primary.to })}>
                            <IconArrowRight />
                            {t(`header.filters.status.options.${primary.to}`)}
                        </Button>
                    ) : (
                        <Button size="sm" onClick={() => setDialog({ open: true })}>
                            <IconArrowRight />
                            {t("list.actions.change-status")}
                        </Button>
                    )}

                    <Button size="sm" variant="outline" onClick={() => (isProspect ? onEdit(order) : onOpen(order))}>
                        <IconEdit />
                        {t("list.actions.edit")}
                    </Button>

                    <Button size="sm" variant="outline" onClick={() => setPdfOpen(true)}>
                        <IconSend />
                        {t("list.actions.send-pdf")}
                    </Button>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button size="icon-sm" variant="outline" aria-label={t("list.actions.menu")}>
                                <IconDots />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                            {primary && (
                                <DropdownMenuItem onSelect={() => setDialog({ open: true })}>
                                    <IconArrowRight stroke={1.5} />
                                    {t("list.actions.change-status")}
                                </DropdownMenuItem>
                            )}
                            {order.status !== "completed" && order.status !== "cancelled" && order.status !== "underbid" && order.status !== "delivered" && (
                                <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ open: true, to: "cancelled" })}>
                                    <IconCancel stroke={1.5} />
                                    {t("list.actions.cancel")}
                                </DropdownMenuItem>
                            )}
                            {canOpenDispute && (
                                <DropdownMenuItem onSelect={() => setDisputeOpen(true)}>
                                    <IconGavel stroke={1.5} />
                                    {t("list.actions.open-dispute")}
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                                <Link href={{ pathname: "/orders/details/[orderId]", params: { orderId } }}>
                                    <IconExternalLink stroke={1.5} />
                                    {t("list.actions.full-page")}
                                </Link>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

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

            <div role="tablist" className="flex gap-4 overflow-x-auto border-b px-5 md:px-6">
                {tabs.map((item) => {
                    const active = item.value === tab

                    return (
                        <button
                            key={item.value}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => onTab(item.value)}
                            className={cn(
                                "text-muted-foreground hover:text-foreground -mb-px flex h-11 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 border-transparent text-sm whitespace-nowrap transition-colors",
                                active && "border-primary text-foreground font-medium",
                            )}
                        >
                            {item.label}
                            {item.count !== undefined && (
                                <span className={cn(
                                    "bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums",
                                    active && "bg-primary/12 text-primary",
                                )}>
                                    {item.count}
                                </span>
                            )}
                        </button>
                    )
                })}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
                {tab === "overview" && (
                    <div className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
                        <section>
                            <h3 className="text-muted-foreground mb-3 text-xs font-medium">{t("list.sheet.milestones")}</h3>
                            <Milestones order={order} history={data.history} />
                        </section>

                        <div className="flex min-w-0 flex-col gap-3">
                            <Block title={t("list.sheet.route")}>
                                <div className="flex flex-col gap-2.5">
                                    <Stop
                                        icon={<IconMapPin className="text-destructive size-4" stroke={1.5} />}
                                        name={order.loadingAddress.address}
                                        line={[
                                            order.actualLoadingDate ? t("list.sheet.loaded", { date: day(order.actualLoadingDate) }) : t("list.sheet.expected", { date: day(order.expectedLoadingDate) }),
                                            order.departureLoadingDate ? t("list.sheet.departed", { date: day(order.departureLoadingDate) }) : null,
                                        ].filter(Boolean).join(" · ")}
                                    />
                                    <Stop
                                        icon={<IconFlagCheck className="size-4 text-emerald-500" stroke={1.5} />}
                                        name={order.offloadingAddress.address}
                                        line={
                                            order.actualOffloadingDate ? t("list.sheet.offloaded", { date: day(order.actualOffloadingDate) })
                                                : order.expectedOffloadingDate ? t("list.sheet.expected", { date: day(order.expectedOffloadingDate) })
                                                    : null
                                        }
                                    />
                                    <p className="text-muted-foreground text-xs tabular-nums">
                                        {[
                                            order.distance ? `${f.number(order.distance)} km` : null,
                                            t("list.sheet.trucks", { count: order.expectedTrucks ?? 1 }),
                                            t("list.sheet.deliveries", { count: order.deliveries ?? 1 }),
                                            t(`list.values.${order.route}`),
                                            order.tripType === "backload" ? t("list.values.backload") : null,
                                        ].filter(Boolean).join(" · ")}
                                    </p>
                                    <OrderRouteMapLazy orderId={orderId} status={order.status} className="mt-1 h-60 w-full overflow-hidden rounded-xl" />
                                </div>
                            </Block>

                            <Block title={t("list.sheet.parties")}>
                                <div className="flex flex-col gap-4">
                                    <PartyBlock order={order} party="shipper" layout="stacked" showPaid />
                                    <Separator />
                                    <PartyBlock order={order} party="carrier" layout="stacked" showPaid />
                                </div>
                            </Block>

                            <Block title={t("list.sheet.operations")}>
                                <div className="flex flex-col gap-3">
                                    <OperationsStrip order={order} />
                                    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                                        <Metric label={t("detailPage.metrics.podStatus")} value={order.podStatus ? t(`detailPage.pod.${order.podStatus}`) : "—"} />
                                        <Metric label={t("detailPage.metrics.daysTraveling")} value={order.daysSpendTraveling ?? "—"} />
                                        <Metric label={t("data.labels.weight")} value={`${f.number(Number(order.loadedWeight ?? order.weight), { maximumFractionDigits: 1 })} ${order.weightUnit}`} />
                                    </dl>
                                </div>
                            </Block>
                        </div>
                    </div>
                )}

                {tab === "payments" && (
                    <div className="flex flex-col gap-4">
                        <PartyBlock order={order} party="shipper" layout="stacked" showPaid />
                        <PaymentLedger
                            party="shipper"
                            documents={data.documents}
                            currency={order.shipperCurrency}
                            canRecord={canRecordFor("shipper")}
                            onRecord={() => recordPayment("shipper")}
                        />
                        <Separator />
                        <PartyBlock order={order} party="carrier" layout="stacked" showPaid />
                        <PaymentLedger
                            party="carrier"
                            documents={data.documents}
                            currency={order.carrierCurrency}
                            canRecord={canRecordFor("carrier")}
                            onRecord={() => recordPayment("carrier")}
                        />
                    </div>
                )}

                {tab === "documents" && (
                    <DocumentsCard
                        orderId={orderId}
                        documents={data.documents}
                        canDelete={isAuthorized(role, "document", ["delete"])}
                        canVoidPayment={canVoidPayment}
                        onAdd={() => setAdding({ type: "pod" })}
                    />
                )}

                {tab === "history" && <HistoryTimeline entries={data.history} />}
            </div>

            <div className="text-muted-foreground flex items-center justify-between gap-3 border-t px-5 py-2.5 text-xs md:px-6">
                <Link
                    href={{ pathname: "/orders/details/[orderId]", params: { orderId } }}
                    className="text-primary inline-flex items-center gap-1 font-medium hover:underline"
                >
                    <IconExternalLink className="size-3.5" stroke={1.5} />
                    {t("list.actions.full-page")}
                </Link>
                <span className="tabular-nums">
                    {t("list.sheet.updated", { date: f.dateTime(order.updatedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
                </span>
            </div>

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

            {dialog.open && (
                <TransitionDialog
                    orderId={orderId}
                    open={dialog.open}
                    initialTarget={dialog.to}
                    onClose={() => setDialog({ open: false })}
                />
            )}

            {pdfOpen && <SendPdfDialog order={order} open={pdfOpen} onClose={() => setPdfOpen(false)} />}

            {disputeOpen && (
                <OpenDisputeDialog orderId={orderId} currency={order.shipperCurrency} open={disputeOpen} onClose={() => setDisputeOpen(false)} />
            )}
        </div>
    )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border p-4">
            <h3 className="text-muted-foreground mb-3 text-xs font-medium">{title}</h3>
            {children}
        </section>
    )
}

function Stop({ icon, name, line }: { icon: React.ReactNode; name: string; line: string | null }) {
    return (
        <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{name}</span>
                {line && <span className="text-muted-foreground text-xs tabular-nums">{line}</span>}
            </div>
        </div>
    )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5 rounded-xl border p-2.5">
            <dt className="text-muted-foreground text-[11px]">{label}</dt>
            <dd className="text-[13px] font-medium tabular-nums">{value}</dd>
        </div>
    )
}

function PanelSkeleton() {
    return (
        <div className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-2xl" />
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-5 w-40 rounded-md" />
                    <Skeleton className="h-3.5 w-64 rounded-md" />
                </div>
            </div>
            <Skeleton className="h-8 w-72 rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
                <Skeleton className="h-64 rounded-2xl" />
                <div className="flex flex-col gap-3">
                    {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-32 rounded-2xl" />)}
                </div>
            </div>
        </div>
    )
}

function PanelError({ onClose }: { onClose: () => void }) {
    const t = useTranslations("Admin.orders.list.sheet")

    return (
        <div className="flex flex-col gap-4 p-6">
            <Alert variant="destructive"><AlertDescription>{t("load-failed")}</AlertDescription></Alert>
            <Button variant="outline" onClick={onClose} className="self-start">{t("close")}</Button>
        </div>
    )
}
