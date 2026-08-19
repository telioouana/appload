import { useFormContext } from "react-hook-form";

import { useTranslations } from "@workspace/i18n";
import { CATEGORIES, FISCAL_REGIME, LOAD_TYPE, ORDER_STATUS, PACKING, POD_STATUS, ROUTE_TYPE, TRIP_TYPE, TRUCK_AGE, WEIGHT_UNIT } from "@workspace/db/types";

import { DateInput } from "@workspace/ui/inputs/date";
import { TextInput } from "@workspace/ui/inputs/text";
import { NumberInput } from "@workspace/ui/inputs/number";
import { SelectInput } from "@workspace/ui/inputs/select";
import { WeightInput } from "@workspace/ui/inputs/weight";
import { DecimalInput } from "@workspace/ui/inputs/decimal";
import { SelectItem } from "@workspace/ui/components/select";
import { CheckboxInput } from "@workspace/ui/inputs/checkbox";
import { LocationInput } from "@workspace/ui/inputs/location";
import { TextAreaInput } from "@workspace/ui/inputs/textarea";
import { FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldTitle } from "@workspace/ui/components/field";

import { FleetInput } from "@/components/inputs/fleet";
import { DriverInput } from "@/components/inputs/driver";
import { OrganizationInput } from "@/components/inputs/organization";
import { KycGateBanner } from "@/frontend/pages/order/components/kyc-gate-banner";
import { truckAgeFromYear } from "@/lib/fleet";
import { UpdateOrderForm, UpdateOrderFormInput } from "@/backend/schemas/order";

type FormProps = {
    isPending: boolean
}

// Stored orders reach back to previous years; keep their dates selectable
const EARLIEST_DATE = new Date(2020, 0, 1);

export function OrderUpdateForm({ isPending }: FormProps) {
    const t = useTranslations("Admin.order.update.form")
    const { control, setValue, watch } = useFormContext<UpdateOrderFormInput, unknown, UpdateOrderForm>()

    return (
        <FieldGroup>
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
                        isPending={isPending}
                        setCountry={(value) => setValue(`loadingAddress.country`, value, { shouldDirty: true })}
                        setPlaceId={(value) => setValue(`loadingAddress.placeId`, value, { shouldDirty: true })}
                        setState={(value) => setValue(`loadingAddress.state`, value, { shouldDirty: true })}
                    />

                    <LocationInput
                        control={control}
                        name={`offloadingAddress.address`}
                        label={t("routeDates.fields.offloadingAddress.label")}
                        placeholder={t("routeDates.fields.offloadingAddress.placeholder")}
                        isPending={isPending}
                        setCountry={(value) => setValue(`offloadingAddress.country`, value, { shouldDirty: true })}
                        setPlaceId={(value) => setValue(`offloadingAddress.placeId`, value, { shouldDirty: true })}
                        setState={(value) => setValue(`offloadingAddress.state`, value, { shouldDirty: true })}
                    />

                    <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                        <DateInput
                            name="expectedLoadingDate"
                            control={control}
                            isPending={isPending}
                            value={EARLIEST_DATE}
                            label={t("routeDates.fields.expectedLoadingDate.label")}
                            placeholder={t("routeDates.fields.expectedLoadingDate.placeholder")}
                        />

                        <DateInput
                            name="expectedOffloadingDate"
                            control={control}
                            isPending={isPending}
                            value={EARLIEST_DATE}
                            label={t("routeDates.fields.expectedOffloadingDate.label")}
                            placeholder={t("routeDates.fields.expectedOffloadingDate.placeholder")}
                        />
                    </FieldGroup>

                    <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                        <SelectInput
                            control={control}
                            name="route"
                            label={t("routeDates.fields.route.label")}
                            placeholder={t("routeDates.fields.route.placeholder")}
                            isPending={isPending}
                        >
                            {ROUTE_TYPE.map((item, index) => <SelectItem key={index} value={item}>{t(`routeDates.fields.route.options.${item}`)}</SelectItem>)}
                        </SelectInput>

                        <SelectInput
                            control={control}
                            name="tripType"
                            label={t("routeDates.fields.tripType.label")}
                            placeholder={t("routeDates.fields.tripType.placeholder")}
                            isPending={isPending}
                        >
                            {TRIP_TYPE.map((item, index) => <SelectItem key={index} value={item}>{t(`routeDates.fields.tripType.options.${item}`)}</SelectItem>)}
                        </SelectInput>

                        <NumberInput
                            control={control}
                            name="distance"
                            label={t("routeDates.fields.distance.label")}
                            placeholder={t("routeDates.fields.distance.placeholder")}
                            isPending={isPending}
                        />

                        <NumberInput
                            control={control}
                            name="deliveries"
                            label={t("routeDates.fields.deliveries.label")}
                            placeholder={t("routeDates.fields.deliveries.placeholder")}
                            isPending={isPending}
                        />

                        <NumberInput
                            control={control}
                            name="expectedTrucks"
                            label={t("routeDates.fields.expectedTrucks.label")}
                            placeholder={t("routeDates.fields.expectedTrucks.placeholder")}
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
                            setValue={(value: typeof WEIGHT_UNIT[number]) => setValue("weightUnit", value, { shouldDirty: true })}
                        />

                        <SelectInput
                            control={control}
                            name="packing"
                            label={t("cargo.fields.packing.label")}
                            placeholder={t("cargo.fields.packing.placeholder")}
                            isPending={isPending}
                        >
                            {PACKING.map((item, index) => <SelectItem key={index} value={item}>{t(`cargo.fields.packing.options.${item}`)}</SelectItem>)}
                        </SelectInput>

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

                    <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                        <CheckboxInput
                            control={control}
                            name="isHazardous"
                            label={t("cargo.fields.isHazardous.label")}
                            isPending={isPending}
                        />

                        <TextInput
                            control={control}
                            name="hazchemCode"
                            label={t("cargo.fields.hazchemCode.label")}
                            placeholder={t("cargo.fields.hazchemCode.placeholder")}
                            isPending={isPending}
                        />
                    </FieldGroup>

                    <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                        <CheckboxInput
                            control={control}
                            name="isRefrigerated"
                            label={t("cargo.fields.isRefrigerated.label")}
                            isPending={isPending}
                        />

                        <DecimalInput
                            control={control}
                            name="temperature"
                            label={t("cargo.fields.temperature.label")}
                            placeholder={t("cargo.fields.temperature.placeholder")}
                            isPending={isPending}
                        />
                    </FieldGroup>

                    <TextAreaInput
                        control={control}
                        name="temperatureInstructions"
                        label={t("cargo.fields.temperatureInstructions.label")}
                        placeholder={t("cargo.fields.temperatureInstructions.placeholder")}
                        isPending={isPending}
                    />
                </FieldGroup>
            </FieldSet>

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("status.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />
                <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                    {/* Read-only here: status moves only through the guarded
                        transition flow (order.transition), never a form patch */}
                    <SelectInput
                        control={control}
                        name="status"
                        label={t("status.fields.status.label")}
                        placeholder={t("status.fields.status.placeholder")}
                        isPending={isPending}
                        disabled
                    >
                        {ORDER_STATUS.map((item, index) => <SelectItem key={index} value={item}>{t(`status.fields.status.options.${item}`)}</SelectItem>)}
                    </SelectInput>

                    <SelectInput
                        control={control}
                        name="podStatus"
                        label={t("status.fields.podStatus.label")}
                        placeholder={t("status.fields.podStatus.placeholder")}
                        isPending={isPending}
                    >
                        {POD_STATUS.map((item, index) => <SelectItem key={index} value={item}>{t(`status.fields.podStatus.options.${item}`)}</SelectItem>)}
                    </SelectInput>
                </FieldGroup>
            </FieldSet>

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("carrier.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />
                <FieldGroup>
                    {/* The same verdict the server enforces on booking */}
                    <KycGateBanner
                        carrierId={watch("carrierId")}
                        driverId={watch("driverId")}
                        truckPlate={watch("truckPlate")}
                        trailerPlate={watch("trailerPlate")}
                        linkPlate={watch("linkPlate")}
                    />

                    <OrganizationInput
                        control={control}
                        name="carrierName"
                        label={t("carrier.fields.carrier.label")}
                        placeholder={t("carrier.fields.carrier.placeholder")}
                        isPending={isPending}
                        orgType="carrier"
                        setOrgId={(id) => setValue("carrierId", id, { shouldDirty: true })}
                    />

                    <SelectInput
                        control={control}
                        name="fiscalRegime"
                        label={t("carrier.fields.fiscalRegime.label")}
                        placeholder={t("carrier.fields.fiscalRegime.placeholder")}
                        isPending={isPending}
                    >
                        {FISCAL_REGIME.map((item, index) => <SelectItem key={index} value={item}>{t(`carrier.fields.fiscalRegime.options.${item}`)}</SelectItem>)}
                    </SelectInput>

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
                                isPending={isPending}
                                carrierId={watch("carrierId")}
                                onSelect={(driver) => {
                                    setValue("driverId", driver?.id, { shouldDirty: true })
                                    if (driver?.phoneNumber) {
                                        setValue("driverPhoneNumber", driver.phoneNumber, { shouldDirty: true })
                                    }
                                    if (driver?.passport) {
                                        setValue("driverPassport", driver.passport, { shouldDirty: true })
                                    }
                                }}
                            />

                            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                                <TextInput
                                    control={control}
                                    name="driverPhoneNumber"
                                    label={t("carrier.fields.driver.contact.label")}
                                    placeholder={t("carrier.fields.driver.contact.placeholder")}
                                    isPending={isPending}
                                />

                                <TextInput
                                    control={control}
                                    name="driverPassport"
                                    label={t("carrier.fields.driver.passport.label")}
                                    placeholder={t("carrier.fields.driver.passport.placeholder")}
                                    isPending={isPending}
                                />
                            </FieldGroup>
                        </FieldGroup>
                    </FieldSet>

                    <FieldSet>
                        <FieldLegend>
                            <FieldTitle>{t("carrier.fields.fleet.title")}</FieldTitle>
                        </FieldLegend>
                        <FieldGroup>
                            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                                <FleetInput
                                    control={control}
                                    name="truckPlate"
                                    label={t("carrier.fields.fleet.truck.label")}
                                    placeholder={t("carrier.fields.fleet.truck.placeholder")}
                                    isPending={isPending}
                                    kind="truck"
                                    carrierId={watch("carrierId")}
                                    onSelect={(truck) => {
                                        if (!truck) return
                                        setValue("truckAge", truckAgeFromYear(truck.year), { shouldDirty: true })
                                    }}
                                />

                                <SelectInput
                                    control={control}
                                    name="truckAge"
                                    label={t("carrier.fields.fleet.age.label")}
                                    placeholder={t("carrier.fields.fleet.age.placeholder")}
                                    isPending={isPending}
                                >
                                    {TRUCK_AGE.map((item, index) => <SelectItem key={index} value={item}>{t(`carrier.fields.fleet.age.options.${item}`)}</SelectItem>)}
                                </SelectInput>

                                <FleetInput
                                    control={control}
                                    name="trailerPlate"
                                    label={t("carrier.fields.fleet.trailer.label")}
                                    placeholder={t("carrier.fields.fleet.trailer.placeholder")}
                                    isPending={isPending}
                                    kind="trailer"
                                    carrierId={watch("carrierId")}
                                    onSelect={() => undefined}
                                />

                                <FleetInput
                                    control={control}
                                    name="linkPlate"
                                    label={t("carrier.fields.fleet.link.label")}
                                    placeholder={t("carrier.fields.fleet.link.placeholder")}
                                    isPending={isPending}
                                    kind="link"
                                    carrierId={watch("carrierId")}
                                    onSelect={() => undefined}
                                />
                            </FieldGroup>
                        </FieldGroup>
                    </FieldSet>
                </FieldGroup>
            </FieldSet>
        </FieldGroup>
    )
}
