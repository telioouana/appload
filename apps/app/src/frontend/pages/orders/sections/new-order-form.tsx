"use client"

import { useFormContext } from "react-hook-form"

import { useTranslations } from "@workspace/i18n"
import { CATEGORIES, CURRENCY, LOAD_TYPE, PACKING, ROUTE_TYPE, TRIP_TYPE, WEIGHT_UNIT } from "@workspace/db/types"

import { DateInput } from "@workspace/ui/inputs/date"
import { TextInput } from "@workspace/ui/inputs/text"
import { NumberInput } from "@workspace/ui/inputs/number"
import { SelectInput } from "@workspace/ui/inputs/select"
import { WeightInput } from "@workspace/ui/inputs/weight"
import { CheckboxInput } from "@workspace/ui/inputs/checkbox"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { LocationInput } from "@workspace/ui/inputs/location"
import { TextAreaInput } from "@workspace/ui/inputs/textarea"
import { SelectItem } from "@workspace/ui/components/select"
import { FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldTitle } from "@workspace/ui/components/field"

import type { CreateOrderForm, CreateOrderFormInput } from "@/backend/schemas/order"

/** Nobody files an order for a load that was collected last year. */
const EARLIEST_DATE = new Date(new Date().getFullYear(), 0, 1)

/**
 * What a client fills in to put an order out to its carriers: where the load
 * is and where it is going, what it is, and how much of it. Deliberately
 * shorter than Appload's own form — there is no shipper to choose (it is the
 * tenant), no carrier, no offer and no accounting: the price arrives as an
 * offer, and the commission is never the client's to type.
 *
 * The route type, the trip type and the distance are derived from the two
 * places by the sheet that hosts this form, so they are shown filled in
 * rather than asked for.
 */
export function NewOrderForm({ isPending }: { isPending: boolean }) {
    const t = useTranslations("App.orders.create.form")
    const tv = useTranslations("App.orders")

    const { control, setValue, watch } = useFormContext<CreateOrderFormInput, unknown, CreateOrderForm>()

    const refrigerated = watch("isRefrigerated")
    const hazardous = watch("isHazardous")

    return (
        <FieldGroup>
            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("route.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />

                <FieldGroup>
                    <LocationInput
                        control={control}
                        name="loadingAddress.address"
                        isPending={isPending}
                        label={t("route.fields.loadingAddress.label")}
                        placeholder={t("route.fields.loadingAddress.placeholder")}
                        description={t("route.fields.loadingAddress.description")}
                        setCountry={(value) => setValue("loadingAddress.country", value)}
                        setPlaceId={(value) => setValue("loadingAddress.placeId", value)}
                        setState={(value) => setValue("loadingAddress.state", value)}
                    />

                    <LocationInput
                        control={control}
                        name="offloadingAddress.address"
                        isPending={isPending}
                        label={t("route.fields.offloadingAddress.label")}
                        placeholder={t("route.fields.offloadingAddress.placeholder")}
                        description={t("route.fields.offloadingAddress.description")}
                        setCountry={(value) => setValue("offloadingAddress.country", value)}
                        setPlaceId={(value) => setValue("offloadingAddress.placeId", value)}
                        setState={(value) => setValue("offloadingAddress.state", value)}
                    />

                    <FieldGroup className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                        <DateInput
                            control={control}
                            name="expectedLoadingDate"
                            isPending={isPending}
                            value={EARLIEST_DATE}
                            label={t("route.fields.expectedLoadingDate.label")}
                            placeholder={t("route.fields.expectedLoadingDate.placeholder")}
                        />

                        <DateInput
                            control={control}
                            name="expectedOffloadingDate"
                            isPending={isPending}
                            value={watch("expectedLoadingDate")}
                            label={t("route.fields.expectedOffloadingDate.label")}
                            placeholder={t("route.fields.expectedOffloadingDate.placeholder")}
                        />
                    </FieldGroup>

                    <FieldGroup className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
                        <SelectInput
                            control={control}
                            name="routeType"
                            isPending={isPending}
                            label={t("route.fields.routeType.label")}
                            placeholder={t("route.fields.routeType.placeholder")}
                        >
                            {ROUTE_TYPE.map((item) => (
                                <SelectItem key={item} value={item}>{tv(`routeType.${item}`)}</SelectItem>
                            ))}
                        </SelectInput>

                        <SelectInput
                            control={control}
                            name="tripType"
                            isPending={isPending}
                            label={t("route.fields.tripType.label")}
                            placeholder={t("route.fields.tripType.placeholder")}
                        >
                            {TRIP_TYPE.map((item) => (
                                <SelectItem key={item} value={item}>{tv(`tripType.${item}`)}</SelectItem>
                            ))}
                        </SelectInput>

                        <NumberInput
                            control={control}
                            name="distance"
                            isPending={isPending}
                            label={t("route.fields.distance.label")}
                            placeholder={t("route.fields.distance.placeholder")}
                            description={t("route.fields.distance.description")}
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
                        isPending={isPending}
                        label={t("cargo.fields.category.label")}
                        placeholder={t("cargo.fields.category.placeholder")}
                    >
                        {CATEGORIES.map((item) => (
                            <SelectItem key={item} value={item}>{tv(`category.${item}`)}</SelectItem>
                        ))}
                    </SelectInput>

                    <TextAreaInput
                        control={control}
                        name="description"
                        isPending={isPending}
                        label={t("cargo.fields.description.label")}
                        placeholder={t("cargo.fields.description.placeholder")}
                    />

                    <FieldGroup className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                        <WeightInput
                            control={control}
                            name="weight"
                            isPending={isPending}
                            label={t("cargo.fields.weight.label")}
                            placeholder={t("cargo.fields.weight.placeholder")}
                            value={watch("weightUnit") as (typeof WEIGHT_UNIT)[number]}
                            setValue={(value: (typeof WEIGHT_UNIT)[number]) => setValue("weightUnit", value)}
                        />

                        <SelectInput
                            control={control}
                            name="loadType"
                            isPending={isPending}
                            label={t("cargo.fields.loadType.label")}
                            placeholder={t("cargo.fields.loadType.placeholder")}
                        >
                            {LOAD_TYPE.map((item) => (
                                <SelectItem key={item} value={item}>{tv(`loadType.${item}`)}</SelectItem>
                            ))}
                        </SelectInput>
                    </FieldGroup>

                    <SelectInput
                        control={control}
                        name="packing"
                        isPending={isPending}
                        label={t("cargo.fields.packing.label")}
                        placeholder={t("cargo.fields.packing.placeholder")}
                    >
                        {PACKING.map((item) => (
                            <SelectItem key={item} value={item}>{tv(`packing.${item}`)}</SelectItem>
                        ))}
                    </SelectInput>

                    <FieldGroup className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                        <CheckboxInput
                            control={control}
                            name="isHazardous"
                            isPending={isPending}
                            label={t("cargo.fields.isHazardous.label")}
                        />

                        {hazardous && (
                            <TextInput
                                control={control}
                                name="hazchemCode"
                                isPending={isPending}
                                label={t("cargo.fields.hazchemCode.label")}
                                placeholder={t("cargo.fields.hazchemCode.placeholder")}
                            />
                        )}
                    </FieldGroup>

                    <CheckboxInput
                        control={control}
                        name="isRefrigerated"
                        isPending={isPending}
                        label={t("cargo.fields.isRefrigerated.label")}
                    />

                    {refrigerated && (
                        <FieldGroup className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                            <DecimalInput
                                control={control}
                                name="temperature"
                                isPending={isPending}
                                label={t("cargo.fields.temperature.label")}
                                placeholder={t("cargo.fields.temperature.placeholder")}
                            />

                            <TextInput
                                control={control}
                                name="temperatureInstructions"
                                isPending={isPending}
                                label={t("cargo.fields.temperatureInstructions.label")}
                                placeholder={t("cargo.fields.temperatureInstructions.placeholder")}
                            />
                        </FieldGroup>
                    )}
                </FieldGroup>
            </FieldSet>

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("logistics.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />

                <FieldGroup className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
                    <NumberInput
                        control={control}
                        name="deliveries"
                        isPending={isPending}
                        label={t("logistics.fields.deliveries.label")}
                        placeholder={t("logistics.fields.deliveries.placeholder")}
                    />

                    <NumberInput
                        control={control}
                        name="expectedTrucks"
                        isPending={isPending}
                        label={t("logistics.fields.expectedTrucks.label")}
                        placeholder={t("logistics.fields.expectedTrucks.placeholder")}
                    />

                    <SelectInput
                        control={control}
                        name="shipperCurrency"
                        isPending={isPending}
                        label={t("logistics.fields.currency.label")}
                        placeholder={t("logistics.fields.currency.placeholder")}
                        description={t("logistics.fields.currency.description")}
                    >
                        {CURRENCY.map((item) => (
                            <SelectItem key={item} value={item}>{tv(`currency.${item}`)}</SelectItem>
                        ))}
                    </SelectInput>
                </FieldGroup>
            </FieldSet>
        </FieldGroup>
    )
}
