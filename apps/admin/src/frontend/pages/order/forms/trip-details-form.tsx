import { useFormContext } from "react-hook-form";

import { useTranslations } from "@workspace/i18n";

import { DateInput } from "@workspace/ui/inputs/date";
import { NumberInput } from "@workspace/ui/inputs/number";
import { DecimalInput } from "@workspace/ui/inputs/decimal";
import { CheckboxInput } from "@workspace/ui/inputs/checkbox";
import { FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldTitle } from "@workspace/ui/components/field";

import { UpdateOrderForm, UpdateOrderFormInput } from "@/backend/schemas/order";

type FormProps = {
    isPending: boolean
}

// Stored orders reach back to previous years; keep their dates selectable
const EARLIEST_DATE = new Date(2020, 0, 1);

type Stage = "loading" | "offloading";

function StageFields({ stage, isPending }: { stage: Stage; isPending: boolean }) {
    const t = useTranslations("Admin.order.update.form")
    const { control } = useFormContext<UpdateOrderFormInput, unknown, UpdateOrderForm>()

    // Column names capitalize the stage ("arrivalAtLoading")
    const suffix = stage === "loading" ? "Loading" : "Offloading";

    return (
        <FieldSet>
            <FieldLegend>
                <FieldTitle>{t(`${stage}.title`)}</FieldTitle>
            </FieldLegend>
            <FieldSeparator />
            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                <DateInput
                    control={control}
                    name={`proposed${suffix}Date`}
                    value={EARLIEST_DATE}
                    label={t(`${stage}.fields.proposedDate.label`)}
                    placeholder={t(`${stage}.fields.proposedDate.placeholder`)}
                    isPending={isPending}
                />

                <DateInput
                    control={control}
                    name={`arrivalAt${suffix}`}
                    value={EARLIEST_DATE}
                    label={t(`${stage}.fields.arrival.label`)}
                    placeholder={t(`${stage}.fields.arrival.placeholder`)}
                    isPending={isPending}
                />

                <DateInput
                    control={control}
                    name={`actual${suffix}Date`}
                    value={EARLIEST_DATE}
                    label={t(`${stage}.fields.actualDate.label`)}
                    placeholder={t(`${stage}.fields.actualDate.placeholder`)}
                    isPending={isPending}
                />

                <DateInput
                    control={control}
                    name={`departure${suffix}Date`}
                    value={EARLIEST_DATE}
                    label={t(`${stage}.fields.departure.label`)}
                    placeholder={t(`${stage}.fields.departure.placeholder`)}
                    isPending={isPending}
                />

                <CheckboxInput
                    control={control}
                    name={`demurrageChargedAt${suffix}`}
                    label={t(`${stage}.fields.demurrageCharged.label`)}
                    isPending={isPending}
                />

                <NumberInput
                    control={control}
                    name={`demurrageChargedDaysAt${suffix}`}
                    label={t(`${stage}.fields.demurrageChargedDays.label`)}
                    placeholder={t(`${stage}.fields.demurrageChargedDays.placeholder`)}
                    isPending={isPending}
                />
            </FieldGroup>
        </FieldSet>
    )
}

export function TripDetailsForm({ isPending }: FormProps) {
    const t = useTranslations("Admin.order.update.form")
    const { control } = useFormContext<UpdateOrderFormInput, unknown, UpdateOrderForm>()

    return (
        <FieldGroup>
            <StageFields stage="loading" isPending={isPending} />
            <StageFields stage="offloading" isPending={isPending} />

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("border.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />
                <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                    <DateInput
                        control={control}
                        name="arrivalAtBorder"
                        value={EARLIEST_DATE}
                        label={t("border.fields.arrival.label")}
                        placeholder={t("border.fields.arrival.placeholder")}
                        isPending={isPending}
                    />

                    <DateInput
                        control={control}
                        name="departureFromBorder"
                        value={EARLIEST_DATE}
                        label={t("border.fields.departure.label")}
                        placeholder={t("border.fields.departure.placeholder")}
                        isPending={isPending}
                    />

                    <CheckboxInput
                        control={control}
                        name="demurrageChargedAtBorder"
                        label={t("border.fields.demurrageCharged.label")}
                        isPending={isPending}
                    />

                    <NumberInput
                        control={control}
                        name="demurrageChargedDaysAtBorder"
                        label={t("border.fields.demurrageChargedDays.label")}
                        placeholder={t("border.fields.demurrageChargedDays.placeholder")}
                        isPending={isPending}
                    />
                </FieldGroup>
            </FieldSet>

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("cargo.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />
                <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                    <DecimalInput
                        control={control}
                        name="loadedWeight"
                        label={t("cargo.fields.loadedWeight.label")}
                        placeholder={t("cargo.fields.loadedWeight.placeholder")}
                        isPending={isPending}
                    />

                    <DecimalInput
                        control={control}
                        name="offloadedWeight"
                        label={t("cargo.fields.offloadedWeight.label")}
                        placeholder={t("cargo.fields.offloadedWeight.placeholder")}
                        isPending={isPending}
                    />
                </FieldGroup>
            </FieldSet>

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("incidents.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />
                <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                    <NumberInput
                        control={control}
                        name="numberOfMechanicalFailuresStops"
                        label={t("incidents.fields.mechanicalFailuresStops.label")}
                        placeholder={t("incidents.fields.mechanicalFailuresStops.placeholder")}
                        isPending={isPending}
                    />

                    <NumberInput
                        control={control}
                        name="totalMechanicalFailuresDelayedDays"
                        label={t("incidents.fields.mechanicalFailuresDelayedDays.label")}
                        placeholder={t("incidents.fields.mechanicalFailuresDelayedDays.placeholder")}
                        isPending={isPending}
                    />

                    <NumberInput
                        control={control}
                        name="numberOfDocumentationIssuesStops"
                        label={t("incidents.fields.documentationIssuesStops.label")}
                        placeholder={t("incidents.fields.documentationIssuesStops.placeholder")}
                        isPending={isPending}
                    />

                    <NumberInput
                        control={control}
                        name="totalDocumentationIssuesDelayedDays"
                        label={t("incidents.fields.documentationIssuesDelayedDays.label")}
                        placeholder={t("incidents.fields.documentationIssuesDelayedDays.placeholder")}
                        isPending={isPending}
                    />

                    <NumberInput
                        control={control}
                        name="numberOfPoliceStops"
                        label={t("incidents.fields.policeStops.label")}
                        placeholder={t("incidents.fields.policeStops.placeholder")}
                        isPending={isPending}
                    />

                    <NumberInput
                        control={control}
                        name="totalPoliceDelayedDays"
                        label={t("incidents.fields.policeDelayedDays.label")}
                        placeholder={t("incidents.fields.policeDelayedDays.placeholder")}
                        isPending={isPending}
                    />

                    <NumberInput
                        control={control}
                        name="numberAccidents"
                        label={t("incidents.fields.accidents.label")}
                        placeholder={t("incidents.fields.accidents.placeholder")}
                        isPending={isPending}
                    />

                    <DecimalInput
                        control={control}
                        name="damagedPercent"
                        label={t("incidents.fields.damagedPercent.label")}
                        placeholder={t("incidents.fields.damagedPercent.placeholder")}
                        isPending={isPending}
                    />

                    <CheckboxInput
                        control={control}
                        name="cargoDamaged"
                        label={t("incidents.fields.cargoDamaged.label")}
                        isPending={isPending}
                    />

                    <CheckboxInput
                        control={control}
                        name="claimed"
                        label={t("incidents.fields.claimed.label")}
                        isPending={isPending}
                    />
                </FieldGroup>
            </FieldSet>

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("costs.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />
                <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                    <DecimalInput
                        control={control}
                        name="ageFactor"
                        label={t("costs.fields.ageFactor.label")}
                        placeholder={t("costs.fields.ageFactor.placeholder")}
                        isPending={isPending}
                    />

                    <DecimalInput
                        control={control}
                        name="loadFactor"
                        label={t("costs.fields.loadFactor.label")}
                        placeholder={t("costs.fields.loadFactor.placeholder")}
                        isPending={isPending}
                    />

                    <DecimalInput
                        control={control}
                        name="defaultCoefficient"
                        label={t("costs.fields.defaultCoefficient.label")}
                        placeholder={t("costs.fields.defaultCoefficient.placeholder")}
                        isPending={isPending}
                    />

                    <DecimalInput
                        control={control}
                        name="costPerKm"
                        label={t("costs.fields.costPerKm.label")}
                        placeholder={t("costs.fields.costPerKm.placeholder")}
                        isPending={isPending}
                    />

                    <DecimalInput
                        control={control}
                        name="costPerUnit"
                        label={t("costs.fields.costPerUnit.label")}
                        placeholder={t("costs.fields.costPerUnit.placeholder")}
                        isPending={isPending}
                    />

                    <DecimalInput
                        control={control}
                        name="costPerUnitKm"
                        label={t("costs.fields.costPerUnitKm.label")}
                        placeholder={t("costs.fields.costPerUnitKm.placeholder")}
                        isPending={isPending}
                    />

                    <DecimalInput
                        control={control}
                        name="totalFuelCost"
                        label={t("costs.fields.totalFuelCost.label")}
                        placeholder={t("costs.fields.totalFuelCost.placeholder")}
                        isPending={isPending}
                    />
                </FieldGroup>
            </FieldSet>
        </FieldGroup>
    )
}
