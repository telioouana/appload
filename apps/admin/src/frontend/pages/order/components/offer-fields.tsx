"use client"

import { Fragment, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconClock, IconMapPin, IconShieldCheck } from "@tabler/icons-react"
import type { Control, FieldValues, Path, PathValue, UseFormSetValue, UseFormWatch } from "react-hook-form"

import { useFormatter, useTranslations } from "@workspace/i18n"
import { CURRENCY, FISCAL_REGIME } from "@workspace/db/types"

import { cn } from "@workspace/ui/lib/utils"
import { SelectItem } from "@workspace/ui/components/select"
import { FieldGroup } from "@workspace/ui/components/field"
import { SelectInput } from "@workspace/ui/inputs/select"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { TextAreaInput } from "@workspace/ui/inputs/textarea"

import { useTRPC } from "@/backend/api/client"
import { priceOffer, VAT_RATE, type RouteKind } from "@/lib/orders/commission"
import { OrganizationInput } from "@/components/inputs/organization"

/** The eleven form fields one offer occupies, wherever its host form keeps them. */
export type OfferFieldNames<T extends FieldValues> = Record<
    "carrierId" | "carrierName" | "fiscalRegime" | "subtotal" | "vat" | "total" | "currency" | "commissionTotal" | "includesGit" | "includesGps" | "notes",
    Path<T>
>

/**
 * Where one offer's fields live in the host form. `prefix` is "" for a form
 * that holds a single offer (the offer dialog) and "offers.2." for one row
 * of the create form's field array.
 */
export function offerNames<T extends FieldValues>(prefix: string): OfferFieldNames<T> {
    const path = (field: string) => `${prefix}${field}` as Path<T>

    return {
        carrierId: path("carrierId"),
        carrierName: path("carrierName"),
        fiscalRegime: path("fiscalRegime"),
        subtotal: path("subtotal"),
        vat: path("vat"),
        total: path("total"),
        currency: path("currency"),
        commissionTotal: path("commissionTotal"),
        includesGit: path("includesGit"),
        includesGps: path("includesGps"),
        notes: path("notes"),
    }
}

const round = (value: number) => value.toFixed(2)

const hasValue = (value: unknown) => value !== undefined && value !== null && value !== ""

/**
 * The controls one carrier offer is written with: who would carry the load,
 * under which fiscal regime, for how much, what the price includes and any
 * free note. Shared by the create form's offer rows and the standalone offer
 * dialog so both write the same shape.
 *
 * The price is typed as the VAT-inclusive @total; VAT and subtotal are
 * derived from it here — the rule the carrier leg used to derive on the
 * create form — and shown disabled, because an offer is quoted as one number.
 */
export function OfferFields<
    TFieldValues extends FieldValues = FieldValues,
    TContext = unknown,
    TTransformedValues = TFieldValues,
>({
    control,
    names,
    isPending,
    watch,
    setValue,
    route,
    snapshot = true,
}: {
    control: Control<TFieldValues, TContext, TTransformedValues>
    names: OfferFieldNames<TFieldValues>
    isPending: boolean
    watch: UseFormWatch<TFieldValues>
    setValue: UseFormSetValue<TFieldValues>
    /** The order's route: national trips carry VAT on the client price, regional ones do not */
    route: RouteKind | undefined
    /** Off where the carrier's track record is not worth fetching */
    snapshot?: boolean
}) {
    const t = useTranslations("Admin.orders.offers")
    const f = useFormatter()
    const trpc = useTRPC()

    // An offer sits at a different path in every host form, so the names
    // arrive as opaque paths and the values they carry cannot be typed from
    // TFieldValues alone
    const write = (name: Path<TFieldValues>, value: unknown) =>
        setValue(name, value as PathValue<TFieldValues, Path<TFieldValues>>, { shouldDirty: true })

    const carrierId = watch(names.carrierId) as string | undefined
    const total = watch(names.total)
    const fiscalRegime = watch(names.fiscalRegime) as string | undefined
    const commissionTotal = watch(names.commissionTotal)
    const currency = watch(names.currency) as string | undefined

    // The offer priced as the operator types it — the same rule the server
    // stores, so the client price on screen is the client price that lands
    const regime = FISCAL_REGIME.find((item) => item === fiscalRegime)
    const quoted = Number(total)
    const cut = Number(commissionTotal)
    const pricing =
        hasValue(total) && hasValue(commissionTotal) && regime !== undefined && Number.isFinite(quoted) && Number.isFinite(cut)
            ? priceOffer({ carrierTotal: quoted, fiscalRegime: regime, commissionTotal: cut, route: route ?? "national" })
            : null

    const { vat: vatName, subtotal: subtotalName } = names

    // Skips the pass that only just loaded a stored offer: deriving there
    // would dirty a form nobody has touched yet
    const loaded = useRef(false)

    useEffect(() => {
        if (!loaded.current) {
            loaded.current = true
            return
        }

        if (!hasValue(total)) return

        const amount = Number(total)
        if (!Number.isFinite(amount)) return

        // Only the "normal" regime charges VAT, and the quoted total already
        // includes it: VAT = total * (0.16/1.16)
        const vat = fiscalRegime === "normal" ? amount * VAT_RATE : 0

        setValue(vatName, round(vat) as PathValue<TFieldValues, Path<TFieldValues>>, { shouldDirty: true })
        setValue(subtotalName, round(amount - vat) as PathValue<TFieldValues, Path<TFieldValues>>, { shouldDirty: true })
    }, [total, fiscalRegime, vatName, subtotalName, setValue])

    const { data: record } = useQuery({
        ...trpc.offers.carrierSnapshot.queryOptions({ carrierId: carrierId ?? "" }),
        enabled: snapshot && Boolean(carrierId),
    })

    const includes = [
        { name: names.includesGit, icon: IconShieldCheck, label: t("includes.git"), hint: t("form.includes.gitHint") },
        { name: names.includesGps, icon: IconMapPin, label: t("includes.gps"), hint: t("form.includes.gpsHint") },
    ]

    return (
        <FieldGroup>
            <div className="flex flex-col gap-1.5">
                <OrganizationInput
                    control={control}
                    name={names.carrierName}
                    isPending={isPending}
                    orgType="carrier"
                    label={t("fields.carrier")}
                    placeholder={t("form.carrier.placeholder")}
                    description={t("form.carrier.description")}
                    setOrgId={(id) => write(names.carrierId, id ?? "")}
                />

                {snapshot && (
                    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <IconClock className="size-3.5 shrink-0" stroke={1.5} />
                        {!carrierId || !record
                            ? <span className="text-muted-foreground/60">&mdash;</span>
                            : record.since
                                ? t("snapshot", {
                                    date: f.dateTime(record.since, { month: "short", year: "numeric" }),
                                    trips: record.trips,
                                })
                                : t("snapshotUnknown")}
                    </p>
                )}
            </div>

            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                <SelectInput
                    control={control}
                    name={names.fiscalRegime}
                    isPending={isPending}
                    label={t("fields.fiscalRegime")}
                    placeholder={t("form.fiscalRegime.placeholder")}
                >
                    {FISCAL_REGIME.map((item) => <SelectItem key={item} value={item}>{t(`form.fiscalRegime.options.${item}`)}</SelectItem>)}
                </SelectInput>

                <SelectInput
                    control={control}
                    name={names.currency}
                    isPending={isPending}
                    label={t("fields.currency")}
                    placeholder={t("form.currency.placeholder")}
                >
                    {CURRENCY.map((item) => <SelectItem key={item} value={item}>{t(`form.currency.options.${item}`)}</SelectItem>)}
                </SelectInput>
            </FieldGroup>

            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-3 items-start">
                <DecimalInput
                    control={control}
                    name={names.total}
                    isPending={isPending}
                    label={t("fields.total")}
                    placeholder={t("form.total.placeholder")}
                />

                <DecimalInput
                    control={control}
                    name={names.vat}
                    label={t("fields.vat")}
                    placeholder={t("form.vat.placeholder")}
                    isPending
                />

                <DecimalInput
                    control={control}
                    name={names.subtotal}
                    label={t("fields.subtotal")}
                    placeholder={t("form.subtotal.placeholder")}
                    isPending
                />
            </FieldGroup>

            <FieldGroup className="flex flex-col gap-3">
                <DecimalInput
                    control={control}
                    name={names.commissionTotal}
                    isPending={isPending}
                    label={t("fields.commissionTotal")}
                    placeholder={t("form.commissionTotal.placeholder")}
                    description={t("form.commissionTotal.description")}
                />

                <OfferPricingSummary pricing={pricing} currency={currency} />
            </FieldGroup>

            <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">{t("fields.includes")}</span>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {includes.map(({ name, icon: Icon, label, hint }) => {
                        const checked = Boolean(watch(name))

                        return (
                            <button
                                key={name}
                                type="button"
                                role="checkbox"
                                aria-checked={checked}
                                disabled={isPending}
                                onClick={() => write(name, !checked)}
                                className={cn(
                                    "flex cursor-pointer items-start gap-2 rounded-2xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default disabled:opacity-50",
                                    checked ? "border-primary bg-primary/5" : "hover:bg-muted",
                                )}
                            >
                                <Icon className="mt-0.5 size-3.5 shrink-0" stroke={1.5} />
                                <span className="min-w-0">
                                    <span className="block font-medium">{label}</span>
                                    <span className="text-muted-foreground block text-xs">{hint}</span>
                                </span>
                            </button>
                        )
                    })}
                </div>
            </div>

            <TextAreaInput
                control={control}
                name={names.notes}
                isPending={isPending}
                label={t("fields.notes")}
                placeholder={t("form.notes.placeholder")}
            />
        </FieldGroup>
    )
}

/**
 * What one offer prices: the client's total (quote + commission) and
 * Appload's commission, each split into subtotal and VAT. Shown live under
 * the commission field and, once an offer is accepted, on the deal form's
 * payment section — the same numbers the server writes onto the order.
 */
export function OfferPricingSummary({
    pricing,
    currency,
}: {
    pricing: ReturnType<typeof priceOffer> | null
    currency: string | undefined
}) {
    const t = useTranslations("Admin.orders.offers.commission")
    const f = useFormatter()

    if (pricing === null) {
        return <p className="bg-muted/30 text-muted-foreground rounded-xl p-3 text-xs">{t("empty")}</p>
    }

    const amount = (value: number) => `${f.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? "MZN"}`
    const share = pricing.clientTotal > 0 ? pricing.commissionTotal / pricing.clientTotal : null

    // One row per figure, the two prices side by side: a label and a long
    // amount never share a cell, so nothing overlaps however narrow the host
    const rows = [
        { key: "subtotal", label: t("subtotal"), client: pricing.clientSubtotal, commission: pricing.commissionSubtotal, total: false },
        { key: "vat", label: t("vat"), client: pricing.clientVAT, commission: pricing.commissionVAT, total: false },
        { key: "total", label: t("total"), client: pricing.clientTotal, commission: pricing.commissionTotal, total: true },
    ]

    return (
        <div className="bg-muted/30 grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-end gap-x-3 gap-y-1 rounded-xl p-3 text-xs">
            <span aria-hidden />
            <span className="text-right font-medium">{t("client")}</span>
            <span className="text-right font-medium">
                {t("title")}
                {share !== null && (
                    <span className="text-muted-foreground block font-normal">
                        {f.number(share, { style: "percent", maximumFractionDigits: 1 })}
                    </span>
                )}
            </span>

            {rows.map((row) => (
                <Fragment key={row.key}>
                    <span className={cn("text-muted-foreground", row.total && "border-t pt-1")}>{row.label}</span>
                    <span className={cn("text-right whitespace-nowrap tabular-nums", row.total && "border-t pt-1 font-medium")}>
                        {amount(row.client)}
                    </span>
                    <span className={cn(
                        "text-right whitespace-nowrap tabular-nums",
                        row.total && "border-t pt-1 font-medium",
                        row.total && row.commission < 0 && "text-destructive",
                    )}>
                        {amount(row.commission)}
                    </span>
                </Fragment>
            ))}
        </div>
    )
}
