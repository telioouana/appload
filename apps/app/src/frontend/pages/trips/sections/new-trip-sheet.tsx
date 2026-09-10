"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useQuery } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconCancel, IconLoader2, IconTruck } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { DEFAULT_PHONE_COUNTRY, toE164 } from "@workspace/ui/lib/phone"

import { Button } from "@workspace/ui/components/button"
import { SelectItem } from "@workspace/ui/components/select"
import { SelectInput } from "@workspace/ui/inputs/select"
import { TextInput } from "@workspace/ui/inputs/text"
import { PhoneInput } from "@workspace/ui/inputs/phone"
import { LocationInput } from "@workspace/ui/inputs/location"
import { DateInput } from "@workspace/ui/inputs/date"
import { TextAreaInput } from "@workspace/ui/inputs/textarea"
import { CheckboxInput } from "@workspace/ui/inputs/checkbox"
import { FieldGroup, FieldLegend, FieldSet, FieldTitle } from "@workspace/ui/components/field"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import type { TrackingAllowance } from "@workspace/domain/subscription"

import { useTRPC } from "@/backend/api/client"
import { PlanDialog, planBlock, planRefusal, type PlanReason } from "@/components/plan-dialog"
import { useTripMutations } from "@/frontend/pages/trips/hooks/use-trip-mutations"
import { CreateTripFormSchema, type CreateTripForm } from "@/backend/schemas/trip"

// The partner picker offers every company the tenant already works with;
// one page of connections is far more than anyone has
const PARTNER_LIMIT = 100

/** "No partner" is a real answer — most standalone trips are the tenant's own truck. */
const NO_PARTNER = "none"

const DEFAULT_VALUES: CreateTripForm = {
    driverName: "",
    country: DEFAULT_PHONE_COUNTRY,
    phoneNumber: "",
    origin: { address: "", placeId: "", country: "", state: "" },
    destination: { address: "", placeId: "", country: "", state: "" },
    truckPlate: "",
    cargoDescription: "",
    counterpartyOrgId: NO_PARTNER,
    expectedDeliveryAt: undefined,
    startNow: false,
}

/**
 * Registering a movement to watch: a driver, a phone, two ends of a road.
 *
 * Phone-first on purpose — the driver of a standalone trip is usually not
 * the tenant's own employee, so there is no account to pick from and the
 * number is the whole identity the tracking jobs need.
 *
 * "Already on the road" is the one switch that costs a tracked movement, so
 * it is also the one the plan gate answers: the dialog opens before the form
 * is submitted when the allowance is already spent, and again if the server
 * refuses.
 */
export function NewTripSheet({
    open,
    onOpenChange,
    allowance,
    organizationName,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    allowance: TrackingAllowance
    organizationName: string
}) {
    const t = useTranslations("App.trips")
    const trpc = useTRPC()

    const { create } = useTripMutations()
    const isPending = create.isPending

    const [planReason, setPlanReason] = useState<PlanReason | null>(null)

    // The tenant's own accepted connections, whichever way they point; the
    // procedure checks the chosen one again server-side
    const { data: partners, isPending: loadingPartners } = useQuery({
        ...trpc.partners.list.queryOptions({
            status: "accepted",
            sort: "partner",
            dir: "asc",
            page: 1,
            pageSize: PARTNER_LIMIT,
        }),
        enabled: open,
    })

    const FormSchema = useMemo(
        () => CreateTripFormSchema((field) => ({ error: t(`add.errors.${field}`) })),
        [t],
    )

    const form = useForm<CreateTripForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: DEFAULT_VALUES,
    })

    const { reset, setValue } = form

    // A reopened sheet starts clean rather than where it was left
    useEffect(() => {
        if (open) reset(DEFAULT_VALUES)
    }, [open, reset])

    const country = useWatch({ control: form.control, name: "country" })
    const startNow = useWatch({ control: form.control, name: "startNow" })

    const blocked = planBlock(allowance)

    function onSubmit(values: CreateTripForm) {
        if (values.startNow && blocked) {
            setPlanReason(blocked)
            return
        }

        create.mutate(
            {
                driverName: values.driverName,
                driverPhone: toE164(values.country, values.phoneNumber),
                origin: values.origin,
                destination: values.destination,
                truckPlate: values.truckPlate || undefined,
                cargoDescription: values.cargoDescription || undefined,
                counterpartyOrgId: values.counterpartyOrgId === NO_PARTNER ? undefined : values.counterpartyOrgId,
                expectedDeliveryAt: values.expectedDeliveryAt,
                startNow: values.startNow,
            },
            {
                onSuccess: () => onOpenChange(false),
                onError: (error) => { const reason = planRefusal(error); if (reason) setPlanReason(reason) },
            },
        )
    }

    return (
        <>
            <Sheet open={open} onOpenChange={(next) => { if (!isPending) onOpenChange(next) }}>
                <SheetContent
                    side="right"
                    className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-[620px]"
                >
                    <SheetHeader className="border-b">
                        <SheetTitle>{t("add.title")}</SheetTitle>
                        <SheetDescription>{t("add.description")}</SheetDescription>
                    </SheetHeader>

                    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                        <form
                            id="new-trip-form"
                            onSubmit={(event) => {
                                event.stopPropagation()
                                void form.handleSubmit(onSubmit)(event)
                            }}
                        >
                            <FieldGroup className="gap-6">
                                <FieldSet>
                                    <FieldLegend variant="label">
                                        <FieldTitle>{t("add.driver")}</FieldTitle>
                                    </FieldLegend>

                                    <FieldGroup className="gap-4">
                                        <TextInput
                                            name="driverName"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.driverName.label")}
                                            placeholder={t("add.fields.driverName.placeholder")}
                                        />

                                        {/* No `placeholder`: PhoneInput supplies its own from the country */}
                                        <PhoneInput
                                            name="phoneNumber"
                                            control={form.control}
                                            isPending={isPending}
                                            country={country}
                                            setCountry={(value) => setValue("country", value, { shouldDirty: true, shouldValidate: true })}
                                            label={t("add.fields.phone.label")}
                                            description={t("add.fields.phone.description")}
                                        />

                                        <TextInput
                                            name="truckPlate"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.plate.label")}
                                            placeholder={t("add.fields.plate.placeholder")}
                                            description={t("add.fields.plate.description")}
                                        />
                                    </FieldGroup>
                                </FieldSet>

                                <FieldSet>
                                    <FieldLegend variant="label">
                                        <FieldTitle>{t("add.lane")}</FieldTitle>
                                    </FieldLegend>

                                    <FieldGroup className="gap-4">
                                        <LocationInput
                                            name="origin.address"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.origin.label")}
                                            placeholder={t("add.fields.origin.placeholder")}
                                            setPlaceId={(value) => setValue("origin.placeId", value, { shouldDirty: true })}
                                            setCountry={(value) => setValue("origin.country", value, { shouldDirty: true })}
                                            setState={(value) => setValue("origin.state", value, { shouldDirty: true })}
                                        />

                                        <LocationInput
                                            name="destination.address"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.destination.label")}
                                            placeholder={t("add.fields.destination.placeholder")}
                                            setPlaceId={(value) => setValue("destination.placeId", value, { shouldDirty: true })}
                                            setCountry={(value) => setValue("destination.country", value, { shouldDirty: true })}
                                            setState={(value) => setValue("destination.state", value, { shouldDirty: true })}
                                        />

                                        <DateInput
                                            name="expectedDeliveryAt"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.expected.label")}
                                            placeholder={t("add.fields.expected.placeholder")}
                                        />
                                    </FieldGroup>
                                </FieldSet>

                                <FieldSet>
                                    <FieldLegend variant="label">
                                        <FieldTitle>{t("add.load")}</FieldTitle>
                                    </FieldLegend>

                                    <FieldGroup className="gap-4">
                                        <SelectInput
                                            name="counterpartyOrgId"
                                            control={form.control}
                                            isPending={isPending || loadingPartners}
                                            label={t("add.fields.partner.label")}
                                            placeholder={t("add.fields.partner.placeholder")}
                                            description={t("add.fields.partner.description")}
                                        >
                                            <SelectItem value={NO_PARTNER}>{t("add.fields.partner.none")}</SelectItem>
                                            {(partners?.items ?? []).map((row) => (
                                                <SelectItem key={row.partner.id} value={row.partner.id}>
                                                    {row.partner.name}
                                                </SelectItem>
                                            ))}
                                        </SelectInput>

                                        <TextAreaInput
                                            name="cargoDescription"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.cargo.label")}
                                            placeholder={t("add.fields.cargo.placeholder")}
                                        />

                                        <CheckboxInput
                                            name="startNow"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.startNow.label")}
                                            description={t("add.fields.startNow.description")}
                                        />
                                    </FieldGroup>
                                </FieldSet>
                            </FieldGroup>
                        </form>
                    </div>

                    <div className="flex items-center gap-2 border-t px-6 py-4">
                        <Button type="submit" form="new-trip-form" disabled={isPending}>
                            {isPending
                                ? <IconLoader2 className="size-4 animate-spin" stroke={1.5} />
                                : <IconTruck className="size-4" stroke={1.5} />}
                            {isPending ? t("add.actions.saving") : startNow ? t("add.actions.start") : t("add.actions.save")}
                        </Button>
                        <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
                            <IconCancel className="size-4" stroke={1.5} />
                            {t("add.actions.cancel")}
                        </Button>
                    </div>
                </SheetContent>
            </Sheet>

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
