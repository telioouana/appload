"use client"

import { useEffect, useMemo, useState } from "react"
import { useFieldArray, useForm, useWatch, type DefaultValues } from "react-hook-form"
import { useQuery } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { IconCancel, IconDeviceFloppy, IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { CURRENCY, FISCAL_REGIME, isApploadOrg } from "@workspace/db/types"

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
import { NONE, TYPED } from "@/backend/schemas/movement"
import type { RentalInput, RentalLineInput } from "@/backend/schemas/rental"
import { rentalErrorKey, type RentalErrorCode } from "@/frontend/pages/rentals/lib/errors"
import { useRentalMutations } from "@/frontend/pages/rentals/hooks/use-rental-mutations"
import type { PerDay, RentalDetail } from "@/frontend/pages/rentals/types"

export type RentalSheetMode = { kind: "create" } | { kind: "edit"; rental: RentalDetail }

// The calendar opens at the start of last year, as the load sheet's does:
// a rental is often filed after it began
const EARLIEST_DATE = new Date(new Date().getFullYear() - 1, 0, 1)

const EMPTY_LOCATION = { address: "", placeId: "", country: "", state: "" }

/** The provider pick that means the owner's own fleet; the others are an org id or TYPED */
const OWN = "__own"

type MessageField = "address" | "amount" | "name" | "date" | "period" | "rate" | "truck" | "lines"
type Message = (field: MessageField) => { error: string }

const location = z.object({ address: z.string(), placeId: z.string(), country: z.string(), state: z.string() })

const positive = (value: string) => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 1e12
const emptyOrNonNegative = (value: string) => value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0)
const emptyOrPositive = (value: string) => value.trim() === "" || positive(value)

const LineSchema = z.object({
    provider: z.string(),
    truckId: z.string(),
    driverId: z.string(),
    carrierName: z.string().trim().max(120),
    truckPlate: z.string().trim().max(60),
    buyRate: z.string(),
})

const EMPTY_LINE: z.infer<typeof LineSchema> = { provider: OWN, truckId: "", driverId: NONE, carrierName: "", truckPlate: "", buyRate: "" }

/**
 * The form's own rules; the doors check the rest (a connected client, a free
 * truck). The price is only asked when somebody is charged, and the lines
 * only when the rental is being filed — editing never touches them.
 */
function RentalFormSchema(msg: Message, { carrier, withLines }: { carrier: boolean; withLines: boolean }) {
    return z
        .object({
            clientOrgId: z.string(),
            clientName: z.string().trim().max(120),
            clientReference: z.string().trim().max(60),
            site: location,
            startsOn: z.date(msg("date")),
            noEnd: z.boolean(),
            endsOn: z.date(msg("date")).optional(),
            currency: z.enum(CURRENCY),
            fiscalRegime: z.enum(FISCAL_REGIME).optional(),
            rate: z.string(),
            billableDays: z.enum(["calendar", "working"]),
            standbyRate: z.string().refine(emptyOrNonNegative, msg("amount")),
            lines: withLines ? z.array(LineSchema).min(1, msg("lines")) : z.array(LineSchema),
            notes: z.string().trim().max(2000),
        })
        .refine((data) => data.clientOrgId !== TYPED || data.clientName.length > 0, { ...msg("name"), path: ["clientName"] })
        // A site is optional, but a typed address that was never picked from the list is not one
        .refine((data) => data.site.address === "" || data.site.placeId.length > 0, { ...msg("address"), path: ["site.address"] })
        // No end date is a choice, not a blank
        .refine((data) => data.noEnd || data.endsOn !== undefined, { ...msg("date"), path: ["endsOn"] })
        .refine((data) => data.noEnd || data.endsOn === undefined || data.endsOn >= data.startsOn, { ...msg("period"), path: ["endsOn"] })
        // A price needs somebody to charge: a transporter always has a client
        .refine((data) => !(carrier || data.clientOrgId !== NONE) || positive(data.rate), { ...msg("rate"), path: ["rate"] })
        .superRefine((data, ctx) => {
            data.lines.forEach((line, index) => {
                const at = (field: keyof typeof line, message: MessageField) =>
                    ctx.addIssue({ code: "custom", message: msg(message).error, path: ["lines", index, field] })

                if (line.provider === OWN) {
                    if (!line.truckId) at("truckId", "truck")
                    return
                }
                // The doors want a plate on every line, a partner's too
                if (line.provider === TYPED && !line.carrierName) at("carrierName", "name")
                if (!line.truckPlate) at("truckPlate", "truck")
                if (!emptyOrPositive(line.buyRate)) at("buyRate", "rate")
            })
        })
}

type RentalForm = z.infer<ReturnType<typeof RentalFormSchema>>

// Calendar days travel as "YYYY-MM-DD" and are read and written in local
// time: `toISOString` would shift a midnight pick to the day before
const isoDay = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

const fromIsoDay = (value: string) => {
    const [year, month, day] = value.split("-").map(Number)
    return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

function defaultsFor(mode: RentalSheetMode): DefaultValues<RentalForm> {
    if (mode.kind === "create") {
        return {
            clientOrgId: NONE,
            clientName: "",
            clientReference: "",
            site: EMPTY_LOCATION,
            startsOn: undefined,
            noEnd: false,
            endsOn: undefined,
            currency: "MZN",
            fiscalRegime: undefined,
            rate: "",
            billableDays: "calendar",
            standbyRate: "",
            lines: [EMPTY_LINE],
            notes: "",
        }
    }

    const { rental } = mode

    return {
        clientOrgId: rental.client?.id ?? (rental.client?.name ? TYPED : NONE),
        clientName: rental.client?.id ? "" : rental.client?.name ?? "",
        clientReference: rental.clientReference ?? "",
        site: rental.site ?? EMPTY_LOCATION,
        startsOn: fromIsoDay(rental.startsOn),
        noEnd: rental.endsOn === null,
        endsOn: rental.endsOn === null ? undefined : fromIsoDay(rental.endsOn),
        currency: rental.currency,
        fiscalRegime: rental.fiscalRegime ?? undefined,
        rate: rental.sellPrice ? String(rental.sellPrice.rate) : "",
        billableDays: rental.sellPrice?.billableDays ?? "calendar",
        standbyRate: rental.sellPrice?.standbyRate === undefined ? "" : String(rental.sellPrice.standbyRate),
        lines: [],
        notes: rental.notes ?? "",
    }
}

/**
 * Filing a rental, or correcting one. What the company is decides what it
 * is asked, as on the load sheet: a transporter names the client and what it
 * charges per day; a shipper's rentals are its own, so it names neither. The
 * trucks are named once, on filing; afterwards the page adds and ends lines
 * one at a time, since each carries its own log.
 */
export function RentalSheet({
    open,
    onOpenChange,
    mode,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    mode: RentalSheetMode
}) {
    const t = useTranslations("App.rentals")
    const tf = useTranslations("App.loads.form")
    const tv = useTranslations("App.orders")
    const trpc = useTRPC()
    const router = useRouter()

    const { create, update } = useRentalMutations()
    const isPending = create.isPending || update.isPending

    const [error, setError] = useState<RentalErrorCode | null>(null)

    const { data: session } = useQuery(trpc.me.session.queryOptions())
    const { data: options } = useQuery({ ...trpc.movements.formOptions.queryOptions(), enabled: open })

    const editing = mode.kind === "edit"
    const carrier = session?.organization.type === "carrier"

    const FormSchema = useMemo(
        () => RentalFormSchema((field) => ({
            error: field === "period" ? t("errors.PERIOD_INVERTED")
                : field === "date" || field === "rate" || field === "truck" || field === "lines" ? t(`form.errors.${field}`)
                    : tf(`errors.${field}`),
        }), { carrier, withLines: !editing }),
        [t, tf, carrier, editing],
    )

    const form = useForm<RentalForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: defaultsFor(mode),
    })

    const { control, reset, setValue, handleSubmit } = form
    const { fields, append, remove } = useFieldArray({ control, name: "lines" })

    const [clientOrgId, noEnd, lines] = useWatch({ control, name: ["clientOrgId", "noEnd", "lines"] })

    // A price needs somebody to charge: a transporter always has a client
    const asksPrice = carrier || clientOrgId !== NONE

    // A reopened sheet starts from the rental as it is now, not where it was left
    const modeKey = mode.kind === "create" ? "create" : `edit:${mode.rental.id}:${mode.rental.version}`
    useEffect(() => {
        if (open) reset(defaultsFor(mode))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, modeKey, reset])

    // An error belongs to the attempt it came from; closing the sheet drops it
    const dismiss = () => {
        setError(null)
        onOpenChange(false)
    }

    // Appload moves loads; it never orders them, and the doors refuse it as a client
    const clients = (options?.partners ?? []).filter((row) => !isApploadOrg(row.id))
    const carriers = (options?.partners ?? []).filter((row) => row.type === "carrier")

    function onSubmit(values: RentalForm) {
        setError(null)

        const perDay = (rate: string, standby = ""): PerDay => ({
            model: "per-day",
            rate: Number(rate),
            billableDays: values.billableDays,
            ...(standby.trim() && { standbyRate: Number(standby) }),
        })

        const input: RentalInput = {
            ...(carrier && values.clientOrgId === TYPED && { clientName: values.clientName }),
            ...(carrier && values.clientOrgId !== TYPED && values.clientOrgId !== NONE && { clientOrgId: values.clientOrgId }),
            clientReference: carrier ? values.clientReference || null : null,
            site: values.site.placeId ? values.site : null,
            startsOn: isoDay(values.startsOn),
            endsOn: values.noEnd || !values.endsOn ? null : isoDay(values.endsOn),
            currency: values.currency,
            fiscalRegime: values.fiscalRegime ?? null,
            sellPrice: asksPrice ? perDay(values.rate, values.standbyRate) : null,
            notes: values.notes || null,
        }

        if (mode.kind === "edit") {
            update.mutate({ ...input, id: mode.rental.id, expectedVersion: mode.rental.version }, {
                onSuccess: () => onOpenChange(false),
                onError: (failure) => setError(rentalErrorKey(failure)),
            })
            return
        }

        const toLine = (line: RentalForm["lines"][number]): RentalLineInput =>
            line.provider === OWN
                ? { truckId: line.truckId, driverId: line.driverId === NONE ? null : line.driverId }
                : {
                    ...(line.provider === TYPED ? { carrierName: line.carrierName } : { carrierOrgId: line.provider }),
                    truckPlate: line.truckPlate,
                    buyPrice: line.buyRate.trim() ? perDay(line.buyRate) : null,
                }

        create.mutate({ ...input, lines: values.lines.map(toLine) }, {
            onSuccess: ({ id }) => {
                onOpenChange(false)
                router.push({ pathname: "/orders/rental/[orderId]", params: { orderId: id } })
            },
            onError: (failure) => setError(rentalErrorKey(failure)),
        })
    }

    return (
        <Sheet open={open} onOpenChange={(next) => { if (!isPending) { if (next) onOpenChange(true); else dismiss() } }}>
            <SheetContent
                side="right"
                className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-[680px]"
            >
                <SheetHeader className="border-b">
                    <SheetTitle>{editing ? t("form.edit-title", { ref: mode.rental.ref }) : t("form.new-title")}</SheetTitle>
                    <SheetDescription>{t("form.description")}</SheetDescription>
                </SheetHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                    <form
                        id="rental-form"
                        onSubmit={(event) => {
                            // The sheet can open over a page's own form; keep
                            // this submit from bubbling into it
                            event.stopPropagation()
                            void handleSubmit(onSubmit)(event)
                        }}
                    >
                        <FieldGroup className="gap-7">
                            {/* A shipper's rentals are for itself */}
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
                                <FieldLegend variant="label"><FieldTitle>{t("form.sections.site")}</FieldTitle></FieldLegend>
                                <LocationInput
                                    name="site.address"
                                    control={control}
                                    isPending={isPending}
                                    label={t("form.fields.site")}
                                    placeholder={tf("fields.origin-placeholder")}
                                    setPlaceId={(value) => setValue("site.placeId", value, { shouldDirty: true })}
                                    setCountry={(value) => setValue("site.country", value, { shouldDirty: true })}
                                    setState={(value) => setValue("site.state", value, { shouldDirty: true })}
                                />
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
                                    {/* Which days count is the order's rule, whoever pays whom; the lines' buy rates follow it too */}
                                    <SelectInput name="billableDays" control={control} isPending={isPending} label={t("form.fields.billable-days")}>
                                        <SelectItem value="calendar">{t("form.fields.calendar")}</SelectItem>
                                        <SelectItem value="working">{t("form.fields.working")}</SelectItem>
                                    </SelectInput>
                                    {asksPrice && (
                                        <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                                            <DecimalInput name="rate" control={control} isPending={isPending} label={t("form.fields.rate")} placeholder="0" />
                                            <DecimalInput
                                                name="standbyRate"
                                                control={control}
                                                isPending={isPending}
                                                label={t("form.fields.standby-rate")}
                                                description={t("form.fields.standby-hint")}
                                                placeholder="0"
                                            />
                                        </FieldGroup>
                                    )}
                                </FieldGroup>
                            </FieldSet>

                            {/* The trucks are named on filing; the page adds and ends lines afterwards */}
                            {!editing && (
                                <FieldSet>
                                    <FieldLegend variant="label"><FieldTitle>{t("form.sections.trucks")}</FieldTitle></FieldLegend>
                                    <FieldGroup className="gap-4">
                                        {fields.map((field, index) => {
                                            const provider = lines?.[index]?.provider ?? OWN
                                            const own = provider === OWN

                                            return (
                                                <div key={field.id} className="flex flex-col gap-4 rounded-2xl border p-4">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-sm font-medium">{t("form.lines.truck")} {index + 1}</span>
                                                        <Button type="button" variant="ghost" size="sm" disabled={isPending || fields.length === 1} onClick={() => remove(index)}>
                                                            <IconTrash className="size-4" stroke={1.5} />
                                                            {t("form.lines.remove")}
                                                        </Button>
                                                    </div>
                                                    <SelectInput name={`lines.${index}.provider`} control={control} isPending={isPending} label={t("form.lines.provider")}>
                                                        <SelectItem value={OWN}>{t("form.lines.own-fleet")}</SelectItem>
                                                        {carriers.map((row) => (
                                                            <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                                                        ))}
                                                        <SelectItem value={TYPED}>{t("form.lines.typed")}</SelectItem>
                                                    </SelectInput>
                                                    {own ? (
                                                        <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                                                            <SelectInput
                                                                name={`lines.${index}.truckId`}
                                                                control={control}
                                                                isPending={isPending}
                                                                label={t("form.lines.truck")}
                                                                placeholder={t("form.lines.truck-none")}
                                                            >
                                                                {(options?.trucks ?? []).map((row) => (
                                                                    <SelectItem key={row.id} value={row.id}>{row.plate}</SelectItem>
                                                                ))}
                                                            </SelectInput>
                                                            <SelectInput name={`lines.${index}.driverId`} control={control} isPending={isPending} label={t("form.lines.driver")}>
                                                                <SelectItem value={NONE}>{t("form.lines.driver-none")}</SelectItem>
                                                                {(options?.drivers ?? []).map((row) => (
                                                                    <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                                                                ))}
                                                            </SelectInput>
                                                        </FieldGroup>
                                                    ) : (
                                                        <>
                                                            {provider === TYPED && (
                                                                <TextInput name={`lines.${index}.carrierName`} control={control} isPending={isPending} label={t("form.lines.carrier-name")} />
                                                            )}
                                                            <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                                                                <TextInput name={`lines.${index}.truckPlate`} control={control} isPending={isPending} label={t("form.lines.truck-plate")} />
                                                                <DecimalInput name={`lines.${index}.buyRate`} control={control} isPending={isPending} label={t("form.lines.buy-rate")} placeholder="0" />
                                                            </FieldGroup>
                                                        </>
                                                    )}
                                                </div>
                                            )
                                        })}
                                        <Button type="button" variant="outline" className="w-fit" disabled={isPending} onClick={() => append(EMPTY_LINE)}>
                                            <IconPlus className="size-4" stroke={1.5} />
                                            {t("form.lines.add")}
                                        </Button>
                                    </FieldGroup>
                                </FieldSet>
                            )}

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
                    <Button type="submit" form="rental-form" disabled={isPending}>
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
