"use client"

import { useEffect, useMemo, useRef } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useQuery } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconCancel, IconLoader2, IconSend } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { CURRENCY, FISCAL_REGIME, LOADING_BAY, ROUTE_TYPE, WEIGHT_UNIT } from "@workspace/db/types"

import { Button } from "@workspace/ui/components/button"
import { SelectItem } from "@workspace/ui/components/select"
import { SelectInput } from "@workspace/ui/inputs/select"
import { LocationInput } from "@workspace/ui/inputs/location"
import { DateInput } from "@workspace/ui/inputs/date"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { WeightInput } from "@workspace/ui/inputs/weight"
import { TextAreaInput } from "@workspace/ui/inputs/textarea"
import { CheckboxInput } from "@workspace/ui/inputs/checkbox"
import { FieldGroup, FieldLegend, FieldSet, FieldTitle } from "@workspace/ui/components/field"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import { useTRPC } from "@/backend/api/client"
import { useMoney } from "@/frontend/pages/quotes/sections/badges"
import { useQuoteMutations } from "@/frontend/pages/quotes/hooks/use-quote-mutations"
import type { Currency } from "@/frontend/pages/quotes/types"
import {
    CreateQuoteSchema,
    type CreateQuoteForm,
    type CreateQuoteFormInput,
} from "@/backend/schemas/quote"

// Mozambican VAT extracted from a VAT-inclusive total: total * (0.16/1.16).
// The same rule an order offer's own leg is derived by.
const VAT_RATE = 0.16 / 1.16

const DEFAULT_VALUES: CreateQuoteFormInput = {
    clientOrgId: "",
    origin: { address: "", placeId: "", country: "", state: "" },
    destination: { address: "", placeId: "", country: "", state: "" },
    loadingDate: undefined,
    route: "national",
    loadingBay: undefined,
    capacityWeight: "",
    capacityUnit: "ton",
    fiscalRegime: undefined as never,
    subtotal: "",
    vat: "",
    total: "",
    currency: "MZN",
    includesGit: false,
    includesGps: false,
    notes: "",
    validUntil: undefined,
}

const amount = (value: unknown): number => {
    const parsed = typeof value === "number" ? value : Number(value ?? 0)
    return Number.isFinite(parsed) ? parsed : 0
}

/**
 * A carrier's standing quote: a lane, a price and how long the price holds,
 * offered to one connected client before any order exists.
 *
 * The client list is the tenant's own accepted client connections — there is
 * no search over strangers here, because a quote is a commitment to someone
 * the carrier already works with.
 */
export function NewQuoteSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations("App.quotes")
    const trpc = useTRPC()
    const money = useMoney()

    const { create } = useQuoteMutations()
    const isPending = create.isPending

    // The carrier's own clients: an accepted `client-carrier` connection is
    // the only thing that makes a quote deliverable, and the procedure checks
    // it again server-side
    const { data: clients, isPending: loadingClients } = useQuery({
        ...trpc.partners.list.queryOptions({
            relation: "client-carrier",
            status: "accepted",
            sort: "partner",
            dir: "asc",
            page: 1,
            pageSize: 100,
        }),
        enabled: open,
    })

    const FormSchema = useMemo(
        () => CreateQuoteSchema((field) => ({ error: t(`form.errors.${field}`) })),
        [t],
    )

    const form = useForm<CreateQuoteFormInput, unknown, CreateQuoteForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: DEFAULT_VALUES,
    })

    const { reset, setValue } = form

    // A reopened sheet starts clean rather than where it was left
    useEffect(() => {
        if (open) reset(DEFAULT_VALUES)
    }, [open, reset])

    // Re-entrancy guard: the derived writes below re-fire the subscription,
    // and without this the subtotal and total branches trigger each other
    const syncing = useRef(false)

    useEffect(() => {
        const unsubscribe = form.subscribe({
            formState: { values: true },
            callback: ({ values, name }) => {
                if (syncing.current) return

                const round = (value: number) => value.toFixed(2)
                const has = (value: unknown) => value !== undefined && value !== null && value !== ""

                const write = (apply: () => void) => {
                    syncing.current = true
                    apply()
                    syncing.current = false
                }

                // The quoted price is VAT-inclusive. A carrier on the normal
                // regime charges VAT inside it; a simplified regime and "n/a"
                // charge none, so a change of regime recomputes the split.
                const carriesVat = values.fiscalRegime === "normal"

                if ((name === "subtotal" || name === "fiscalRegime") && has(values.subtotal)) {
                    const subtotal = amount(values.subtotal)
                    const vat = carriesVat ? subtotal * 0.16 : 0

                    write(() => {
                        setValue("vat", round(vat))
                        setValue("total", round(subtotal + vat))
                    })
                }

                if (name === "total" && has(values.total)) {
                    const total = amount(values.total)
                    const vat = carriesVat ? total * VAT_RATE : 0

                    write(() => {
                        setValue("vat", round(vat))
                        setValue("subtotal", round(total - vat))
                    })
                }

                // Two endpoints in the same country is a national trip; across
                // the border it is regional. Still editable afterwards.
                if (name === "origin.placeId" || name === "destination.placeId") {
                    const from = values.origin?.country
                    const to = values.destination?.country

                    if (from && to) {
                        write(() => setValue("route", from === to ? "national" : "regional"))
                    }
                }
            },
        })

        return unsubscribe
    }, [form, setValue])

    const capacityUnit = useWatch({ control: form.control, name: "capacityUnit" })
    const currency = useWatch({ control: form.control, name: "currency" })
    const total = useWatch({ control: form.control, name: "total" })

    function onSubmit(values: CreateQuoteForm) {
        create.mutate(values, { onSuccess: () => onOpenChange(false) })
    }

    return (
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
                        id="new-quote-form"
                        onSubmit={(event) => {
                            event.stopPropagation()
                            void form.handleSubmit(onSubmit)(event)
                        }}
                    >
                        <FieldGroup className="gap-6">
                            <FieldSet>
                                <FieldLegend variant="label">
                                    <FieldTitle>{t("add.client")}</FieldTitle>
                                </FieldLegend>

                                <FieldGroup className="gap-4">
                                    <SelectInput
                                        name="clientOrgId"
                                        control={form.control}
                                        isPending={isPending || loadingClients}
                                        label={t("add.fields.client.label")}
                                        placeholder={t("add.fields.client.placeholder")}
                                        description={
                                            clients && clients.items.length === 0
                                                ? t("add.fields.client.empty")
                                                : t("add.fields.client.description")
                                        }
                                    >
                                        {(clients?.items ?? []).map((row) => (
                                            <SelectItem key={row.partner.id} value={row.partner.id}>
                                                {row.partner.name}
                                            </SelectItem>
                                        ))}
                                    </SelectInput>
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

                                    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                                        <SelectInput
                                            name="route"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.route.label")}
                                            placeholder={t("add.fields.route.placeholder")}
                                        >
                                            {ROUTE_TYPE.map((value) => (
                                                <SelectItem key={value} value={value}>{t(`route.${value}`)}</SelectItem>
                                            ))}
                                        </SelectInput>

                                        <DateInput
                                            name="loadingDate"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.loadingDate.label")}
                                            placeholder={t("add.fields.loadingDate.placeholder")}
                                        />
                                    </div>
                                </FieldGroup>
                            </FieldSet>

                            <FieldSet>
                                <FieldLegend variant="label">
                                    <FieldTitle>{t("add.capacity")}</FieldTitle>
                                </FieldLegend>

                                <FieldGroup className="gap-4">
                                    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                                        <SelectInput
                                            name="loadingBay"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.bay.label")}
                                            placeholder={t("add.fields.bay.placeholder")}
                                        >
                                            {LOADING_BAY.map((value) => (
                                                <SelectItem key={value} value={value}>{t(`bay.${value}`)}</SelectItem>
                                            ))}
                                        </SelectInput>

                                        <WeightInput
                                            name="capacityWeight"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.capacity.label")}
                                            placeholder={t("add.fields.capacity.placeholder")}
                                            value={(capacityUnit ?? "ton") as (typeof WEIGHT_UNIT)[number]}
                                            setValue={(value) => setValue("capacityUnit", value)}
                                        />
                                    </div>
                                </FieldGroup>
                            </FieldSet>

                            <FieldSet>
                                <FieldLegend variant="label">
                                    <FieldTitle>{t("add.price")}</FieldTitle>
                                </FieldLegend>

                                <FieldGroup className="gap-4">
                                    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                                        <SelectInput
                                            name="fiscalRegime"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.regime.label")}
                                            placeholder={t("add.fields.regime.placeholder")}
                                        >
                                            {FISCAL_REGIME.map((value) => (
                                                <SelectItem key={value} value={value}>{t(`regime.${value}`)}</SelectItem>
                                            ))}
                                        </SelectInput>

                                        <SelectInput
                                            name="currency"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.currency.label")}
                                            placeholder={t("add.fields.currency.placeholder")}
                                        >
                                            {CURRENCY.map((value) => (
                                                <SelectItem key={value} value={value}>{value}</SelectItem>
                                            ))}
                                        </SelectInput>

                                        <DecimalInput
                                            name="subtotal"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.subtotal.label")}
                                            placeholder={t("add.fields.subtotal.placeholder")}
                                        />

                                        <DecimalInput
                                            name="vat"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.vat.label")}
                                            placeholder={t("add.fields.vat.placeholder")}
                                        />

                                        <DecimalInput
                                            name="total"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("add.fields.total.label")}
                                            placeholder={t("add.fields.total.placeholder")}
                                            description={t("add.fields.total.description")}
                                        />
                                    </div>

                                    {/* Appload adds nothing to a portal quote, so the
                                        client sees exactly this number */}
                                    <div className="bg-muted/40 flex items-baseline justify-between gap-4 rounded-xl px-4 py-3">
                                        <span className="text-muted-foreground text-[13px]">{t("add.client-price")}</span>
                                        <span className="text-sm font-semibold tabular-nums">
                                            {money(amount(total), (currency ?? "MZN") as Currency)}
                                        </span>
                                    </div>

                                    <CheckboxInput
                                        name="includesGit"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("add.fields.git.label")}
                                        description={t("add.fields.git.description")}
                                    />

                                    <CheckboxInput
                                        name="includesGps"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("add.fields.gps.label")}
                                        description={t("add.fields.gps.description")}
                                    />
                                </FieldGroup>
                            </FieldSet>

                            <FieldSet>
                                <FieldLegend variant="label">
                                    <FieldTitle>{t("add.terms")}</FieldTitle>
                                </FieldLegend>

                                <FieldGroup className="gap-4">
                                    <DateInput
                                        name="validUntil"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("add.fields.validUntil.label")}
                                        placeholder={t("add.fields.validUntil.placeholder")}
                                        description={t("add.fields.validUntil.description")}
                                    />

                                    <TextAreaInput
                                        name="notes"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("add.fields.notes.label")}
                                        placeholder={t("add.fields.notes.placeholder")}
                                    />
                                </FieldGroup>
                            </FieldSet>
                        </FieldGroup>
                    </form>
                </div>

                <div className="flex items-center gap-2 border-t px-6 py-4">
                    <Button type="submit" form="new-quote-form" disabled={isPending}>
                        {isPending
                            ? <IconLoader2 className="size-4 animate-spin" stroke={1.5} />
                            : <IconSend className="size-4" stroke={1.5} />}
                        {isPending ? t("add.actions.sending") : t("add.actions.send")}
                    </Button>
                    <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
                        <IconCancel className="size-4" stroke={1.5} />
                        {t("actions.cancel")}
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    )
}
