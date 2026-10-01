"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm, useWatch, type DefaultValues } from "react-hook-form"
import { useQuery } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { IconCalendarTime, IconCancel, IconDeviceFloppy, IconLoader2, IconTruck, IconWeight } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { CURRENCY, FISCAL_REGIME, isApploadOrg } from "@workspace/db/types"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { SelectItem } from "@workspace/ui/components/select"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { FieldGroup, FieldLegend, FieldSet, FieldTitle } from "@workspace/ui/components/field"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"
import { CheckboxInput } from "@workspace/ui/inputs/checkbox"
import { DateInput } from "@workspace/ui/inputs/date"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { LocationInput } from "@workspace/ui/inputs/location"
import { SelectInput } from "@workspace/ui/inputs/select"
import { TextAreaInput } from "@workspace/ui/inputs/textarea"
import { TextInput } from "@workspace/ui/inputs/text"

import { useRouter } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { CONTRACT_BASIS, type ContractInput } from "@/backend/schemas/contract"
import { NONE, TYPED } from "@/backend/schemas/movement"
import { contractErrorKey, type ContractErrorCode } from "@/frontend/pages/contracts/lib/errors"
import { EMPTY_PRICE, PriceFormSchema, fromPriceModel, toPriceModel } from "@/frontend/pages/contracts/lib/price-form"
import { useContractMutations } from "@/frontend/pages/contracts/hooks/use-contract-mutations"
import { PriceModelFields } from "@/frontend/pages/contracts/sections/price-model-fields"
import type { ContractBasis, ContractDetail } from "@/frontend/pages/contracts/types"

export type ContractSheetMode = { kind: "create" } | { kind: "edit"; contract: ContractDetail }

// The calendar opens at the start of last year, as the load sheet's does:
// a contract is often filed after it began
const EARLIEST_DATE = new Date(new Date().getFullYear() - 1, 0, 1)

const EMPTY_LOCATION = { address: "", placeId: "", country: "", state: "" }

const BASIS_ICON = { trips: IconTruck, weight: IconWeight, days: IconCalendarTime } as const
// Rental (days) is parked: it is not an order consumed by trucks and gets its
// own door later. An existing rental still reads its basis when edited
const CREATE_BASES: readonly ContractBasis[] = ["trips", "weight"]
const UNIT_KEY = { trips: "trip", weight: "ton", days: "day" } as const

type MessageField = "address" | "amount" | "name" | "date" | "period" | "quantity"
type Message = (field: MessageField) => { error: string }

const location = z.object({ address: z.string(), placeId: z.string(), country: z.string(), state: z.string() })

/** The form's own rules; the doors check the rest (a connected client, a model that fits the basis). */
function ContractFormSchema(msg: Message) {
    return z
        .object({
            basis: z.enum(CONTRACT_BASIS),
            clientOrgId: z.string(),
            clientName: z.string().trim().max(120),
            clientReference: z.string().trim().max(60),
            anyLane: z.boolean(),
            origin: location,
            destination: location,
            startsOn: z.date(msg("date")),
            noEnd: z.boolean(),
            endsOn: z.date(msg("date")).optional(),
            openEnded: z.boolean(),
            committedQty: z.string(),
            currency: z.enum(CURRENCY),
            fiscalRegime: z.enum(FISCAL_REGIME).optional(),
            sellPrice: PriceFormSchema(msg("amount").error),
            notes: z.string().trim().max(2000),
        })
        // An open-ended contract has no quantity to check
        .refine((data) => data.openEnded || (Number(data.committedQty) > 0 && Number(data.committedQty) <= 1e9), { ...msg("quantity"), path: ["committedQty"] })
        .refine((data) => data.clientOrgId !== TYPED || data.clientName.length > 0, { ...msg("name"), path: ["clientName"] })
        .refine((data) => data.anyLane || data.origin.placeId.length > 0, { ...msg("address"), path: ["origin.address"] })
        .refine((data) => data.anyLane || data.destination.placeId.length > 0, { ...msg("address"), path: ["destination.address"] })
        // No end date is a choice, not a blank
        .refine((data) => data.noEnd || data.endsOn !== undefined, { ...msg("date"), path: ["endsOn"] })
        .refine((data) => data.noEnd || data.endsOn === undefined || data.endsOn >= data.startsOn, { ...msg("period"), path: ["endsOn"] })
}

type ContractForm = z.infer<ReturnType<typeof ContractFormSchema>>

// Calendar days travel as "YYYY-MM-DD" and are read and written in local
// time: `toISOString` would shift a midnight pick to the day before
const isoDay = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

const fromIsoDay = (value: string) => {
    const [year, month, day] = value.split("-").map(Number)
    return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

function defaultsFor(mode: ContractSheetMode): DefaultValues<ContractForm> {
    if (mode.kind === "create") {
        return {
            basis: "trips",
            clientOrgId: NONE,
            clientName: "",
            clientReference: "",
            anyLane: false,
            origin: EMPTY_LOCATION,
            destination: EMPTY_LOCATION,
            startsOn: undefined,
            noEnd: false,
            endsOn: undefined,
            openEnded: false,
            committedQty: "",
            currency: "MZN",
            fiscalRegime: undefined,
            sellPrice: EMPTY_PRICE,
            notes: "",
        }
    }

    const { contract } = mode

    return {
        basis: contract.basis,
        clientOrgId: contract.client?.id ?? (contract.client?.name ? TYPED : NONE),
        clientName: contract.client?.id ? "" : contract.client?.name ?? "",
        clientReference: contract.clientReference ?? "",
        anyLane: contract.origin === null,
        origin: contract.origin ?? EMPTY_LOCATION,
        destination: contract.destination ?? EMPTY_LOCATION,
        startsOn: fromIsoDay(contract.startsOn),
        noEnd: contract.endsOn === null,
        endsOn: contract.endsOn === null ? undefined : fromIsoDay(contract.endsOn),
        openEnded: contract.committedQty === null,
        committedQty: contract.committedQty === null ? "" : String(contract.committedQty),
        currency: contract.currency,
        fiscalRegime: contract.fiscalRegime ?? undefined,
        sellPrice: fromPriceModel(contract.sellPrice),
        notes: contract.notes ?? "",
    }
}

/**
 * Filing a contract, or correcting one. What the company is decides what it
 * is asked, as on the load sheet: a transporter names the client and what it
 * charges; a shipper's contracts are its own, so it names neither. The basis
 * — what the contract counts — is picked once and fixed from then on, since
 * every share is read in it.
 */
export function ContractSheet({
    open,
    onOpenChange,
    mode,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    mode: ContractSheetMode
}) {
    const t = useTranslations("App.contracts")
    const tf = useTranslations("App.loads.form")
    const tv = useTranslations("App.orders")
    const trpc = useTRPC()
    const router = useRouter()

    const { create, update } = useContractMutations()
    const isPending = create.isPending || update.isPending

    const [error, setError] = useState<ContractErrorCode | null>(null)

    const { data: session } = useQuery(trpc.me.session.queryOptions())
    const { data: options } = useQuery({ ...trpc.movements.formOptions.queryOptions(), enabled: open })

    const FormSchema = useMemo(
        () => ContractFormSchema((field) => ({
            error: field === "period" ? t("errors.PERIOD_INVERTED")
                : field === "quantity" ? t("errors.QUANTITY_REQUIRED")
                    : field === "date" ? t("form.errors.date")
                        : tf(`errors.${field}`),
        })),
        [t, tf],
    )

    const form = useForm<ContractForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: defaultsFor(mode),
    })

    const { control, reset, setValue } = form

    // A reopened sheet starts from the contract as it is now, not where it was left
    const modeKey = mode.kind === "create" ? "create" : `edit:${mode.contract.id}:${mode.contract.version}`
    useEffect(() => {
        if (open) reset(defaultsFor(mode))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, modeKey, reset])

    // An error belongs to the attempt it came from; closing the sheet drops it
    const dismiss = () => {
        setError(null)
        onOpenChange(false)
    }

    const [basis, clientOrgId, anyLane, currency, openEnded, noEnd] = useWatch({ control, name: ["basis", "clientOrgId", "anyLane", "currency", "openEnded", "noEnd"] })

    const editing = mode.kind === "edit"
    const carrier = session?.organization.type === "carrier"
    // A price needs somebody to charge: a transporter always has a client
    const asksPrice = carrier || clientOrgId !== NONE

    // Appload moves loads; it never orders them, and the doors refuse it as a client
    const clients = (options?.partners ?? []).filter((row) => !isApploadOrg(row.id))

    // A price block out of sight is not sent, so it must not fail validation either
    useEffect(() => {
        if (!asksPrice) setValue("sellPrice", EMPTY_PRICE)
    }, [asksPrice, setValue])

    function onSubmit(values: ContractForm) {
        setError(null)

        const input: ContractInput = {
            basis: values.basis,
            ...(carrier && values.clientOrgId === TYPED && { clientName: values.clientName }),
            ...(carrier && values.clientOrgId !== TYPED && values.clientOrgId !== NONE && { clientOrgId: values.clientOrgId }),
            clientReference: carrier ? values.clientReference || null : null,
            origin: values.anyLane ? null : values.origin,
            destination: values.anyLane ? null : values.destination,
            startsOn: isoDay(values.startsOn),
            endsOn: values.noEnd || !values.endsOn ? null : isoDay(values.endsOn),
            committedQty: values.openEnded ? null : Number(values.committedQty),
            weightUnit: values.basis === "weight" ? "ton" : null,
            currency: values.currency,
            fiscalRegime: values.fiscalRegime ?? null,
            sellPrice: asksPrice ? toPriceModel(values.sellPrice) : null,
            notes: values.notes || null,
        }

        if (mode.kind === "edit") {
            update.mutate({ ...input, id: mode.contract.id, expectedVersion: mode.contract.version }, {
                onSuccess: () => onOpenChange(false),
                onError: (failure) => setError(contractErrorKey(failure)),
            })
            return
        }

        create.mutate(input, {
            onSuccess: ({ id }) => {
                onOpenChange(false)
                router.push({ pathname: "/orders/multi/[orderId]", params: { orderId: id } })
            },
            onError: (failure) => setError(contractErrorKey(failure)),
        })
    }

    return (
        <Sheet open={open} onOpenChange={(next) => { if (!isPending) { if (next) onOpenChange(true); else dismiss() } }}>
            <SheetContent
                side="right"
                className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-[680px]"
            >
                <SheetHeader className="border-b">
                    <SheetTitle>{editing ? t("form.edit-title", { ref: mode.contract.ref }) : t("form.new-title")}</SheetTitle>
                    <SheetDescription>{t("form.description")}</SheetDescription>
                </SheetHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                    <form
                        id="contract-form"
                        onSubmit={(event) => {
                            // The sheet can open over a page's own form; keep
                            // this submit from bubbling into it
                            event.stopPropagation()
                            void form.handleSubmit(onSubmit)(event)
                        }}
                    >
                        <FieldGroup className="gap-7">
                            <FieldSet>
                                <FieldLegend variant="label"><FieldTitle>{t("form.sections.basis")}</FieldTitle></FieldLegend>
                                <FieldGroup className="gap-4">
                                    {editing ? (
                                        // What a contract counts is fixed once it exists
                                        <p className="text-sm">
                                            <span className="font-medium">{t(`basis.${basis}`)}</span>
                                            <span className="text-muted-foreground"> — {t(`basis-hint.${basis}`)}</span>
                                        </p>
                                    ) : (
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("form.sections.basis")}>
                                            {CREATE_BASES.map((value) => {
                                                const active = basis === value
                                                const BasisIcon = BASIS_ICON[value]

                                                return (
                                                    <button
                                                        key={value}
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={active}
                                                        disabled={isPending}
                                                        onClick={() => {
                                                            setValue("basis", value, { shouldDirty: true })
                                                            // The models on offer change with the basis
                                                            setValue("sellPrice", EMPTY_PRICE)
                                                        }}
                                                        className={cn(
                                                            "flex cursor-pointer items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-left text-sm transition-colors disabled:cursor-default disabled:opacity-50",
                                                            active ? "border-primary bg-primary/5" : "hover:bg-muted",
                                                        )}
                                                    >
                                                        <BasisIcon className="mt-0.5 size-4 shrink-0" stroke={1.5} />
                                                        <span className="min-w-0">
                                                            <span className="block font-medium">{t(`basis.${value}`)}</span>
                                                            <span className="text-muted-foreground block text-xs">{t(`basis-hint.${value}`)}</span>
                                                        </span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}
                                    <CheckboxInput
                                        name="openEnded"
                                        control={control}
                                        isPending={isPending}
                                        label={t("values.open")}
                                        description={t("values.open-hint")}
                                    />
                                    {!openEnded && (
                                        <DecimalInput
                                            name="committedQty"
                                            control={control}
                                            isPending={isPending}
                                            label={`${t("form.fields.committed-qty")} (${t(`form.units.${UNIT_KEY[basis as ContractBasis]}`)})`}
                                            placeholder="0"
                                        />
                                    )}
                                </FieldGroup>
                            </FieldSet>

                            {/* A shipper's contracts are for itself */}
                            {carrier && (
                                <FieldSet>
                                    <FieldLegend variant="label"><FieldTitle>{t("form.sections.client")}</FieldTitle></FieldLegend>
                                    <FieldGroup className="gap-4">
                                        <SelectInput name="clientOrgId" control={control} isPending={isPending} label={t("form.fields.client")}>
                                            <SelectItem value={NONE}>{t("form.picker.none")}</SelectItem>
                                            {clients.map((row) => (
                                                <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                                            ))}
                                            <SelectItem value={TYPED}>{t("form.picker.typed")}</SelectItem>
                                        </SelectInput>
                                        {clientOrgId === TYPED && (
                                            <TextInput name="clientName" control={control} isPending={isPending} label={t("form.fields.client-name")} />
                                        )}
                                        <TextInput name="clientReference" control={control} isPending={isPending} label={t("form.fields.client-reference")} />
                                    </FieldGroup>
                                </FieldSet>
                            )}

                            <FieldSet>
                                <FieldLegend variant="label"><FieldTitle>{t("form.sections.lane")}</FieldTitle></FieldLegend>
                                <FieldGroup className="gap-4">
                                    <CheckboxInput name="anyLane" control={control} isPending={isPending} label={t("form.fields.any-lane")} />
                                    {!anyLane && (
                                        <>
                                            <LocationInput
                                                name="origin.address"
                                                control={control}
                                                isPending={isPending}
                                                label={t("form.fields.origin")}
                                                placeholder={tf("fields.origin-placeholder")}
                                                setPlaceId={(value) => setValue("origin.placeId", value, { shouldDirty: true })}
                                                setCountry={(value) => setValue("origin.country", value, { shouldDirty: true })}
                                                setState={(value) => setValue("origin.state", value, { shouldDirty: true })}
                                            />
                                            <LocationInput
                                                name="destination.address"
                                                control={control}
                                                isPending={isPending}
                                                label={t("form.fields.destination")}
                                                placeholder={tf("fields.destination-placeholder")}
                                                setPlaceId={(value) => setValue("destination.placeId", value, { shouldDirty: true })}
                                                setCountry={(value) => setValue("destination.country", value, { shouldDirty: true })}
                                                setState={(value) => setValue("destination.state", value, { shouldDirty: true })}
                                            />
                                        </>
                                    )}
                                </FieldGroup>
                            </FieldSet>

                            <FieldSet>
                                <FieldLegend variant="label"><FieldTitle>{t("form.sections.period")}</FieldTitle></FieldLegend>
                                <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                                    <DateInput
                                        name="startsOn"
                                        control={control}
                                        isPending={isPending}
                                        value={EARLIEST_DATE}
                                        label={t("form.fields.starts-on")}
                                        placeholder={tf("fields.date-placeholder")}
                                    />
                                    {!noEnd && (
                                        <DateInput
                                            name="endsOn"
                                            control={control}
                                            isPending={isPending}
                                            value={EARLIEST_DATE}
                                            label={t("form.fields.ends-on")}
                                            placeholder={tf("fields.date-placeholder")}
                                        />
                                    )}
                                </FieldGroup>
                                <CheckboxInput
                                    name="noEnd"
                                    control={control}
                                    isPending={isPending}
                                    label={t("form.fields.no-end")}
                                    description={t("form.fields.no-end-hint")}
                                />
                            </FieldSet>

                            <FieldSet>
                                <FieldLegend variant="label"><FieldTitle>{t("form.sections.price")}</FieldTitle></FieldLegend>
                                <FieldGroup className="gap-4">
                                    <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                                        <SelectInput name="currency" control={control} isPending={isPending} label={t("form.fields.currency")}>
                                            {CURRENCY.map((item) => (
                                                <SelectItem key={item} value={item}>{tv(`currency.${item}`)}</SelectItem>
                                            ))}
                                        </SelectInput>
                                        <SelectInput
                                            name="fiscalRegime"
                                            control={control}
                                            isPending={isPending}
                                            label={t("form.fields.fiscal-regime")}
                                            placeholder={tf("fields.fiscal-regime-placeholder")}
                                        >
                                            {FISCAL_REGIME.map((item) => (
                                                <SelectItem key={item} value={item}>{tv(`fiscalRegime.${item}`)}</SelectItem>
                                            ))}
                                        </SelectInput>
                                    </FieldGroup>
                                    {asksPrice && (
                                        <PriceModelFields
                                            control={control}
                                            name="sellPrice"
                                            basis={basis as ContractBasis}
                                            currency={currency}
                                            disabled={isPending}
                                            label={t("form.fields.sell-price")}
                                        />
                                    )}
                                </FieldGroup>
                            </FieldSet>

                            <FieldSet>
                                <FieldLegend variant="label"><FieldTitle>{t("form.sections.notes")}</FieldTitle></FieldLegend>
                                <TextAreaInput name="notes" control={control} isPending={isPending} label={t("form.fields.notes")} />
                            </FieldSet>

                            {error && (
                                <Alert variant="destructive">
                                    <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                                </Alert>
                            )}
                        </FieldGroup>
                    </form>
                </div>

                <div className="flex items-center gap-2 border-t px-6 py-4">
                    <Button type="submit" form="contract-form" disabled={isPending}>
                        {isPending
                            ? <IconLoader2 className="size-4 animate-spin" stroke={1.5} />
                            : <IconDeviceFloppy className="size-4" stroke={1.5} />}
                        {isPending ? t("form.saving") : t("form.submit")}
                    </Button>
                    <Button type="button" variant="outline" disabled={isPending} onClick={dismiss}>
                        <IconCancel className="size-4" stroke={1.5} />
                        {t("form.cancel")}
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    )
}
