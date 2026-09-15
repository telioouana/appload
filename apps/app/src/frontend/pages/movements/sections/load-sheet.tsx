"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm, useWatch, type Control } from "react-hook-form"
import { useQuery } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconCancel, IconDeviceFloppy, IconLoader2, IconTruck, IconUsersGroup } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { CATEGORIES, CURRENCY, FISCAL_REGIME, WEIGHT_UNIT } from "@workspace/db/types"
import { VAT_RATE } from "@workspace/domain/orders/commission"
import type { TrackingAllowance } from "@workspace/domain/subscription"
import { DEFAULT_PHONE_COUNTRY, fromE164, toE164 } from "@workspace/ui/lib/phone"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { SelectItem } from "@workspace/ui/components/select"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { FieldGroup, FieldLegend, FieldSet, FieldTitle } from "@workspace/ui/components/field"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"
import { DateInput } from "@workspace/ui/inputs/date"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { LocationInput } from "@workspace/ui/inputs/location"
import { PhoneInput } from "@workspace/ui/inputs/phone"
import { SelectInput } from "@workspace/ui/inputs/select"
import { TextAreaInput } from "@workspace/ui/inputs/textarea"
import { TextInput } from "@workspace/ui/inputs/text"
import { WeightInput } from "@workspace/ui/inputs/weight"

import { useRouter } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { PlanDialog, planBlock, planRefusal, type PlanReason } from "@/components/plan-dialog"
import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import {
    CREATE_STATUS,
    LoadFormSchema,
    NONE,
    TYPED,
    type CreateMovementInput,
    type LoadForm,
    type LoadMessageField,
    type MoneyLegInput,
    type UpdateMovementInput,
} from "@/backend/schemas/movement"
import type {
    EditableGroup,
    FiscalRegime,
    LoadFormOptions,
    MoneyLeg,
    MovementDetail,
    MovementExecution,
    OrgType,
} from "@/frontend/pages/movements/types"

export type LoadSheetMode =
    | { kind: "create"; execution: MovementExecution }
    | { kind: "edit"; load: MovementDetail }

// The calendar opens at the start of last year: loads are often filed after
// the fact, and a date before that is a typo
const EARLIEST_DATE = new Date(new Date().getFullYear() - 1, 0, 1)

const EMPTY_LOCATION = { address: "", placeId: "", country: "", state: "" }

const round = (value: number) => Math.round(value * 100) / 100

/** The picker value for a party: its organization, a typed name, or nobody. */
const pickerOf = (party: { id: string | null; name: string | null } | null) =>
    party?.id ?? (party?.name ? TYPED : NONE)

function legDefaults(leg: MoneyLeg | null) {
    return {
        total: leg ? String(leg.total) : "",
        currency: leg?.currency ?? ("MZN" as const),
        fiscalRegime: leg?.fiscalRegime ?? undefined,
        invoiceNumber: leg?.invoiceNumber ?? "",
    }
}

function defaultsFor(mode: LoadSheetMode): LoadForm {
    if (mode.kind === "create") {
        return {
            execution: mode.execution,
            status: "procurement",
            origin: EMPTY_LOCATION,
            destination: EMPTY_LOCATION,
            expectedLoadingDate: undefined,
            expectedDeliveryAt: undefined,
            cargoDescription: "",
            category: undefined,
            weight: "",
            weightUnit: "ton",
            clientOrgId: NONE,
            clientName: "",
            clientReference: "",
            carrierOrgId: NONE,
            carrierName: "",
            driverId: NONE,
            driverName: "",
            country: DEFAULT_PHONE_COUNTRY,
            phoneNumber: "",
            truckId: NONE,
            truckPlate: "",
            sellTotal: "",
            sellCurrency: "MZN",
            sellFiscalRegime: undefined,
            sellInvoiceNumber: "",
            buyTotal: "",
            buyCurrency: "MZN",
            buyFiscalRegime: undefined,
            buyInvoiceNumber: "",
            notes: "",
        }
    }

    const { load } = mode
    // The owner is the only one who edits: its sell leg is what it charges,
    // its buy leg what it pays
    const sell = legDefaults(load.money.receivable)
    const buy = legDefaults(load.money.payable)
    const phone = fromE164(load.driverPhone)

    return {
        execution: load.execution,
        // Status moves through its own door; the form never writes it
        status: "procurement",
        origin: load.origin,
        destination: load.destination,
        expectedLoadingDate: load.expectedLoadingDate ?? undefined,
        expectedDeliveryAt: load.expectedDeliveryAt ?? undefined,
        cargoDescription: load.cargoDescription ?? "",
        category: load.category ?? undefined,
        weight: load.weight === null ? "" : String(load.weight),
        weightUnit: load.weightUnit ?? "ton",
        clientOrgId: pickerOf(load.client),
        clientName: load.client?.id ? "" : load.client?.name ?? "",
        clientReference: load.clientReference ?? "",
        carrierOrgId: pickerOf(load.carrier),
        carrierName: load.carrier?.id ? "" : load.carrier?.name ?? "",
        driverId: load.driverId ?? (load.driverName || load.driverPhone ? TYPED : NONE),
        driverName: load.driverId ? "" : load.driverName ?? "",
        country: phone.country,
        phoneNumber: load.driverId ? "" : phone.national,
        truckId: load.truckId ?? (load.truckPlate ? TYPED : NONE),
        truckPlate: load.truckId ? "" : load.truckPlate ?? "",
        sellTotal: sell.total,
        sellCurrency: sell.currency,
        sellFiscalRegime: sell.fiscalRegime,
        sellInvoiceNumber: sell.invoiceNumber,
        buyTotal: buy.total,
        buyCurrency: buy.currency,
        buyFiscalRegime: buy.fiscalRegime,
        buyInvoiceNumber: buy.invoiceNumber,
        notes: load.notes ?? "",
    }
}

/** A leg as the procedures take it, VAT derived from the regime the way the offer form does. */
function legInput(total: string, currency: LoadForm["sellCurrency"], fiscalRegime: FiscalRegime | undefined): MoneyLegInput | null {
    if (total.trim() === "") return null

    const amount = Number(total)
    const vat = fiscalRegime === undefined ? undefined : fiscalRegime === "normal" ? round(amount * VAT_RATE) : 0

    return {
        total: amount,
        currency,
        ...(fiscalRegime && { fiscalRegime }),
        ...(vat !== undefined && { vat, subtotal: round(amount - vat) }),
    }
}

/** National when both ends are in one country, as the brokerage derives it. */
const routeOf = (values: Pick<LoadForm, "origin" | "destination">) =>
    values.origin.country && values.origin.country === values.destination.country ? "national" as const : "regional" as const

/**
 * Filing a load, or correcting one. One form for both shapes — a trip on the
 * company's own trucks, an order handed to a partner — because they share
 * almost everything, and a trip can become an order later.
 *
 * What the company is decides what it is asked: a transporter says who the
 * load is for and what it charges; a shipper's loads are its own, so it is
 * asked neither. A partner on the portal names its own driver, so the rig is
 * asked only for the company's own trucks or a partner that is not on the
 * portal, and a load for a partner on the portal is filed in procurement —
 * it is offered from its page, never scheduled on the partner's behalf.
 *
 * Editing shows the same fields and locks the blocks the server said can no
 * longer change, and sends only what was changed.
 */
export function LoadSheet({
    mode,
    orgType,
    allowance,
    organizationName,
    open,
    onOpenChange,
}: {
    mode: LoadSheetMode
    orgType: OrgType
    allowance: TrackingAllowance
    organizationName: string
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const t = useTranslations("App.loads.form")
    const tl = useTranslations("App.loads")
    const tv = useTranslations("App.orders")
    const trpc = useTRPC()
    const router = useRouter()

    const { create, update } = useMovementMutations()
    const isPending = create.isPending || update.isPending

    const [error, setError] = useState<MovementErrorMessage | null>(null)
    const [planReason, setPlanReason] = useState<PlanReason | null>(null)

    const { data: options } = useQuery({ ...trpc.movements.formOptions.queryOptions(), enabled: open })

    const FormSchema = useMemo(
        () => LoadFormSchema((field: LoadMessageField) => ({ error: t(`errors.${field}`) })),
        [t],
    )

    const form = useForm<LoadForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: defaultsFor(mode),
    })

    const { control, reset, setValue, getValues } = form

    // A reopened sheet starts from the load as it is now, not where it was left
    const modeKey = mode.kind === "create" ? `create:${mode.execution}` : `edit:${mode.load.id}:${mode.load.version}`
    useEffect(() => {
        if (open) reset(defaultsFor(mode))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, modeKey, reset])

    // An error belongs to the attempt it came from; closing the sheet drops it
    const dismiss = () => {
        setError(null)
        onOpenChange(false)
    }

    const [execution, status, clientOrgId, carrierOrgId, driverId, truckId, country, weightUnit] = useWatch({
        control,
        name: ["execution", "status", "clientOrgId", "carrierOrgId", "driverId", "truckId", "country", "weightUnit"],
    })

    // Read during render so the form tracks it; the edit submit sends only these
    const { dirtyFields } = form.formState

    const editing = mode.kind === "edit"
    const carrier = orgType === "carrier"
    const partner = execution === "partner"
    const editable = editing ? mode.load.permissions.editable : null
    const locked = (group: EditableGroup) => editable !== null && !editable.includes(group)

    const partners = options?.partners ?? []
    const carriers = partners.filter((row) => row.type === "carrier")
    const pickedCarrier = partners.find((row) => row.id === carrierOrgId)
    // A partner on the portal answers for itself: its own driver, its own yes
    const partnerOnPortal = partner && Boolean(pickedCarrier?.onPortal)
    const asksRig = !partner || !partnerOnPortal

    // Picking a partner on the portal takes the load back to procurement:
    // it is offered from its page once it is filed
    useEffect(() => {
        if (partnerOnPortal && getValues("status") !== "procurement") setValue("status", "procurement")
    }, [partnerOnPortal, getValues, setValue])

    function rigInput(values: LoadForm): Partial<CreateMovementInput> {
        if (!asksRig) return {}

        const phone = values.phoneNumber.trim() ? toE164(values.country, values.phoneNumber) : undefined

        return {
            ...(values.driverId !== NONE && values.driverId !== TYPED
                ? { driverId: values.driverId }
                : values.driverId === TYPED ? { driverName: values.driverName.trim() || undefined, driverPhone: phone } : {}),
            ...(values.truckId !== NONE && values.truckId !== TYPED
                ? { truckId: values.truckId }
                : values.truckId === TYPED ? { truckPlate: values.truckPlate.trim() || undefined } : {}),
        }
    }

    function onCreate(values: LoadForm) {
        // A load filed without a driver, a partner or a price is not refused:
        // it is filed flagged, and the flags are on the load's page from the
        // moment it exists. Only the plan still stops one filed with its
        // truck already at the loading site, which starts it
        if (values.status === "at-loading") {
            const blocked = planBlock(allowance)
            if (blocked) {
                setPlanReason(blocked)
                return
            }
        }

        const sell = carrier ? legInput(values.sellTotal, values.sellCurrency, values.sellFiscalRegime) : null
        const buy = values.execution === "partner" ? legInput(values.buyTotal, values.buyCurrency, values.buyFiscalRegime) : null

        const input: CreateMovementInput = {
            execution: values.execution,
            status: values.status,
            origin: values.origin,
            destination: values.destination,
            route: routeOf(values),
            cargoDescription: values.cargoDescription.trim() || undefined,
            category: values.category,
            weight: values.weight.trim() ? Number(values.weight) : undefined,
            weightUnit: values.weight.trim() ? values.weightUnit : undefined,
            expectedLoadingDate: values.expectedLoadingDate,
            expectedDeliveryAt: values.expectedDeliveryAt,
            ...(carrier && values.clientOrgId === TYPED && { clientName: values.clientName.trim() }),
            ...(carrier && values.clientOrgId !== TYPED && values.clientOrgId !== NONE && { clientOrgId: values.clientOrgId }),
            clientReference: values.clientReference.trim() || undefined,
            ...(values.execution === "partner" && values.carrierOrgId === TYPED && { carrierName: values.carrierName.trim() }),
            ...(values.execution === "partner" && values.carrierOrgId !== TYPED && values.carrierOrgId !== NONE && { carrierOrgId: values.carrierOrgId }),
            ...rigInput(values),
            ...(sell && { sell }),
            ...(buy && { buy }),
            notes: values.notes.trim() || undefined,
        }

        create.mutate(input, {
            onSuccess: (result) => {
                onOpenChange(false)
                router.push({ pathname: "/orders/load/[loadId]", params: { loadId: result.id } })
            },
            onError: (failure) => {
                const reason = planRefusal(failure)
                if (reason) {
                    setPlanReason(reason)
                    return
                }
                setError(movementErrorKey(failure))
            },
        })
    }

    function onEdit(load: MovementDetail, values: LoadForm) {
        const changed = (...fields: (keyof LoadForm)[]) => fields.some((field) => Boolean(dirtyFields[field]))

        const patch: UpdateMovementInput = { id: load.id, expectedVersion: load.version }

        if (changed("origin", "destination")) {
            patch.origin = values.origin
            patch.destination = values.destination
            patch.route = routeOf(values)
        }
        if (changed("expectedLoadingDate")) patch.expectedLoadingDate = values.expectedLoadingDate ?? null
        if (changed("expectedDeliveryAt")) patch.expectedDeliveryAt = values.expectedDeliveryAt ?? null
        if (changed("cargoDescription")) patch.cargoDescription = values.cargoDescription.trim() || null
        if (changed("category")) patch.category = values.category ?? null
        if (changed("weight", "weightUnit")) {
            patch.weight = values.weight.trim() ? Number(values.weight) : null
            patch.weightUnit = values.weight.trim() ? values.weightUnit : null
        }

        if (changed("clientOrgId", "clientName")) {
            if (values.clientOrgId === NONE) Object.assign(patch, { clientOrgId: null, clientName: null })
            else if (values.clientOrgId === TYPED) patch.clientName = values.clientName.trim()
            else patch.clientOrgId = values.clientOrgId
        }
        if (changed("clientReference")) patch.clientReference = values.clientReference.trim() || null

        if (changed("sellTotal", "sellCurrency", "sellFiscalRegime")) {
            patch.sell = legInput(values.sellTotal, values.sellCurrency, values.sellFiscalRegime)
        }

        if (changed("carrierOrgId", "carrierName")) {
            if (values.carrierOrgId === TYPED) patch.carrierName = values.carrierName.trim()
            else if (values.carrierOrgId !== NONE) patch.carrierOrgId = values.carrierOrgId
            else Object.assign(patch, { carrierOrgId: null, carrierName: null })
        }
        if (changed("buyTotal", "buyCurrency", "buyFiscalRegime")) {
            patch.buy = legInput(values.buyTotal, values.buyCurrency, values.buyFiscalRegime)
        }

        if (asksRig && changed("driverId", "driverName", "phoneNumber", "country")) {
            if (values.driverId === NONE) Object.assign(patch, { driverId: null, driverName: null, driverPhone: null })
            else if (values.driverId === TYPED) {
                Object.assign(patch, {
                    driverId: null,
                    driverName: values.driverName.trim() || null,
                    driverPhone: values.phoneNumber.trim() ? toE164(values.country, values.phoneNumber) : null,
                })
            } else patch.driverId = values.driverId
        }
        if (asksRig && changed("truckId", "truckPlate")) {
            if (values.truckId === NONE) Object.assign(patch, { truckId: null, truckPlate: null })
            else if (values.truckId === TYPED) Object.assign(patch, { truckId: null, truckPlate: values.truckPlate.trim() || null })
            else patch.truckId = values.truckId
        }

        if (changed("sellInvoiceNumber")) patch.sellInvoice = { invoiceNumber: values.sellInvoiceNumber.trim() || undefined }
        if (changed("buyInvoiceNumber")) patch.buyInvoice = { invoiceNumber: values.buyInvoiceNumber.trim() || undefined }
        if (changed("notes")) patch.notes = values.notes.trim() || null

        update.mutate(patch, {
            onSuccess: () => onOpenChange(false),
            onError: (failure) => setError(movementErrorKey(failure)),
        })
    }

    function onSubmit(values: LoadForm) {
        setError(null)

        if (mode.kind === "edit") onEdit(mode.load, values)
        else onCreate(values)
    }

    const title = editing ? t("edit-title", { ref: mode.load.ref }) : t(partner ? "new-order" : "new-trip")

    return (
        <>
            <Sheet open={open} onOpenChange={(next) => { if (!isPending) { if (next) onOpenChange(true); else dismiss() } }}>
                <SheetContent
                    side="right"
                    className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-[680px]"
                >
                    <SheetHeader className="border-b">
                        <SheetTitle>{title}</SheetTitle>
                        <SheetDescription>{editing ? t("edit-description") : t(`description.${orgType}`)}</SheetDescription>
                    </SheetHeader>

                    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                        <form
                            id="load-form"
                            onSubmit={(event) => {
                                // The sheet can open over another form (the rail's
                                // button sits beside a page's own); keep this
                                // submit from bubbling into it
                                event.stopPropagation()
                                void form.handleSubmit(onSubmit)(event)
                            }}
                        >
                            <FieldGroup className="gap-7">
                                {!editing && (
                                    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("shape.label")}>
                                        {(["own-fleet", "partner"] as const).map((value) => {
                                            const active = execution === value
                                            const ShapeIcon = value === "own-fleet" ? IconTruck : IconUsersGroup

                                            return (
                                                <button
                                                    key={value}
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={active}
                                                    disabled={isPending}
                                                    onClick={() => setValue("execution", value, { shouldDirty: true })}
                                                    className={cn(
                                                        "flex cursor-pointer items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-left text-sm transition-colors disabled:cursor-default disabled:opacity-50",
                                                        active ? "border-primary bg-primary/5" : "hover:bg-muted",
                                                    )}
                                                >
                                                    <ShapeIcon className="mt-0.5 size-4 shrink-0" stroke={1.5} />
                                                    <span className="min-w-0">
                                                        <span className="block font-medium">{t(`shape.${value}`)}</span>
                                                        <span className="text-muted-foreground block text-xs">{t(`shape.${value}-hint`)}</span>
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}

                                <FieldSet>
                                    <FieldLegend variant="label"><FieldTitle>{t("sections.lane")}</FieldTitle></FieldLegend>
                                    <FieldGroup className="gap-4">
                                        <LocationInput
                                            name="origin.address"
                                            control={control}
                                            isPending={isPending || locked("details")}
                                            label={t("fields.origin")}
                                            placeholder={t("fields.origin-placeholder")}
                                            setPlaceId={(value) => setValue("origin.placeId", value, { shouldDirty: true })}
                                            setCountry={(value) => setValue("origin.country", value, { shouldDirty: true })}
                                            setState={(value) => setValue("origin.state", value, { shouldDirty: true })}
                                        />
                                        <LocationInput
                                            name="destination.address"
                                            control={control}
                                            isPending={isPending || locked("details")}
                                            label={t("fields.destination")}
                                            placeholder={t("fields.destination-placeholder")}
                                            setPlaceId={(value) => setValue("destination.placeId", value, { shouldDirty: true })}
                                            setCountry={(value) => setValue("destination.country", value, { shouldDirty: true })}
                                            setState={(value) => setValue("destination.state", value, { shouldDirty: true })}
                                        />
                                        <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                                            <DateInput
                                                name="expectedLoadingDate"
                                                control={control}
                                                isPending={isPending || locked("details")}
                                                value={EARLIEST_DATE}
                                                label={t("fields.loading")}
                                                placeholder={t("fields.date-placeholder")}
                                            />
                                            <DateInput
                                                name="expectedDeliveryAt"
                                                control={control}
                                                isPending={isPending || locked("details")}
                                                value={EARLIEST_DATE}
                                                label={t("fields.due")}
                                                placeholder={t("fields.date-placeholder")}
                                            />
                                        </FieldGroup>
                                    </FieldGroup>
                                </FieldSet>

                                <FieldSet>
                                    <FieldLegend variant="label"><FieldTitle>{t("sections.cargo")}</FieldTitle></FieldLegend>
                                    <FieldGroup className="gap-4">
                                        <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                                            <SelectInput
                                                name="category"
                                                control={control}
                                                isPending={isPending || locked("details")}
                                                label={t("fields.category")}
                                                placeholder={t("fields.category-placeholder")}
                                            >
                                                {CATEGORIES.map((item) => (
                                                    <SelectItem key={item} value={item}>{tv(`category.${item}`)}</SelectItem>
                                                ))}
                                            </SelectInput>
                                            <WeightInput
                                                name="weight"
                                                control={control}
                                                isPending={isPending || locked("details")}
                                                disabled={isPending || locked("details")}
                                                label={t("fields.weight")}
                                                placeholder={t("fields.weight-placeholder")}
                                                value={weightUnit}
                                                setValue={(value: (typeof WEIGHT_UNIT)[number]) => setValue("weightUnit", value, { shouldDirty: true })}
                                            />
                                        </FieldGroup>
                                        <TextAreaInput
                                            name="cargoDescription"
                                            control={control}
                                            isPending={isPending || locked("details")}
                                            label={t("fields.cargo")}
                                            placeholder={t("fields.cargo-placeholder")}
                                        />
                                    </FieldGroup>
                                </FieldSet>

                                {/* A shipper's loads are for itself */}
                                {carrier && (
                                    <FieldSet>
                                        <FieldLegend variant="label"><FieldTitle>{t("sections.client")}</FieldTitle></FieldLegend>
                                        <FieldGroup className="gap-4">
                                            <SelectInput
                                                name="clientOrgId"
                                                control={control}
                                                isPending={isPending || locked("client")}
                                                label={t("fields.client")}
                                                description={t("fields.client-hint")}
                                            >
                                                <SelectItem value={NONE}>{t("fields.client-none")}</SelectItem>
                                                {partners.map((row) => (
                                                    <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                                                ))}
                                                <SelectItem value={TYPED}>{t("fields.client-typed")}</SelectItem>
                                            </SelectInput>
                                            {clientOrgId === TYPED && (
                                                <TextInput
                                                    name="clientName"
                                                    control={control}
                                                    isPending={isPending || locked("client")}
                                                    label={t("fields.client-name")}
                                                />
                                            )}
                                            <TextInput
                                                name="clientReference"
                                                control={control}
                                                isPending={isPending || locked("client")}
                                                label={t("fields.client-reference")}
                                                placeholder={t("fields.client-reference-placeholder")}
                                            />
                                            <LegFields
                                                prefix="sell"
                                                control={control}
                                                locked={isPending || locked("sellAmounts")}
                                                title={t("fields.sell")}
                                                hint={t("fields.sell-hint")}
                                            />
                                        </FieldGroup>
                                    </FieldSet>
                                )}

                                {partner && (
                                    <FieldSet>
                                        <FieldLegend variant="label"><FieldTitle>{t("sections.partner")}</FieldTitle></FieldLegend>
                                        <FieldGroup className="gap-4">
                                            <SelectInput
                                                name="carrierOrgId"
                                                control={control}
                                                isPending={isPending || locked("buy")}
                                                label={t("fields.partner")}
                                                placeholder={t("fields.partner-placeholder")}
                                                description={partnerOnPortal ? t("fields.partner-on-portal") : t("fields.partner-hint")}
                                            >
                                                <SelectItem value={NONE}>{t("fields.partner-none")}</SelectItem>
                                                {carriers.map((row) => (
                                                    <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                                                ))}
                                                <SelectItem value={TYPED}>{t("off-portal-partner")}</SelectItem>
                                            </SelectInput>
                                            {carrierOrgId === TYPED && (
                                                <TextInput
                                                    name="carrierName"
                                                    control={control}
                                                    isPending={isPending || locked("buy")}
                                                    label={t("fields.partner-name")}
                                                />
                                            )}
                                            <LegFields
                                                prefix="buy"
                                                control={control}
                                                locked={isPending || locked("buy")}
                                                title={t("fields.buy")}
                                                hint={t("fields.buy-hint")}
                                            />
                                        </FieldGroup>
                                    </FieldSet>
                                )}

                                {asksRig && (
                                    <RigFields
                                        control={control}
                                        options={options}
                                        ownFleet={!partner}
                                        driverId={driverId}
                                        truckId={truckId}
                                        country={country}
                                        setCountry={(value) => setValue("country", value, { shouldDirty: true, shouldValidate: true })}
                                        locked={isPending || locked("rig")}
                                    />
                                )}

                                {!editing && !partnerOnPortal && (
                                    <FieldSet>
                                        <FieldLegend variant="label"><FieldTitle>{t("sections.status")}</FieldTitle></FieldLegend>
                                        <SelectInput
                                            name="status"
                                            control={control}
                                            isPending={isPending}
                                            label={t("fields.status")}
                                            description={status === "at-loading" ? t("fields.status-at-loading-hint") : t("fields.status-hint")}
                                        >
                                            {CREATE_STATUS.map((value) => (
                                                <SelectItem key={value} value={value}>
                                                    {t(`statuses.${partner ? "order" : "trip"}.${value}`)}
                                                </SelectItem>
                                            ))}
                                        </SelectInput>
                                    </FieldSet>
                                )}

                                <FieldSet>
                                    <FieldLegend variant="label"><FieldTitle>{t("sections.paperwork")}</FieldTitle></FieldLegend>
                                    <FieldGroup className="gap-4">
                                        {editing && (
                                            <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                                                {carrier && (
                                                    <TextInput
                                                        name="sellInvoiceNumber"
                                                        control={control}
                                                        isPending={isPending || locked("paperwork")}
                                                        label={t("fields.sell-invoice")}
                                                    />
                                                )}
                                                {partner && (
                                                    <TextInput
                                                        name="buyInvoiceNumber"
                                                        control={control}
                                                        isPending={isPending || locked("paperwork")}
                                                        label={t("fields.buy-invoice")}
                                                    />
                                                )}
                                            </FieldGroup>
                                        )}
                                        <TextAreaInput
                                            name="notes"
                                            control={control}
                                            isPending={isPending || locked("paperwork")}
                                            label={t("fields.notes")}
                                            placeholder={t("fields.notes-placeholder")}
                                            description={t("fields.notes-hint")}
                                        />
                                    </FieldGroup>
                                </FieldSet>

                                {error && (
                                    <Alert variant="destructive">
                                        <AlertDescription>{tl(`errors.${error}`)}</AlertDescription>
                                    </Alert>
                                )}
                            </FieldGroup>
                        </form>
                    </div>

                    <div className="flex items-center gap-2 border-t px-6 py-4">
                        <Button type="submit" form="load-form" disabled={isPending}>
                            {isPending
                                ? <IconLoader2 className="size-4 animate-spin" stroke={1.5} />
                                : <IconDeviceFloppy className="size-4" stroke={1.5} />}
                            {isPending ? t("saving") : editing ? t("save") : t("file")}
                        </Button>
                        <Button type="button" variant="outline" disabled={isPending} onClick={dismiss}>
                            <IconCancel className="size-4" stroke={1.5} />
                            {t("cancel")}
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

/**
 * One leg of the deal: one VAT-inclusive total, its currency, and the
 * regime — only "normal" charges VAT, and the split is derived from it on
 * the way out rather than typed.
 */
function LegFields({
    prefix,
    control,
    locked,
    title,
    hint,
}: {
    prefix: "sell" | "buy"
    control: Control<LoadForm>
    locked: boolean
    title: string
    hint: string
}) {
    const t = useTranslations("App.loads.form")
    const tv = useTranslations("App.orders")

    return (
        <div className="bg-muted/30 flex flex-col gap-3 rounded-2xl px-4 py-3.5">
            <div className="flex flex-col">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-muted-foreground text-xs">{hint}</span>
            </div>
            <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]">
                <DecimalInput
                    name={prefix === "sell" ? "sellTotal" : "buyTotal"}
                    control={control}
                    isPending={locked}
                    label={t("fields.total")}
                    placeholder={t("fields.total-placeholder")}
                />
                <SelectInput name={prefix === "sell" ? "sellCurrency" : "buyCurrency"} control={control} isPending={locked} label={t("fields.currency")}>
                    {CURRENCY.map((item) => (
                        <SelectItem key={item} value={item}>{tv(`currency.${item}`)}</SelectItem>
                    ))}
                </SelectInput>
                <SelectInput
                    name={prefix === "sell" ? "sellFiscalRegime" : "buyFiscalRegime"}
                    control={control}
                    isPending={locked}
                    label={t("fields.fiscal-regime")}
                    placeholder={t("fields.fiscal-regime-placeholder")}
                >
                    {FISCAL_REGIME.map((item) => (
                        <SelectItem key={item} value={item}>{tv(`fiscalRegime.${item}`)}</SelectItem>
                    ))}
                </SelectInput>
            </FieldGroup>
        </div>
    )
}

/**
 * Who drives and on what. The company's own trucks and drivers are picked
 * from its fleet — the tracking then asks the phone on file — and anybody
 * else is typed in: a partner off the portal, a driver not registered yet.
 */
function RigFields({
    control,
    options,
    ownFleet,
    driverId,
    truckId,
    country,
    setCountry,
    locked,
}: {
    control: Control<LoadForm>
    options: LoadFormOptions | undefined
    ownFleet: boolean
    driverId: string
    truckId: string
    country: string
    setCountry: (value: string) => void
    locked: boolean
}) {
    const t = useTranslations("App.loads.form")

    // A partner's driver is never one of the company's own
    const drivers = ownFleet ? options?.drivers ?? [] : []
    const trucks = ownFleet ? options?.trucks ?? [] : []

    return (
        <FieldSet>
            <FieldLegend variant="label"><FieldTitle>{t("sections.rig")}</FieldTitle></FieldLegend>
            <FieldGroup className="gap-4">
                <SelectInput
                    name="driverId"
                    control={control}
                    isPending={locked}
                    label={t("fields.driver")}
                    description={t("fields.driver-hint")}
                >
                    <SelectItem value={NONE}>{t("fields.driver-none")}</SelectItem>
                    {drivers.map((row) => (
                        <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                    ))}
                    <SelectItem value={TYPED}>{t("fields.driver-typed")}</SelectItem>
                </SelectInput>

                {driverId === TYPED && (
                    <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                        <TextInput name="driverName" control={control} isPending={locked} label={t("fields.driver-name")} />
                        {/* No `placeholder`: PhoneInput supplies its own from the country */}
                        <PhoneInput
                            name="phoneNumber"
                            control={control}
                            isPending={locked}
                            country={country}
                            setCountry={setCountry}
                            label={t("fields.phone")}
                        />
                    </FieldGroup>
                )}

                <SelectInput name="truckId" control={control} isPending={locked} label={t("fields.truck")}>
                    <SelectItem value={NONE}>{t("fields.truck-none")}</SelectItem>
                    {trucks.map((row) => (
                        <SelectItem key={row.id} value={row.id}>{row.plate}</SelectItem>
                    ))}
                    <SelectItem value={TYPED}>{t("fields.truck-typed")}</SelectItem>
                </SelectInput>

                {truckId === TYPED && (
                    <TextInput
                        name="truckPlate"
                        control={control}
                        isPending={locked}
                        label={t("fields.plate")}
                        placeholder={t("fields.plate-placeholder")}
                    />
                )}
            </FieldGroup>
        </FieldSet>
    )
}
