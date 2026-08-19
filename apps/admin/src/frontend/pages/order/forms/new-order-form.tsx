import { useFormContext } from "react-hook-form";

import { useTranslations } from "@workspace/i18n";
import { CATEGORIES, CURRENCY, FISCAL_REGIME, LOAD_TYPE, LOADING_BAY, ROUTE_TYPE, TRIP_TYPE, TRUCK_AGE, WEIGHT_UNIT } from "@workspace/db/types";

import { DateInput } from "@workspace/ui/inputs/date";
import { TextInput } from "@workspace/ui/inputs/text";
import { NumberInput } from "@workspace/ui/inputs/number";
import { SelectInput } from "@workspace/ui/inputs/select";
import { WeightInput } from "@workspace/ui/inputs/weight";
import { DecimalInput } from "@workspace/ui/inputs/decimal";
import { SelectItem } from "@workspace/ui/components/select";
import { LocationInput } from "@workspace/ui/inputs/location";
import { TextAreaInput } from "@workspace/ui/inputs/textarea";
import { FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldTitle } from "@workspace/ui/components/field";

import { FleetInput } from "@/components/inputs/fleet";
import { DriverInput } from "@/components/inputs/driver";
import { OrganizationInput } from "@/components/inputs/organization";
import { KycGateBanner } from "@/frontend/pages/order/components/kyc-gate-banner";
import { truckAgeFromYear } from "@/lib/fleet";
import { CreateOrderForm, CreateOrderFormInput } from "@/backend/schemas/order";

type FormProps = {
    isPending: boolean
}

const EARLIEST_DATE = new Date(new Date().getFullYear(), 0, 1);

export function NewOrderForm({ isPending }: FormProps) {
    const t = useTranslations("Admin.order.create.form")
    const { control, setValue, watch } = useFormContext<CreateOrderForm, unknown, CreateOrderFormInput>()

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
                        description={t("carrier.fields.carrier.description")}
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
                                description={t("carrier.fields.driver.name.description")}
                                isPending={isPending}
                                carrierId={watch("carrierId")}
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
                                carrierId={watch("carrierId")}
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
                                    carrierId={watch("carrierId")}
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
                                    carrierId={watch("carrierId")}
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
            </FieldSet>

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("payment.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />
                <FieldGroup>
                    <FieldSet>
                        <FieldLegend>
                            <FieldTitle>{t("payment.fields.carrier.title")}</FieldTitle>
                        </FieldLegend>
                        <FieldGroup>
                            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                                <DecimalInput
                                    control={control}
                                    name="carrierSubtotal"
                                    label={t("payment.fields.carrier.subtotal.label")}
                                    placeholder={t("payment.fields.carrier.subtotal.placeholder")}
                                    isPending={isPending}
                                />

                                <DecimalInput
                                    control={control}
                                    name="carrierVAT"
                                    label={t("payment.fields.carrier.vat.label")}
                                    placeholder={t("payment.fields.carrier.vat.placeholder")}
                                    isPending
                                />
                            </FieldGroup>

                            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                                <DecimalInput
                                    control={control}
                                    name="carrierTotal"
                                    label={t("payment.fields.carrier.total.label")}
                                    placeholder={t("payment.fields.carrier.total.placeholder")}
                                    isPending={isPending}
                                />

                                <SelectInput
                                    control={control}
                                    name="carrierCurrency"
                                    label={t("payment.fields.carrier.currency.label")}
                                    placeholder={t("payment.fields.carrier.currency.placeholder")}
                                    isPending={isPending}
                                >
                                    {CURRENCY.map((item, index) => <SelectItem key={index} value={item}>{t(`payment.fields.carrier.currency.options.${item}`)}</SelectItem>)}
                                </SelectInput>
                            </FieldGroup>
                        </FieldGroup>
                    </FieldSet>

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
                </FieldGroup>
            </FieldSet>
        </FieldGroup>
    )
}
