import { useFieldArray, useFormContext, useFormState } from "react-hook-form";
import { IconCircleCheck, IconCircleDashed, IconPlus, IconX } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { CATEGORIES, CURRENCY, LOAD_TYPE, LOADING_BAY, ROUTE_TYPE, TRIP_TYPE, TRUCK_AGE, WEIGHT_UNIT } from "@workspace/db/types";

import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/button";
import { DateInput } from "@workspace/ui/inputs/date";
import { TextInput } from "@workspace/ui/inputs/text";
import { NumberInput } from "@workspace/ui/inputs/number";
import { SelectInput } from "@workspace/ui/inputs/select";
import { WeightInput } from "@workspace/ui/inputs/weight";
import { DecimalInput } from "@workspace/ui/inputs/decimal";
import { SelectItem } from "@workspace/ui/components/select";
import { LocationInput } from "@workspace/ui/inputs/location";
import { TextAreaInput } from "@workspace/ui/inputs/textarea";
import { FieldDescription, FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldTitle } from "@workspace/ui/components/field";

import { FleetInput } from "@/components/inputs/fleet";
import { DriverInput } from "@/components/inputs/driver";
import { OrganizationInput } from "@/components/inputs/organization";
import { KycGateBanner } from "@/frontend/pages/order/components/kyc-gate-banner";
import { OfferFields, OfferPricingSummary, offerNames } from "@/frontend/pages/order/components/offer-fields";
import { priceOffer } from "@/lib/orders/commission";
import { truckAgeFromYear } from "@/lib/fleet";
import { CreateOrderForm, CreateOrderFormInput } from "@/backend/schemas/order";

type FormProps = {
    isPending: boolean
}

const EARLIEST_DATE = new Date(new Date().getFullYear(), 0, 1);

// Amount fields hold what the user typed, so an untouched one is "" and not
// a number the preview can subtract
const priced = (value: unknown) => value !== undefined && value !== null && value !== "";

/**
 * A fresh offer row. The carrier, the regime and the price are what the
 * operator is about to type, so they start empty even though the parsed
 * shape demands them — the schema is what turns this into an offer.
 */
const emptyOffer = (currency: CreateOrderForm["shipperCurrency"]) => ({
    carrierId: "",
    carrierName: "",
    fiscalRegime: undefined,
    subtotal: undefined,
    vat: undefined,
    total: undefined,
    currency,
    commissionTotal: undefined,
    includesGit: false,
    includesGps: false,
    notes: "",
    accepted: false,
}) as unknown as CreateOrderForm["offers"][number];

export function NewOrderForm({ isPending }: FormProps) {
    const t = useTranslations("Admin.order.create.form")
    const { control, setValue, watch } = useFormContext<CreateOrderForm, unknown, CreateOrderFormInput>()

    const { fields, append, remove } = useFieldArray({ control, name: "offers", keyName: "key" })
    const { errors } = useFormState({ control })

    // The "exactly one accepted offer" rule fails on the array itself, so no
    // single field's own error ever names it
    const offersError = errors.offers?.root?.message ?? errors.offers?.message

    const status = watch("status")
    const shipperCurrency = watch("shipperCurrency")
    // Live, unlike `fields`, which only re-issues on add and remove
    const offers = watch("offers") ?? []
    const accepted = offers.find((offer) => offer?.accepted)

    // Exactly one offer books the order, so choosing one unchooses the rest
    const bookWith = (index: number) =>
        fields.forEach((_, position) => setValue(`offers.${position}.accepted`, position === index, { shouldDirty: true }))

    // What the accepted offer prices the order at: its client price becomes
    // the shipper leg at save and its commission Appload's, whatever the
    // payment section carries. The server writes the same figures from the
    // same inputs.
    const routeType = watch("routeType")
    const pricing = accepted && priced(accepted.total) && priced(accepted.commissionTotal)
        ? priceOffer({
            carrierTotal: Number(accepted.total),
            fiscalRegime: accepted.fiscalRegime,
            commissionTotal: Number(accepted.commissionTotal),
            route: routeType ?? "national",
        })
        : null

    return (
        <FieldGroup>
            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("shipper.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />

                <FieldGroup>
                    <OrganizationInput
                        control={control}
                        name="shipperName"
                        isPending={isPending}
                        orgType="shipper"
                        label={t("shipper.fields.shipper.label")}
                        placeholder={t("shipper.fields.shipper.placeholder")}
                        description={t("shipper.fields.shipper.description")}
                        setOrgId={(id) => setValue("shipperId", id ?? "", { shouldDirty: true })}
                    />
                </FieldGroup>
            </FieldSet>

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("routeDates.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />
                <FieldGroup>
                    <LocationInput
                        control={control}
                        name={`loadingAddress.address`}
                        label={t("routeDates.fields.loadingAddress.label")}
                        placeholder={t("routeDates.fields.loadingAddress.placeholder")}
                        description={t("routeDates.fields.loadingAddress.description")}
                        isPending={isPending}
                        setCountry={(value) => setValue(`loadingAddress.country`, value)}
                        setPlaceId={(value) => setValue(`loadingAddress.placeId`, value)}
                        setState={(value) => setValue(`loadingAddress.state`, value)}
                    />

                    <LocationInput
                        control={control}
                        name={`offloadingAddress.address`}
                        label={t("routeDates.fields.offloadingAddress.label")}
                        placeholder={t("routeDates.fields.offloadingAddress.placeholder")}
                        description={t("routeDates.fields.offloadingAddress.description")}
                        isPending={isPending}
                        setCountry={(value) => setValue(`offloadingAddress.country`, value)}
                        setPlaceId={(value) => setValue(`offloadingAddress.placeId`, value)}
                        setState={(value) => setValue(`offloadingAddress.state`, value)}
                    />

                    <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                        <DateInput
                            name="expectedLoadingDate"
                            control={control}
                            isPending={isPending}
                            value={EARLIEST_DATE}
                            label={t("routeDates.fields.expectedloadingDate.label")}
                            placeholder={t("routeDates.fields.expectedloadingDate.placeholder")}
                        />

                        <DateInput
                            name="expectedOffloadingDate"
                            control={control}
                            isPending={isPending}
                            value={watch("expectedLoadingDate")}
                            label={t("routeDates.fields.expectedoffloadingDate.label")}
                            placeholder={t("routeDates.fields.expectedoffloadingDate.placeholder")}
                        />
                    </FieldGroup>

                    <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                        <SelectInput
                            control={control}
                            name="routeType"
                            label={t("routeDates.fields.routeType.label")}
                            placeholder={t("routeDates.fields.routeType.placeholder")}
                            isPending
                        >
                            {ROUTE_TYPE.map((item, index) => <SelectItem key={index} value={item}>{t(`routeDates.fields.routeType.options.${item}`)}</SelectItem>)}
                        </SelectInput>

                        <SelectInput
                            control={control}
                            name="tripType"
                            label={t("routeDates.fields.tripType.label")}
                            placeholder={t("routeDates.fields.tripType.placeholder")}
                            isPending
                        >
                            {TRIP_TYPE.map((item, index) => <SelectItem key={index} value={item}>{t(`routeDates.fields.tripType.options.${item}`)}</SelectItem>)}
                        </SelectInput>

                        <NumberInput
                            control={control}
                            name="distance"
                            label={t("routeDates.fields.distance.label")}
                            placeholder={t("routeDates.fields.distance.placeholder")}
                            isPending
                        />

                        <NumberInput
                            control={control}
                            name="deliveries"
                            label={t("routeDates.fields.deliveries.label")}
                            placeholder={t("routeDates.fields.deliveries.placeholder")}
                            isPending={isPending}
                        />
                    </FieldGroup>
                </FieldGroup>
            </FieldSet>

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("cargo.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />
                <FieldGroup>
                    <SelectInput
                        control={control}
                        name="category"
                        label={t("cargo.fields.category.label")}
                        placeholder={t("cargo.fields.category.placeholder")}
                        isPending={isPending}
                    >
                        {CATEGORIES.map((item, index) => <SelectItem key={index} value={item}>{t(`cargo.fields.category.options.${item}`)}</SelectItem>)}
                    </SelectInput>

                    <TextAreaInput
                        name="description"
                        control={control}
                        isPending={isPending}
                        label={t("cargo.fields.description.label")}
                        placeholder={t("cargo.fields.description.placeholder")}
                    />

                    <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                        <WeightInput
                            control={control}
                            name="weight"
                            label={t("cargo.fields.weight.label")}
                            placeholder={t("cargo.fields.weight.placeholder")}
                            isPending={isPending}
                            value={watch("weightUnit") as typeof WEIGHT_UNIT[number]}
                            setValue={(value: typeof WEIGHT_UNIT[number]) => setValue("weightUnit", value)}
                        />

                        <SelectInput
                            control={control}
                            name="loadType"
                            label={t("cargo.fields.loadType.label")}
                            placeholder={t("cargo.fields.loadType.placeholder")}
                            isPending={isPending}
                        >
                            {LOAD_TYPE.map((item, index) => <SelectItem key={index} value={item}>{t(`cargo.fields.loadType.options.${item}`)}</SelectItem>)}
                        </SelectInput>
                    </FieldGroup>
                </FieldGroup>
            </FieldSet>

            <FieldSet>
                <FieldSeparator />
                <FieldGroup>
                    <SelectInput
                        control={control}
                        name="status"
                        label={t("status.label")}
                        placeholder={t("status.placeholder")}
                        isPending={isPending}
                    >
                        <SelectItem value="prospect">{t("status.options.prospect")}</SelectItem>
                        <SelectItem value="booked">{t("status.options.booked")}</SelectItem>
                    </SelectInput>
                </FieldGroup>
            </FieldSet>

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("offers.title")}</FieldTitle>
                </FieldLegend>
                <FieldDescription>{t("offers.description")}</FieldDescription>
                <FieldSeparator />
                <FieldGroup>
                    {fields.length === 0 && (
                        <p className="text-muted-foreground text-sm">{t("offers.empty")}</p>
                    )}

                    <div
                        className="flex flex-col gap-4"
                        {...(status === "booked" && { role: "radiogroup", "aria-label": t("offers.accepted") })}
                    >
                        {fields.map((field, index) => (
                            <div key={field.key} className="flex flex-col gap-6 rounded-2xl border p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-muted-foreground text-xs">{t("offers.offerN", { number: index + 1 })}</span>

                                    <div className="flex items-center gap-1.5">
                                        {/* Only a booked payload names a winner; a prospect's
                                            offers all stay pending until one is accepted */}
                                        {status === "booked" && (
                                            <button
                                                type="button"
                                                role="radio"
                                                aria-checked={Boolean(offers[index]?.accepted)}
                                                disabled={isPending}
                                                onClick={() => bookWith(index)}
                                                className={cn(
                                                    "flex cursor-pointer items-center gap-1.5 rounded-2xl border px-3 py-1.5 text-xs transition-colors disabled:cursor-default disabled:opacity-50",
                                                    offers[index]?.accepted ? "border-primary bg-primary/5" : "hover:bg-muted",
                                                )}
                                            >
                                                {offers[index]?.accepted
                                                    ? <IconCircleCheck className="size-3.5" stroke={1.5} />
                                                    : <IconCircleDashed className="size-3.5" stroke={1.5} />}
                                                {t("offers.accepted")}
                                            </button>
                                        )}

                                        <Button
                                            type="button"
                                            size="icon-sm"
                                            variant="ghost"
                                            disabled={isPending}
                                            onClick={() => remove(index)}
                                        >
                                            <IconX />
                                            <span className="sr-only">{t("offers.remove")}</span>
                                        </Button>
                                    </div>
                                </div>

                                <OfferFields
                                    control={control}
                                    names={offerNames<CreateOrderForm>(`offers.${index}.`)}
                                    isPending={isPending}
                                    watch={watch}
                                    setValue={setValue}
                                    route={routeType}
                                />
                            </div>
                        ))}
                    </div>

                    {offersError && <p className="text-destructive text-sm">{offersError}</p>}

                    <Button
                        type="button"
                        variant="outline"
                        disabled={isPending}
                        className="w-full border-dashed"
                        onClick={() => append(emptyOffer(shipperCurrency))}
                    >
                        <IconPlus />
                        {t("offers.add")}
                    </Button>
                </FieldGroup>
            </FieldSet>

            {status === "booked" && (
                <FieldSet>
                    <FieldLegend>
                        <FieldTitle>{t("bookingDetails.title")}</FieldTitle>
                    </FieldLegend>
                    <FieldDescription>{t("bookingDetails.description")}</FieldDescription>
                    <FieldSeparator />
                    {!accepted?.carrierId ? (
                        <p className="text-muted-foreground text-sm">{t("bookingDetails.noOffer")}</p>
                    ) : (
                        <FieldGroup>
                            {/* The same verdict the server enforces on booking */}
                            <KycGateBanner
                                carrierId={accepted.carrierId}
                                driverId={watch("driverId")}
                                truckPlate={watch("truckPlate")}
                                trailerPlate={watch("trailerPlate")}
                                linkPlate={watch("linkPlate")}
                            />
        
                            <FieldSet>
                                <FieldLegend>
                                    <FieldTitle>{t("carrier.fields.driver.title")}</FieldTitle>
                                </FieldLegend>
                                <FieldGroup>
                                    <DriverInput
                                        control={control}
                                        name="driverName"
                                        label={t("carrier.fields.driver.name.label")}
                                        placeholder={t("carrier.fields.driver.name.placeholder")}
                                        description={t("carrier.fields.driver.name.description")}
                                        isPending={isPending}
                                        carrierId={accepted.carrierId}
                                        onSelect={(driver) => {
                                            setValue("driverId", driver?.id, { shouldDirty: true })
                                            if (driver?.phoneNumber) {
                                                setValue("driverContact", driver.phoneNumber, { shouldDirty: true })
                                            }
                                            if (driver?.passport) {
                                                setValue("driverPassport", driver.passport, { shouldDirty: true })
                                            }
                                        }}
                                    />
        
                                    <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                                        <TextInput
                                            control={control}
                                            name="driverContact"
                                            label={t("carrier.fields.driver.contact.label")}
                                            placeholder={t("carrier.fields.driver.contact.placeholder")}
                                            isPending
                                        />
        
                                        <TextInput
                                            control={control}
                                            name="driverPassport"
                                            label={t("carrier.fields.driver.passport.label")}
                                            placeholder={t("carrier.fields.driver.passport.placeholder")}
                                            isPending
                                        />
                                    </FieldGroup>
                                </FieldGroup>
                            </FieldSet>
        
                            <FieldSet>
                                <FieldLegend>
                                    <FieldTitle>{t("carrier.fields.fleet.title")}</FieldTitle>
                                </FieldLegend>
                                <FieldGroup>
                                    <FleetInput
                                        control={control}
                                        name="truckPlate"
                                        label={t("carrier.fields.fleet.truck.label")}
                                        placeholder={t("carrier.fields.fleet.truck.placeholder")}
                                        description={t("carrier.fields.fleet.truck.description")}
                                        isPending={isPending}
                                        kind="truck"
                                        carrierId={accepted.carrierId}
                                        onSelect={(truck) => {
                                            if (!truck) return
                                            setValue("truckAge", truckAgeFromYear(truck.year), { shouldDirty: true })
                                            // The trailer's bay wins for articulated rigs;
                                            // only fill from the truck when nothing is set yet
                                            if (truck.loadingBay && !watch("trailerPlate")) {
                                                setValue("loadingBay", truck.loadingBay.type, { shouldDirty: true })
                                                setValue("loadingCapacity", truck.loadingBay.capacity, { shouldDirty: true })
                                            }
                                        }}
                                    />
        
                                    <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                                        <SelectInput
                                            control={control}
                                            name="truckAge"
                                            label={t("carrier.fields.fleet.age.label")}
                                            placeholder={t("carrier.fields.fleet.age.placeholder")}
                                            isPending={isPending}
                                        >
                                            {TRUCK_AGE.map((item, index) => <SelectItem key={index} value={item}>{t(`carrier.fields.fleet.age.options.${item}`)}</SelectItem>)}
                                        </SelectInput>
        
                                        <SelectInput
                                            control={control}
                                            name="loadingBay"
                                            label={t("carrier.fields.fleet.loadingBay.label")}
                                            placeholder={t("carrier.fields.fleet.loadingBay.placeholder")}
                                            isPending={isPending}
                                        >
                                            {LOADING_BAY.map((item, index) => <SelectItem key={index} value={item}>{t(`carrier.fields.fleet.loadingBay.options.${item}`)}</SelectItem>)}
                                        </SelectInput>
                                    </FieldGroup>
        
                                    <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-3 items-start">
                                        <FleetInput
                                            control={control}
                                            name="trailerPlate"
                                            label={t("carrier.fields.fleet.trailer.label")}
                                            placeholder={t("carrier.fields.fleet.trailer.placeholder")}
                                            isPending={isPending}
                                            kind="trailer"
                                            carrierId={accepted.carrierId}
                                            onSelect={(trailer) => {
                                                // The towed unit carries the cargo: its bay
                                                // overrides whatever the truck filled in
                                                if (trailer?.loadingBay) {
                                                    setValue("loadingBay", trailer.loadingBay.type, { shouldDirty: true })
                                                    setValue("loadingCapacity", trailer.loadingBay.capacity, { shouldDirty: true })
                                                }
                                            }}
                                        />
        
                                        <FleetInput
                                            control={control}
                                            name="linkPlate"
                                            label={t("carrier.fields.fleet.link.label")}
                                            placeholder={t("carrier.fields.fleet.link.placeholder")}
                                            isPending={isPending}
                                            kind="link"
                                            carrierId={accepted.carrierId}
                                            onSelect={() => undefined}
                                        />
        
                                        <WeightInput
                                            control={control}
                                            name="loadingCapacity"
                                            label={t("carrier.fields.fleet.capacity.label")}
                                            placeholder={t("carrier.fields.fleet.capacity.placeholder")}
                                            isPending={isPending}
                                            value={watch("weightUnit") as typeof WEIGHT_UNIT[number]}
                                            setValue={(value: typeof WEIGHT_UNIT[number]) => setValue("weightUnit", value)}
                                            disabled
                                        />
                                    </FieldGroup>
                                </FieldGroup>
                            </FieldSet>
                        </FieldGroup>
                    )}
                </FieldSet>
            )}

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("payment.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />
                <FieldGroup>
                    <FieldSet>
                        <FieldLegend>
                            <FieldTitle>{t("payment.fields.shipper.title")}</FieldTitle>
                        </FieldLegend>
                        <FieldGroup>
                            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                                <DecimalInput
                                    control={control}
                                    name="shipperSubtotal"
                                    label={t("payment.fields.shipper.subtotal.label")}
                                    placeholder={t("payment.fields.shipper.subtotal.placeholder")}
                                    isPending={isPending}
                                />

                                <DecimalInput
                                    control={control}
                                    name="shipperVAT"
                                    label={t("payment.fields.shipper.vat.label")}
                                    placeholder={t("payment.fields.shipper.vat.placeholder")}
                                    isPending
                                />
                            </FieldGroup>

                            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                                <DecimalInput
                                    control={control}
                                    name="shipperTotal"
                                    label={t("payment.fields.shipper.total.label")}
                                    placeholder={t("payment.fields.shipper.total.placeholder")}
                                    isPending={isPending}
                                />

                                <SelectInput
                                    control={control}
                                    name="shipperCurrency"
                                    label={t("payment.fields.shipper.currency.label")}
                                    placeholder={t("payment.fields.shipper.currency.placeholder")}
                                    isPending={isPending}
                                >
                                    {CURRENCY.map((item, index) => <SelectItem key={index} value={item}>{t(`payment.fields.shipper.currency.options.${item}`)}</SelectItem>)}
                                </SelectInput>
                            </FieldGroup>
                        </FieldGroup>
                    </FieldSet>

                    {/* Booking prices the order from the accepted offer: its
                        client price lands on the shipper leg above at save,
                        its commission on Appload's — read-only, the server
                        writes both from the same inputs */}
                    {status === "booked" && <OfferPricingSummary pricing={pricing} currency={accepted?.currency} />}
                </FieldGroup>
            </FieldSet>
        </FieldGroup>
    )
}
