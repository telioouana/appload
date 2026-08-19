"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { FormProvider, useForm } from "react-hook-form"
import { useEffect, useMemo, useRef, useState } from "react"
import { IconCancel, IconCheck, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { authClient } from "@workspace/auth/client"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import { distanceCalculator, getLogisticsTripType } from "@workspace/ui/lib/google"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@/lib/trpc-error"
import { ORDER_ERROR_CODES } from "@/lib/orders/errors"
import { CreateOrderSchema, orderToCreateDefaults, type CreateOrderForm, type CreateOrderFormInput } from "@/backend/schemas/order";

import { NewOrderForm } from "../forms/new-order-form"
import { useCreateOrder } from "../hooks/use-create-order"
import { CreateOrderSuccess, type CreatedOrder } from "../section/create-order-success"

const SPREADSHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

// Editing a prospect adds the row-level failure modes on top of create's
const VIEW_ERROR_CODES = [
    ...ORDER_ERROR_CODES,
    "NOT_FOUND", "VERSION_CONFLICT", "INVALID_STATE", "NOT_ALLOWED",
    // Verification gate, raised when booking commits cargo to a carrier
    "CARRIER_NOT_VERIFIED", "CARRIER_CONTRACT_MISSING", "CARRIER_CONTRACT_EXPIRED",
    "CARRIER_SUSPENDED", "RISK_ACK_NOT_ALLOWED", "RISK_ACK_NOTE_REQUIRED",
    // updateDeal rewrites the leg currencies, which are frozen once a
    // party has notes or proofs of payment
    "NOTE_CURRENCY_LOCKED",
] as const;
type ViewErrorCode = (typeof VIEW_ERROR_CODES)[number];

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
    "INVALID_STATE": "invalidState",
    "NOT_ALLOWED": "notAllowed",
    "CARRIER_NOT_VERIFIED": "carrierNotVerified",
    "CARRIER_CONTRACT_MISSING": "carrierContractMissing",
    "CARRIER_CONTRACT_EXPIRED": "carrierContractExpired",
    "CARRIER_SUSPENDED": "carrierSuspended",
    "RISK_ACK_NOT_ALLOWED": "riskAckNotAllowed",
    "RISK_ACK_NOTE_REQUIRED": "riskAckNoteRequired",
    "NOTE_CURRENCY_LOCKED": "noteCurrencyLocked",
    "UNKNOWN": "unknown",
} as const satisfies Record<ViewErrorCode, string>;

const DEFAULT_VALUES: CreateOrderFormInput = {
    shipperId: "",
    shipperName: "",
    status: undefined as never,
    loadingAddress: {
        address: "",
        placeId: "",
        country: "",
        state: ""
    },
    expectedLoadingDate: undefined as never,
    offloadingAddress: {
        address: "",
        placeId: "",
        country: "",
        state: ""
    },
    expectedOffloadingDate: undefined as never,
    distance: undefined,
    deliveries: undefined,
    loadType: undefined as never,
    routeType: undefined as never,
    tripType: undefined as never,
    category: undefined as never,
    description: "",
    weight: undefined,
    weightUnit: "ton",
    shipperSubtotal: undefined,
    shipperVAT: undefined,
    shipperTotal: undefined,
    shipperCurrency: undefined as never,
    // driverId: crypto.randomUUID(),
}

const amount = (value: unknown): number => {
    const parsed = typeof value === "number" ? value : Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

export function CreateOrderView() {
    const [error, setError] = useState<ViewErrorCode | null>(null)
    const [created, setCreated] = useState<CreatedOrder | null>(null)

    // `order` set = editing a prospect through this same form, so the
    // prospect → booked move runs the exact validation creation runs
    const { isOpen, order, intent, onClose } = useCreateOrder()
    const t = useTranslations("Admin.order.create")

    const FormSchema = useMemo(() => CreateOrderSchema(t), [t])

    // Entering through "Confirm order" aims the form at booking: the status
    // starts on "booked" so Save books it and every still-required field
    // fails validation at once. A plain edit opens the stored status.
    const values = useMemo(() => {
        if (!order) return DEFAULT_VALUES

        const defaults = orderToCreateDefaults(order)
        return intent === "confirm" ? { ...defaults, status: "booked" as const } : defaults
    }, [order, intent])

    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const createMutation = useMutation(trpc.order.create.mutationOptions())
    const updateMutation = useMutation(trpc.order.updateDeal.mutationOptions())
    const isPending = createMutation.isPending || updateMutation.isPending

    const form = useForm<CreateOrderFormInput, unknown, CreateOrderForm>({
        resolver: zodResolver(FormSchema),
        values,
        resetOptions: { keepDirtyValues: true },
    })

    const routeToken = useRef(0)
    // Re-entrancy guard: derived setValue calls below re-fire the watch
    // subscription; without this the subtotal/total branches trigger each other forever
    const syncing = useRef(false)

    useEffect(() => {
        async function fillRouteInfo(origin: string, destination: string) {
            const token = ++routeToken.current

            const [rows, trip] = await Promise.all([
                distanceCalculator(origin, destination),
                getLogisticsTripType(origin, destination),
            ])
            // A newer address pick superseded this request while it was in flight
            if (token !== routeToken.current) return

            const meters = rows?.[0]?.elements?.[0]?.distance?.value
            if (typeof meters === "number") {
                form.setValue("distance", String(Math.round(meters / 1000)))
            }
            form.setValue("tripType", trip.tripType === "BACKLOAD" ? "backload" : "normal")
        }

        const unsubscribe = form.subscribe({
            formState: { values: true },
            callback: ({ values, name }) => {
            // Skip notifications caused by our own derived writes below
            if (syncing.current) return

            const round = (value: number) => value.toFixed(2)
            const hasValue = (value: unknown) => value !== undefined && value !== null && value !== ""
            // Derived writes go through here so they don't re-trigger this callback;
            // routeType/fiscalRegime are set directly (unguarded) because their
            // recompute branches are exactly the cascade we want
            const write = (apply: () => void) => {
                syncing.current = true
                apply()
                syncing.current = false
            }

            // Keep subtotal/VAT/total in sync as the user types. VAT derived from a
            // subtotal is sub * 0.16; from a VAT-inclusive total it is total * (0.16/1.16).
            // Regional shipper routes and non-"normal" carrier regimes carry no VAT.
            // routeType/fiscalRegime are also triggers so a late change recomputes VAT
            if ((name === "shipperSubtotal" || name === "routeType") && hasValue(values.shipperSubtotal)) {
                const subtotal = amount(values.shipperSubtotal)
                const vat = values.routeType === "national" ? subtotal * 0.16 : 0
                write(() => {
                    form.setValue("shipperVAT", round(vat))
                    form.setValue("shipperTotal", round(subtotal + vat))
                })
            }

            if (name === "shipperTotal" && hasValue(values.shipperTotal)) {
                const total = amount(values.shipperTotal)
                const vat = values.routeType === "national" ? total * 0.16 / 1.16 : 0
                write(() => {
                    form.setValue("shipperVAT", round(vat))
                    form.setValue("shipperSubtotal", round(total - vat))
                })
            }

            if ((name === "carrierSubtotal" || name === "fiscalRegime") && hasValue(values.carrierSubtotal)) {
                const subtotal = amount(values.carrierSubtotal)
                const vat = values.fiscalRegime === "normal" ? subtotal * 0.16 : 0
                write(() => {
                    form.setValue("carrierVAT", round(vat))
                    form.setValue("carrierTotal", round(subtotal + vat))
                })
            }

            if (name === "carrierTotal" && hasValue(values.carrierTotal)) {
                const total = amount(values.carrierTotal)
                const vat = values.fiscalRegime === "normal" ? total * 0.16 / 1.16 : 0
                write(() => {
                    form.setValue("carrierVAT", round(vat))
                    form.setValue("carrierSubtotal", round(total - vat))
                })
            }

            // Once both endpoints are picked, derive the route info from Google:
            // same country -> national, else regional; distance and trip type async
            if (name === "loadingAddress.placeId" || name === "offloadingAddress.placeId") {
                const origin = values.loadingAddress?.placeId
                const destination = values.offloadingAddress?.placeId
                if (origin && destination) {
                    const routeType = values.loadingAddress?.country === values.offloadingAddress?.country ? "national" : "regional"
                    form.setValue("routeType", routeType)
                    if (routeType === "regional") {
                        form.setValue("fiscalRegime", "n/a")
                    }
                    void fillRouteInfo(origin, destination)
                }
            }
            },
        })

        return unsubscribe
    }, [form])

    function handleClose() {
        form.reset()
        onClose()
    }
    function handleSubmit(submitted: CreateOrderForm) {
        form.clearErrors()
        setError(null)

        if (order) {
            updateMutation.mutate(
                { orderId: order.orderId, expectedVersion: order.version, values: submitted },
                {
                    onSuccess: (result) => {
                        form.reset()
                        onClose()
                        queryClient.invalidateQueries(trpc.orders.list.queryFilter())
                        queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId: result.orderId }))
                        setCreated({
                            orderId: result.orderId,
                            status: result.order.status as ["prospect", "booked"][number],
                            // "Order created" is a lie after an edit; only a
                            // prospect reaches this door, so a booked result
                            // means it was just confirmed
                            mode: result.order.status === "booked" ? "booked" : "saved",
                            warning: result.warning,
                            values: submitted,
                        })
                    },
                    onError: (err) => {
                        const code = domainErrorCode(err, VIEW_ERROR_CODES, "UNKNOWN")
                        setError(code)

                        // The form was built from a list row that has since
                        // moved on; refresh it so "try again" reopens on the
                        // current data
                        if (code === "VERSION_CONFLICT") {
                            queryClient.invalidateQueries(trpc.orders.list.queryFilter())
                            queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId: order.orderId }))
                        }
                    },
                },
            )
            return
        }

        createMutation.mutate(submitted, {
            onSuccess: (result) => {
                form.reset()
                onClose()
                queryClient.invalidateQueries(trpc.orders.list.queryFilter())
                setCreated({
                    orderId: result.orderId,
                    status: result.status as ["prospect", "booked"][number],
                    mode: "created",
                    warning: result.warning,
                    values: submitted,
                })
            },
            onError: (err) => {
                setError(domainErrorCode(err, VIEW_ERROR_CODES, "UNKNOWN"))
            },
        })
    }

    function onReconnectGoogle() {
        authClient.linkSocial({
            provider: "google",
            scopes: [SPREADSHEETS_SCOPE],
            callbackURL: window.location.href,
        })
    }

    const needsGoogleReconnect = error === "GOOGLE_NOT_LINKED" || error === "INSUFFICIENT_SCOPE"

    // Create, plain edit, and "complete this and book it" are three different
    // jobs and each says so
    const heading = order
        ? intent === "confirm"
            ? { title: t("confirmTitle", { orderId: order.orderId }), description: t("confirmDescription") }
            : { title: t("editTitle", { orderId: order.orderId }), description: t("editDescription") }
        : { title: t("title"), description: t("description") }

    return (
        <>
            <Sheet open={isOpen}>
                <SheetContent
                    side="right"
                    showCloseButton={false}
                    // Full-bleed on phones, constrained from md upward
                    className="data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:max-w-1/2 xl:data-[side=right]:max-w-1/3"
                >
                    <SheetHeader>
                        <SheetTitle>{heading.title}</SheetTitle>
                        <SheetDescription>{heading.description}</SheetDescription>

                        <SheetClose asChild>
                            <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={handleClose}
                                className="absolute top-4 right-4 bg-secondary"
                            >
                                <IconX />
                                <span className="sr-only">{t("actions.cancel")}</span>
                            </Button>
                        </SheetClose>
                    </SheetHeader>

                    <FormProvider {...form}>
                        <form
                            id="create-order-form"
                            onSubmit={form.handleSubmit(handleSubmit)}
                            className="flex-1 overflow-y-auto px-6 container-snap"
                        >
                            <NewOrderForm isPending={isPending} />
                        </form>
                    </FormProvider>

                    <SheetFooter className="gap-y-2">
                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription className="flex flex-col gap-2">
                                    {t(`errors.${ERROR_MESSAGE_KEYS[error]}`)}
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
                            form="create-order-form"
                            disabled={isPending}
                        >
                            {isPending ? <Spinner /> : <IconCheck />}
                            {isPending ? t("actions.saving") : t("actions.save")}
                        </Button>
                        <Button
                            type="button"
                            onClick={handleClose}
                            variant="outline"
                            disabled={isPending}
                        >
                            <IconCancel />
                            {t("actions.cancel")}
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>

            <CreateOrderSuccess order={created} onClose={() => setCreated(null)} />
        </>
    )
}