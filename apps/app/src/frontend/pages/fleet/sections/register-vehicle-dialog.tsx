"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconCancel, IconCheck, IconLoader2 } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { LOADING_BAY, TRUCK_TYPE, YEARS } from "@workspace/db/types";

import { TextInput } from "@workspace/ui/inputs/text";
import { SelectInput } from "@workspace/ui/inputs/select";
import { DecimalInput } from "@workspace/ui/inputs/decimal";
import { Button } from "@workspace/ui/components/button";
import { SelectItem } from "@workspace/ui/components/select";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { FieldGroup, FieldSet, FieldLegend, FieldTitle } from "@workspace/ui/components/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";

import { domainErrorCode } from "@workspace/trpc/errors";
import { useFleetMutations } from "@/frontend/pages/fleet/hooks/use-fleet-mutations";
import type { VehicleOption } from "@/frontend/pages/fleet/server/procedures";
import {
    RegisterVehicleSchema,
    type RegisterTruckForm,
    type RegisterVehicleFormInput,
    type VehicleKind,
} from "@/backend/schemas/register-fleet";

const ERROR_MESSAGE_KEYS = {
    "INVALID": "invalid",
    "UNAUTHORIZED": "unauthorized",
    "NOT_ALLOWED": "notAllowed",
    "DUPLICATE_PLATE": "duplicatePlate",
    "DUPLICATE_VIN": "duplicateVin",
    "PLATE_UNAVAILABLE": "plateUnavailable",
    "VIN_UNAVAILABLE": "vinUnavailable",
    "UNKNOWN": "unknown",
} as const;

type VehicleErrorCode = keyof typeof ERROR_MESSAGE_KEYS;

const VEHICLE_ERROR_CODES = Object.keys(ERROR_MESSAGE_KEYS) as VehicleErrorCode[];

// Mozambican plates: trucks carry a 3-letter prefix, towed units 2 letters
const PLATE_MASK: Record<VehicleKind, string> = {
    truck: "AAA 999 AA",
    trailer: "AA 999 AA",
    link: "AA 999 AA",
};

// Latest years first in the dropdown
const YEAR_OPTIONS = [...YEARS].reverse();

const defaultValues = (plate: string): RegisterVehicleFormInput => ({
    regPlate: plate,
    internalId: "",
    brand: "",
    model: "",
    year: undefined as never,
    vin: "",
    type: undefined as never,
    loadingBay: undefined,
});

/**
 * Registers a vehicle into the signed-in carrier's own fleet. Unlike the
 * Admin dialog this one asks for no carrier: the tenant is the carrier, and
 * the procedure takes it from the gate rather than from the form.
 */
export function RegisterVehicleDialog({
    kind,
    initialPlate = "",
    open,
    onOpenChange,
    onRegistered,
}: {
    kind: VehicleKind;
    initialPlate?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRegistered?: (vehicle: VehicleOption) => void;
}) {
    const t = useTranslations("App.fleet");

    const FormSchema = useMemo(() => RegisterVehicleSchema(kind, t), [kind, t]);

    const { registerVehicle } = useFleetMutations();

    const isPending = registerVehicle.isPending;
    const [error, setError] = useState<VehicleErrorCode | null>(null);

    const form = useForm<RegisterVehicleFormInput, unknown, RegisterTruckForm>({
        // The trailer/link schema omits `type`; structurally compatible at runtime
        resolver: zodResolver(FormSchema) as Resolver<RegisterVehicleFormInput, unknown, RegisterTruckForm>,
        defaultValues: defaultValues(initialPlate),
    });

    // Re-seed the form with the searched plate each time the dialog opens
    useEffect(() => {
        if (open) {
            form.reset(defaultValues(initialPlate));
        }
    }, [open, kind, initialPlate, form]);

    // Stale submit errors clear on close so a reopened dialog starts clean
    function handleOpenChange(next: boolean) {
        if (!next) setError(null);
        onOpenChange(next);
    }

    const truckType = useWatch({ control: form.control, name: "type" });
    const showLoadingBay = kind !== "truck" || truckType === "non-articulated";

    function onSubmit(values: RegisterTruckForm) {
        setError(null);

        const callbacks = {
            onSuccess: (vehicle: VehicleOption) => {
                onRegistered?.(vehicle);
                onOpenChange(false);
            },
            onError: (err: unknown) => setError(domainErrorCode(err, VEHICLE_ERROR_CODES, "UNKNOWN")),
        };

        if (kind === "truck") {
            registerVehicle.mutate({ ...values, kind: "truck" }, callbacks);
            return;
        }

        // The towed schemas validated the bay as required
        if (!values.loadingBay) {
            setError("INVALID");
            return;
        }

        registerVehicle.mutate(
            { ...values, kind, type: undefined, loadingBay: values.loadingBay },
            callbacks,
        );
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t(`register.title.${kind}`)}</DialogTitle>
                    <DialogDescription>{t("register.description")}</DialogDescription>
                </DialogHeader>

                <form
                    id="register-vehicle-form"
                    onSubmit={(event) => {
                        // The dialog renders in a portal, so React bubbles this
                        // submit to any form that opened it and would submit
                        // that one too
                        event.stopPropagation();
                        void form.handleSubmit(onSubmit)(event);
                    }}
                >
                    <FieldGroup className="gap-4">
                        <TextInput
                            name="regPlate"
                            control={form.control}
                            isPending={isPending}
                            hasInputMask
                            inputMask={PLATE_MASK[kind]}
                            label={t("register.fields.plate.label")}
                            placeholder={t("register.fields.plate.placeholder")}
                        />
                        <TextInput
                            name="internalId"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.internalId.label")}
                            placeholder={t("register.fields.internalId.placeholder")}
                        />
                        <TextInput
                            name="brand"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.brand.label")}
                            placeholder={t("register.fields.brand.placeholder")}
                        />
                        <TextInput
                            name="model"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.model.label")}
                            placeholder={t("register.fields.model.placeholder")}
                        />
                        <SelectInput
                            name="year"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.year.label")}
                            placeholder={t("register.fields.year.placeholder")}
                        >
                            {YEAR_OPTIONS.map((year) => (
                                <SelectItem key={year} value={year}>{year}</SelectItem>
                            ))}
                        </SelectInput>
                        <TextInput
                            name="vin"
                            control={form.control}
                            isPending={isPending}
                            hasPattern
                            pattern="^[A-HJ-NPR-Z0-9]{17}$"
                            regex={/[^a-zA-Z0-9]/g}
                            length={17}
                            label={t("register.fields.vin.label")}
                            placeholder={t("register.fields.vin.placeholder")}
                        />

                        {kind === "truck" && (
                            <SelectInput
                                name="type"
                                control={form.control}
                                isPending={isPending}
                                label={t("register.fields.type.label")}
                                placeholder={t("register.fields.type.placeholder")}
                                description={t("register.fields.type.description")}
                            >
                                {TRUCK_TYPE.map((type) => (
                                    <SelectItem key={type} value={type}>
                                        {t(`register.fields.type.options.${type}`)}
                                    </SelectItem>
                                ))}
                            </SelectInput>
                        )}

                        {showLoadingBay && (
                            <FieldSet>
                                <FieldLegend variant="label">
                                    <FieldTitle>{t("register.fields.bay.title")}</FieldTitle>
                                </FieldLegend>
                                <FieldGroup className="gap-4">
                                    <SelectInput
                                        name="loadingBay.type"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("register.fields.bay.type.label")}
                                        placeholder={t("register.fields.bay.type.placeholder")}
                                    >
                                        {LOADING_BAY.map((bay) => (
                                            <SelectItem key={bay} value={bay}>
                                                {t(`register.fields.bay.type.options.${bay}`)}
                                            </SelectItem>
                                        ))}
                                    </SelectInput>

                                    <div className="grid grid-cols-2 gap-4">
                                        <DecimalInput
                                            name="loadingBay.width"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("register.fields.bay.width.label")}
                                            placeholder={t("register.fields.bay.width.placeholder")}
                                        />
                                        <DecimalInput
                                            name="loadingBay.length"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("register.fields.bay.length.label")}
                                            placeholder={t("register.fields.bay.length.placeholder")}
                                        />
                                        <DecimalInput
                                            name="loadingBay.height"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("register.fields.bay.height.label")}
                                            placeholder={t("register.fields.bay.height.placeholder")}
                                        />
                                        <DecimalInput
                                            name="loadingBay.volume"
                                            control={form.control}
                                            isPending={isPending}
                                            label={t("register.fields.bay.volume.label")}
                                            placeholder={t("register.fields.bay.volume.placeholder")}
                                        />
                                    </div>

                                    <DecimalInput
                                        name="loadingBay.capacity"
                                        control={form.control}
                                        isPending={isPending}
                                        label={t("register.fields.bay.capacity.label")}
                                        placeholder={t("register.fields.bay.capacity.placeholder")}
                                    />
                                </FieldGroup>
                            </FieldSet>
                        )}
                    </FieldGroup>
                </form>

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{t(`register.errors.${ERROR_MESSAGE_KEYS[error]}`)}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter>
                    <Button
                        type="submit"
                        form="register-vehicle-form"
                        disabled={isPending}
                    >
                        {isPending ? <IconLoader2 className="animate-spin" /> : <IconCheck />}
                        {isPending ? t("register.actions.saving") : t("register.actions.save")}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => onOpenChange(false)}
                    >
                        <IconCancel />
                        {t("register.actions.cancel")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
