"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconCancel, IconCheck, IconLoader2 } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";

import { TextInput } from "@workspace/ui/inputs/text";
import { Button } from "@workspace/ui/components/button";
import { LocationInput } from "@workspace/ui/inputs/location";
import { FieldGroup } from "@workspace/ui/components/field";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";

import { useTRPC } from "@/backend/api/client";
import { domainErrorCode } from "@/lib/trpc-error";
import type { OrganizationType, OrgOption } from "@/backend/api/routers/organizations";
import { RegisterOrganizationSchema, type RegisterOrganizationForm } from "@/backend/schemas/register-organization";

const ERROR_MESSAGE_KEYS = {
    "INVALID": "invalid",
    "UNAUTHORIZED": "unauthorized",
    "DUPLICATE_NUIT": "duplicateNuit",
    "DUPLICATE_EMAIL": "duplicateEmail",
    "DUPLICATE_PHONE": "duplicatePhone",
    "UNKNOWN": "unknown",
} as const;

type OrganizationErrorCode = keyof typeof ERROR_MESSAGE_KEYS;

const ORGANIZATION_ERROR_CODES = Object.keys(ERROR_MESSAGE_KEYS) as OrganizationErrorCode[];

const EMPTY_LOCATION = { address: "", placeId: "", country: "", state: "" };

const defaultValues = (name: string): RegisterOrganizationForm => ({
    name,
    nuit: "",
    email: "",
    phone: "",
    billingAddress: { ...EMPTY_LOCATION },
    physicalAddress: { ...EMPTY_LOCATION },
});

export function RegisterOrganizationDialog({
    type,
    initialName,
    open,
    onOpenChange,
    onRegistered,
}: {
    type: OrganizationType;
    initialName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRegistered: (organization: OrgOption) => void;
}) {
    const t = useTranslations("Admin.organization");

    const FormSchema = useMemo(() => RegisterOrganizationSchema(t), [t]);

    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const register = useMutation(trpc.organizations.register.mutationOptions());

    const [checking, setChecking] = useState(false);
    const isPending = register.isPending || checking;
    const [error, setError] = useState<OrganizationErrorCode | null>(null);

    const form = useForm<RegisterOrganizationForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: defaultValues(""),
    });

    // Re-seed the form with the searched name each time the dialog opens
    useEffect(() => {
        if (open) {
            form.reset(defaultValues(initialName));
        }
    }, [open, initialName, form]);

    // Stale submit errors clear on close so a reopened dialog starts clean
    function handleOpenChange(next: boolean) {
        if (!next) setError(null);
        onOpenChange(next);
    }

    async function onSubmit(values: RegisterOrganizationForm) {
        setError(null);

        // Surface duplicates as field errors before inserting; the register
        // mutation's unique-violation mapping stays as the fallback arbiter
        setChecking(true);
        try {
            const conflicts = await queryClient.fetchQuery(
                trpc.organizations.validate.queryOptions({
                    nuit: values.nuit,
                    email: values.email,
                    phone: values.phone,
                }),
            );

            let hasConflict = false;

            if (conflicts.hasNuit) {
                form.setError("nuit", { message: t("register.errors.duplicateNuit") });
                hasConflict = true;
            }
            if (conflicts.hasEmail) {
                form.setError("email", { message: t("register.errors.duplicateEmail") });
                hasConflict = true;
            }
            if (conflicts.hasPhone) {
                form.setError("phone", { message: t("register.errors.duplicatePhone") });
                hasConflict = true;
            }

            if (hasConflict) {
                return;
            }
        } catch {
            // Validation is best-effort; the insert still enforces uniqueness
        } finally {
            setChecking(false);
        }

        register.mutate(
            { ...values, type },
            {
                onSuccess: (organization) => onRegistered(organization),
                onError: (err) => setError(domainErrorCode(err, ORGANIZATION_ERROR_CODES, "UNKNOWN")),
            },
        );
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t(`register.title.${type}`)}</DialogTitle>
                    <DialogDescription>{t("register.description")}</DialogDescription>
                </DialogHeader>

                <form id="register-organization-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        <TextInput
                            name="name"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.name.label")}
                            placeholder={t("register.fields.name.placeholder")}
                        />
                        <TextInput
                            name="nuit"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.nuit.label")}
                            placeholder={t("register.fields.nuit.placeholder")}
                        />
                        <TextInput
                            name="email"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.email.label")}
                            placeholder={t("register.fields.email.placeholder")}
                        />
                        <TextInput
                            name="phone"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.phone.label")}
                            placeholder={t("register.fields.phone.placeholder")}
                        />
                        <LocationInput
                            name="billingAddress.address"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.billingAddress.label")}
                            placeholder={t("register.fields.billingAddress.placeholder")}
                            setPlaceId={(value) => form.setValue("billingAddress.placeId", value, { shouldDirty: true })}
                            setCountry={(value) => form.setValue("billingAddress.country", value, { shouldDirty: true })}
                            setState={(value) => form.setValue("billingAddress.state", value, { shouldDirty: true })}
                        />
                        <LocationInput
                            name="physicalAddress.address"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.physicalAddress.label")}
                            placeholder={t("register.fields.physicalAddress.placeholder")}
                            setPlaceId={(value) => form.setValue("physicalAddress.placeId", value, { shouldDirty: true })}
                            setCountry={(value) => form.setValue("physicalAddress.country", value, { shouldDirty: true })}
                            setState={(value) => form.setValue("physicalAddress.state", value, { shouldDirty: true })}
                        />
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
                        form="register-organization-form"
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
