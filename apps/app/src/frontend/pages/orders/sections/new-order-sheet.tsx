"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { FormProvider, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconCancel, IconCheck, IconX } from "@tabler/icons-react"

import { useLocale, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import { distanceCalculator, getLogisticsTripType } from "@workspace/ui/lib/google"

import { useRouter } from "@/i18n/navigation"
import { orderErrorKey, type OrderErrorMessage } from "@/frontend/pages/orders/lib/errors"
import { useNewOrder } from "@/frontend/pages/orders/hooks/use-new-order"
import { useOrderMutations } from "@/frontend/pages/orders/hooks/use-order-mutations"
import { NewOrderForm } from "@/frontend/pages/orders/sections/new-order-form"
import {
    CreateOrderSchema,
    type CreateOrderForm,
    type CreateOrderFormInput,
    type OrderMessageField,
} from "@/backend/schemas/order"

const DEFAULT_VALUES: CreateOrderFormInput = {
    loadingAddress: { address: "", placeId: "", country: "", state: "" },
    offloadingAddress: { address: "", placeId: "", country: "", state: "" },
    expectedLoadingDate: undefined as never,
    expectedOffloadingDate: undefined,
    distance: undefined,
    routeType: undefined as never,
    tripType: "normal",
    category: undefined as never,
    description: "",
    weight: undefined,
    weightUnit: "ton",
    loadType: undefined as never,
    packing: undefined,
    deliveries: 1,
    expectedTrucks: 1,
    shipperCurrency: "MZN",
    isHazardous: false,
    hazchemCode: "",
    isRefrigerated: false,
    temperature: undefined,
    temperatureInstructions: "",
}

/**
 * Filing an order. The sheet owns the form, the route derivation and the
 * one mutation; the fields themselves live in `NewOrderForm`.
 *
 * The order is filed as a prospect with no carrier and no price — sending it
 * out to carriers is the next step, on the order's own page, which is where
 * a successful save lands.
 */
export function NewOrderSheet() {
    const t = useTranslations("App.orders.create")
    const tError = useTranslations("App.orders")
    // Passed to the distance server action: it cannot read the request locale
    const locale = useLocale()

    const router = useRouter()
    const { isOpen, close } = useNewOrder()
    const { create } = useOrderMutations()

    const [error, setError] = useState<OrderErrorMessage | null>(null)

    const FormSchema = useMemo(
        () => CreateOrderSchema((field: OrderMessageField) => ({ error: t(`errors.${field}`) })),
        [t],
    )

    const form = useForm<CreateOrderFormInput, unknown, CreateOrderForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: DEFAULT_VALUES,
    })

    const routeToken = useRef(0)

    useEffect(() => {
        async function fillRouteInfo(origin: string, destination: string) {
            const token = ++routeToken.current

            const [rows, trip] = await Promise.all([
                distanceCalculator(origin, destination, locale),
                getLogisticsTripType(origin, destination),
            ])
            // A newer address pick superseded this request while it was in flight
            if (token !== routeToken.current) return

            const meters = rows?.[0]?.elements?.[0]?.distance?.value
            if (typeof meters === "number") {
                form.setValue("distance", Math.round(meters / 1000))
            }
            form.setValue("tripType", trip.tripType === "BACKLOAD" ? "backload" : "normal")
        }

        const unsubscribe = form.subscribe({
            formState: { values: true },
            callback: ({ values, name }) => {
                // Both endpoints picked: the route type is the two countries,
                // the distance and the trip type come from Google
                if (name === "loadingAddress.placeId" || name === "offloadingAddress.placeId") {
                    const origin = values.loadingAddress?.placeId
                    const destination = values.offloadingAddress?.placeId

                    if (origin && destination) {
                        form.setValue(
                            "routeType",
                            values.loadingAddress?.country === values.offloadingAddress?.country ? "national" : "regional",
                        )
                        void fillRouteInfo(origin, destination)
                    }
                }
            },
        })

        return unsubscribe
    }, [form, locale])

    function handleClose() {
        form.reset(DEFAULT_VALUES)
        setError(null)
        close()
    }

    function onSubmit(values: CreateOrderForm) {
        setError(null)

        create.mutate(values, {
            onSuccess: (result) => {
                form.reset(DEFAULT_VALUES)
                close()
                toast.success(t("toasts.created", { orderId: result.orderId }))

                if (result.warning === "DETAILS_INCOMPLETE") {
                    toast.warning(t("toasts.detailsIncomplete"))
                }

                router.push({ pathname: "/appload/details/[orderId]", params: { orderId: result.orderId } })
            },
            onError: (failure) => setError(orderErrorKey(failure)),
        })
    }

    return (
        <Sheet open={isOpen}>
            <SheetContent
                side="right"
                showCloseButton={false}
                // Full-bleed on phones, constrained from md upward
                className="data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:max-w-1/2 xl:data-[side=right]:max-w-2/5"
            >
                <SheetHeader>
                    <SheetTitle>{t("title")}</SheetTitle>
                    <SheetDescription>{t("description")}</SheetDescription>

                    <SheetClose asChild>
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={handleClose}
                            className="bg-secondary absolute top-4 right-4"
                        >
                            <IconX />
                            <span className="sr-only">{t("actions.cancel")}</span>
                        </Button>
                    </SheetClose>
                </SheetHeader>

                <FormProvider {...form}>
                    <form
                        id="new-order-form"
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="container-snap flex-1 overflow-y-auto px-6"
                    >
                        <NewOrderForm isPending={create.isPending} />
                    </form>
                </FormProvider>

                <SheetFooter className="gap-y-2">
                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{tError(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}

                    <Button type="submit" form="new-order-form" disabled={create.isPending}>
                        {create.isPending ? <Spinner /> : <IconCheck />}
                        {create.isPending ? t("actions.saving") : t("actions.save")}
                    </Button>

                    <Button type="button" variant="outline" onClick={handleClose} disabled={create.isPending}>
                        <IconCancel />
                        {t("actions.cancel")}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
