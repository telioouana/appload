"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useFormState, type FieldErrors } from "react-hook-form"
import { IconCancel, IconCheck, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { authClient } from "@workspace/auth/client"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@/lib/trpc-error"
import { ORDER_ERROR_CODES } from "@/lib/orders/errors"
import { PDF_RELEVANT_FIELDS } from "@/lib/orders/pdf"
import { PATCH_ANCHORS, UpdateOrderSchema, orderToUpdateDefaults, type UpdateOrderForm, type UpdateOrderFormInput } from "@/backend/schemas/order"

import { useUpdateOrder } from "../hooks/use-update-order"
import { OrderDetailsTab } from "../tabs/order-details-tab"
import { AccountingDetailsTab } from "../tabs/accounting-details-tab"
import { TripDetailsTab } from "../tabs/trip-details-tab"
import { OrderUpdatedSuccess, type UpdatedOrder } from "../section/order-updated-success"

const SPREADSHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

// The update endpoint can also miss the row entirely (deleted elsewhere),
// lose the optimistic-lock race, or reject the actor's role
const DETAILS_ERROR_CODES = [
    ...ORDER_ERROR_CODES, "NOT_FOUND", "VERSION_CONFLICT", "NOT_ALLOWED",
    // Verification gate, raised when booking commits cargo to a carrier
    "CARRIER_NOT_VERIFIED", "CARRIER_CONTRACT_MISSING", "CARRIER_CONTRACT_EXPIRED",
    "CARRIER_SUSPENDED", "RISK_ACK_NOT_ALLOWED", "RISK_ACK_NOTE_REQUIRED",
    // Money locks: paid fields of a POP-governed leg are derived, and a leg
    // with notes or proofs of payment cannot repoint its currency
    "POP_PAYMENT_LOCKED", "NOTE_CURRENCY_LOCKED",
] as const;
type DetailsErrorCode = (typeof DETAILS_ERROR_CODES)[number];

const ERROR_MESSAGE_KEYS = {
    "INVALID": "invalid",
    "UNAUTHORIZED": "unauthorized",
    "GOOGLE_NOT_LINKED": "googleNotLinked",
    "INSUFFICIENT_SCOPE": "insufficientScope",
    "SHEET_FAILED": "sheetFailed",
    "HEADER_MISMATCH": "headerMismatch",
    "TRUCK_NOT_REGISTERED": "truckNotRegistered",
    "TRAILER_NOT_REGISTERED": "trailerNotRegistered",
    "LINK_NOT_REGISTERED": "linkNotRegistered",
    "DRIVER_NOT_REGISTERED": "driverNotRegistered",
    "NOT_FOUND": "notFound",
    "VERSION_CONFLICT": "versionConflict",
    "NOT_ALLOWED": "notAllowed",
    "CARRIER_NOT_VERIFIED": "carrierNotVerified",
    "CARRIER_CONTRACT_MISSING": "carrierContractMissing",
    "CARRIER_CONTRACT_EXPIRED": "carrierContractExpired",
    "CARRIER_SUSPENDED": "carrierSuspended",
    "RISK_ACK_NOT_ALLOWED": "riskAckNotAllowed",
    "RISK_ACK_NOTE_REQUIRED": "riskAckNoteRequired",
    "POP_PAYMENT_LOCKED": "paymentLocked",
    "NOTE_CURRENCY_LOCKED": "noteCurrencyLocked",
    "UNKNOWN": "unknown",
} as const satisfies Record<DetailsErrorCode, string>;

type DetailsTab = "order" | "accounting" | "trip";

const TAB_FORM_IDS: Record<DetailsTab, string> = {
    order: "order-details-form",
    accounting: "accounting-details-form",
    trip: "trip-details-form",
};

// RHF keeps reverted fields in dirtyFields with `false` (and nested objects
// as maps of booleans); only truthy leaves mean an actual change
const hasDirt = (value: unknown): boolean =>
    value === true || (typeof value === "object" && value !== null && Object.values(value).some(hasDirt));

/**
 * Sparse patch: only the fields the user touched travel to the server, so
 * the activity log's `changedFields` stays meaningful. A nested dirty flag
 * (e.g. loadingAddress.country) sends the whole jsonb object. Status never
 * travels in a patch — the server rejects it; transitions have their own
 * guarded mutation.
 */
function buildPatch(values: UpdateOrderForm, dirty: Partial<Record<keyof UpdateOrderFormInput, unknown>>): Partial<UpdateOrderForm> {
    const patch: Record<string, unknown> = {};

    for (const key of Object.keys(dirty) as (keyof UpdateOrderForm)[]) {
        if (!hasDirt(dirty[key])) continue;
        if (key === "status") continue;
        patch[key] = values[key];
    }

    return patch as Partial<UpdateOrderForm>;
}

const amount = (value: unknown): number => {
    const parsed = typeof value === "number" ? value : Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

export function UpdateOrderView() {
    const [error, setError] = useState<DetailsErrorCode | null>(null)
    const [crossTabError, setCrossTabError] = useState<string | null>(null)
    const [updated, setUpdated] = useState<UpdatedOrder | null>(null)
    const [activeTab, setActiveTab] = useState<DetailsTab>("order")

    const { isOpen, order, setOrder, onClose } = useUpdateOrder()
    const t = useTranslations("Admin.order.details")
    const tUpdate = useTranslations("Admin.order.update")

    const FormSchema = useMemo(() => UpdateOrderSchema(tUpdate), [tUpdate])
    const defaults = useMemo(() => (order ? orderToUpdateDefaults(order) : undefined), [order])

    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const { isPending, mutate } = useMutation(trpc.order.update.mutationOptions())

    // A leg that has ever had a proof of payment derives its paid fields
    // from the proofs; the accounting tab locks those inputs so a stale
    // hand-typed value can never poison the patch (the server rejects it too)
    const { data: paymentSummary } = useQuery(trpc.documents.paymentSummary.queryOptions(
        { orderId: order?.orderId ?? "" },
        { enabled: isOpen && !!order },
    ))
    const lockedParties = {
        carrier: !!paymentSummary?.carrier.governed,
        shipper: !!paymentSummary?.shipper.governed,
    }

    // One form per tab so each tab saves independently; all validate against
    // the full schema over full-row defaults (the cross-field rules expect
    // the whole record) while only rendering their own subset
    const orderForm = useForm<UpdateOrderFormInput, unknown, UpdateOrderForm>({
        resolver: zodResolver(FormSchema),
        values: defaults,
        resetOptions: { keepDirtyValues: true },
    })
    const accountingForm = useForm<UpdateOrderFormInput, unknown, UpdateOrderForm>({
        resolver: zodResolver(FormSchema),
        values: defaults,
        resetOptions: { keepDirtyValues: true },
    })
    const tripForm = useForm<UpdateOrderFormInput, unknown, UpdateOrderForm>({
        resolver: zodResolver(FormSchema),
        values: defaults,
        resetOptions: { keepDirtyValues: true },
    })

    const forms = { order: orderForm, accounting: accountingForm, trip: tripForm } as const

    const { isDirty: orderDirty } = useFormState({ control: orderForm.control })
    const { isDirty: accountingDirty } = useFormState({ control: accountingForm.control })
    const { isDirty: tripDirty } = useFormState({ control: tripForm.control })
    const dirtyByTab: Record<DetailsTab, boolean> = { order: orderDirty, accounting: accountingDirty, trip: tripDirty }

    // Re-entrancy guard: derived setValue calls below re-fire the watch
    // subscription; without this the subtotal/total branches trigger each other forever
    const syncing = useRef(false)

    useEffect(() => {
        const unsubscribe = accountingForm.subscribe({
            formState: { values: true },
            callback: ({ values, name }) => {
                if (syncing.current) return

                const round = (value: number) => value.toFixed(2)
                const hasValue = (value: unknown) => value !== undefined && value !== null && value !== ""
                const write = (apply: () => void) => {
                    syncing.current = true
                    apply()
                    syncing.current = false
                }

                // Commission always follows the totals: total = shipperTotal -
                // carrierTotal, VAT by the carrier's regime (n/a -> 0, normal ->
                // 16% of the VAT-inclusive total, otherwise the shipper VAT).
                // Must run inside write() alongside the branch that changed
                const writeCommission = (shipperTotal: number, shipperVAT: number, carrierTotal: number) => {
                    const commissionTotal = shipperTotal - carrierTotal
                    const commissionVAT =
                        values.fiscalRegime === "n/a" ? 0
                            : values.fiscalRegime === "normal" ? commissionTotal * 0.16 / 1.16
                                : shipperVAT

                    accountingForm.setValue("apploadCommissionTotal", round(commissionTotal), { shouldDirty: true })
                    accountingForm.setValue("apploadCommissionVAT", round(commissionVAT), { shouldDirty: true })
                    accountingForm.setValue("apploadCommissionSubtotal", round(commissionTotal - commissionVAT), { shouldDirty: true })
                }

                // Same VAT rules the create form applies, keyed off the stored
                // route/fiscalRegime (both live in this form's full-row values)
                if (name === "shipperSubtotal" && hasValue(values.shipperSubtotal)) {
                    const subtotal = amount(values.shipperSubtotal)
                    const vat = values.route === "national" ? subtotal * 0.16 : 0
                    write(() => {
                        accountingForm.setValue("shipperVAT", round(vat), { shouldDirty: true })
                        accountingForm.setValue("shipperTotal", round(subtotal + vat), { shouldDirty: true })
                        if (hasValue(values.carrierTotal)) {
                            writeCommission(subtotal + vat, vat, amount(values.carrierTotal))
                        }
                    })
                }

                if (name === "shipperTotal" && hasValue(values.shipperTotal)) {
                    const total = amount(values.shipperTotal)
                    const vat = values.route === "national" ? total * 0.16 / 1.16 : 0
                    write(() => {
                        accountingForm.setValue("shipperVAT", round(vat), { shouldDirty: true })
                        accountingForm.setValue("shipperSubtotal", round(total - vat), { shouldDirty: true })
                        if (hasValue(values.carrierTotal)) {
                            writeCommission(total, vat, amount(values.carrierTotal))
                        }
                    })
                }

                if (name === "carrierSubtotal" && hasValue(values.carrierSubtotal)) {
                    const subtotal = amount(values.carrierSubtotal)
                    const vat = values.fiscalRegime === "normal" ? subtotal * 0.16 : 0
                    write(() => {
                        accountingForm.setValue("carrierVAT", round(vat), { shouldDirty: true })
                        accountingForm.setValue("carrierTotal", round(subtotal + vat), { shouldDirty: true })
                        if (hasValue(values.shipperTotal)) {
                            writeCommission(amount(values.shipperTotal), amount(values.shipperVAT), subtotal + vat)
                        }
                    })
                }

                if (name === "carrierTotal" && hasValue(values.carrierTotal)) {
                    const total = amount(values.carrierTotal)
                    const vat = values.fiscalRegime === "normal" ? total * 0.16 / 1.16 : 0
                    write(() => {
                        accountingForm.setValue("carrierVAT", round(vat), { shouldDirty: true })
                        accountingForm.setValue("carrierSubtotal", round(total - vat), { shouldDirty: true })
                        if (hasValue(values.shipperTotal)) {
                            writeCommission(amount(values.shipperTotal), amount(values.shipperVAT), total)
                        }
                    })
                }
            },
        })

        return unsubscribe
    }, [accountingForm])

    function handleClose() {
        orderForm.reset()
        accountingForm.reset()
        tripForm.reset()
        setError(null)
        setCrossTabError(null)
        setActiveTab("order")
        onClose()
    }

    const submitFor = (tab: DetailsTab) => (values: UpdateOrderForm) => {
        if (!order) return

        const form = forms[tab]
        setError(null)
        setCrossTabError(null)

        const patch = buildPatch(values, form.formState.dirtyFields)
        if (Object.keys(patch).length === 0) return

        mutate({ orderId: order.orderId, expectedVersion: order.version, patch }, {
            onSuccess: (result) => {
                setOrder(result.order)
                // Only the submitted form resets; the other tabs keep any
                // unsaved edits (their stale clean values never get sent)
                form.reset(orderToUpdateDefaults(result.order))
                queryClient.invalidateQueries(trpc.orders.list.queryFilter())
                // A total change re-derives the paid figures on governed
                // legs, so the details page and the lock state must refetch
                queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId: order.orderId }))
                queryClient.invalidateQueries(trpc.documents.paymentSummary.queryFilter({ orderId: order.orderId }))

                const pdfRelevant = Object.keys(patch).some((key) => (PDF_RELEVANT_FIELDS as readonly string[]).includes(key))

                if (result.order.status === "booked" && pdfRelevant) {
                    setUpdated(result)
                } else if (result.warning === "SHEET_FAILED") {
                    setError("SHEET_FAILED")
                }
            },
            onError: (err) => {
                setError(domainErrorCode(err, DETAILS_ERROR_CODES, "UNKNOWN"))
            },
        })
    }

    // A status change can fail validation on the trip-tab anchor dates,
    // whose inline errors the active tab never renders — surface them here
    const invalidFor = (tab: DetailsTab) => (errors: FieldErrors<UpdateOrderFormInput>) => {
        if (tab === "trip") return

        for (const anchor of PATCH_ANCHORS) {
            const message = errors[anchor]?.message
            if (typeof message === "string") {
                setCrossTabError(`${t("tabs.trip")}: ${message}`)
                return
            }
        }
    }

    function onReconnectGoogle() {
        authClient.linkSocial({
            provider: "google",
            scopes: [SPREADSHEETS_SCOPE],
            callbackURL: window.location.href,
        })
    }

    const needsGoogleReconnect = error === "GOOGLE_NOT_LINKED" || error === "INSUFFICIENT_SCOPE"

    return (
        <>
            <Sheet open={isOpen}>
                <SheetContent
                    side="right"
                    showCloseButton={false}
                    className="data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-3/5 2xl:data-[side=right]:w-1/2"
                >
                    <SheetHeader>
                        <SheetTitle>{t("title")}</SheetTitle>
                        <SheetDescription>
                            {order && t("description", { orderId: order.orderId })}
                        </SheetDescription>

                        <SheetClose asChild>
                            <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={handleClose}
                                className="absolute top-4 right-4 bg-secondary"
                            >
                                <IconX />
                                <span className="sr-only">{tUpdate("actions.cancel")}</span>
                            </Button>
                        </SheetClose>
                    </SheetHeader>

                    <Tabs
                        value={activeTab}
                        onValueChange={(value) => {
                            setActiveTab(value as DetailsTab)
                            setCrossTabError(null)
                        }}
                        className="flex-1 min-h-0"
                    >
                        <TabsList className="mx-6">
                            <TabsTrigger value="order">{t("tabs.order")}</TabsTrigger>
                            <TabsTrigger value="accounting">{t("tabs.accounting")}</TabsTrigger>
                            <TabsTrigger value="trip">{t("tabs.trip")}</TabsTrigger>
                        </TabsList>

                        <TabsContent value="order" className="min-h-0 overflow-y-auto container-snap">
                            <OrderDetailsTab
                                form={orderForm}
                                isPending={isPending}
                                onSubmit={submitFor("order")}
                                onInvalid={invalidFor("order")}
                            />
                        </TabsContent>

                        <TabsContent value="accounting" className="min-h-0 overflow-y-auto container-snap">
                            <AccountingDetailsTab
                                form={accountingForm}
                                isPending={isPending}
                                lockedParties={lockedParties}
                                onSubmit={submitFor("accounting")}
                                onInvalid={invalidFor("accounting")}
                            />
                        </TabsContent>

                        <TabsContent value="trip" className="min-h-0 overflow-y-auto container-snap">
                            <TripDetailsTab
                                form={tripForm}
                                isPending={isPending}
                                onSubmit={submitFor("trip")}
                                onInvalid={invalidFor("trip")}
                            />
                        </TabsContent>
                    </Tabs>

                    <SheetFooter className="gap-y-2">
                        {(error || crossTabError) && (
                            <Alert variant="destructive">
                                <AlertDescription className="flex flex-col gap-2">
                                    {error ? t(`errors.${ERROR_MESSAGE_KEYS[error]}`) : crossTabError}
                                    {needsGoogleReconnect && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={onReconnectGoogle}
                                        >
                                            {t("errors.reconnect")}
                                        </Button>
                                    )}
                                </AlertDescription>
                            </Alert>
                        )}

                        <Button
                            type="submit"
                            form={TAB_FORM_IDS[activeTab]}
                            disabled={isPending || !dirtyByTab[activeTab]}
                        >
                            {isPending ? <Spinner /> : <IconCheck />}
                            {isPending ? tUpdate("actions.saving") : tUpdate("actions.save")}
                        </Button>
                        <Button
                            type="button"
                            onClick={handleClose}
                            variant="outline"
                            disabled={isPending}
                        >
                            <IconCancel />
                            {tUpdate("actions.cancel")}
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>

            <OrderUpdatedSuccess result={updated} onClose={() => setUpdated(null)} />
        </>
    )
}
