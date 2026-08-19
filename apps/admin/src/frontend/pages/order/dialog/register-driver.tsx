"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconCancel, IconCheck, IconLoader2 } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";

import { TextInput } from "@workspace/ui/inputs/text";
import { Button } from "@workspace/ui/components/button";
import { FieldGroup } from "@workspace/ui/components/field";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";

import { useTRPC } from "@/backend/api/client";
import { domainErrorCode } from "@/lib/trpc-error";
import type { DriverOption } from "@/backend/api/routers/fleet";
import { RegisterDriverSchema, type RegisterDriverForm } from "@/backend/schemas/register-driver";

const ERROR_MESSAGE_KEYS = {
    "INVALID": "invalid",
    "UNAUTHORIZED": "unauthorized",
    "DUPLICATE_EMAIL": "duplicateEmail",
    "DUPLICATE_PHONE": "duplicatePhone",
    "UNKNOWN": "unknown",
} as const;

type DriverErrorCode = keyof typeof ERROR_MESSAGE_KEYS;

const DRIVER_ERROR_CODES = Object.keys(ERROR_MESSAGE_KEYS) as DriverErrorCode[];

export function RegisterDriverDialog({
    carrierId,
    initialName,
    open,
    onOpenChange,
    onRegistered,
}: {
    carrierId: string;
    initialName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRegistered: (driver: DriverOption) => void;
}) {
    const t = useTranslations("Admin.driver");

    const FormSchema = useMemo(() => RegisterDriverSchema(t), [t]);

    const trpc = useTRPC();
    const register = useMutation(trpc.fleet.registerDriver.mutationOptions());

    const isPending = register.isPending;
    const [error, setError] = useState<DriverErrorCode | null>(null);

    const form = useForm<RegisterDriverForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: { name: "", email: "", phoneNumber: "", passport: "" },
    });

    // Re-seed the form with the searched name each time the dialog opens
    useEffect(() => {
        if (open) {
            form.reset({ name: initialName, email: "", phoneNumber: "", passport: "" });
        }
    }, [open, initialName, form]);

    // Stale submit errors clear on close so a reopened dialog starts clean
    function handleOpenChange(next: boolean) {
        if (!next) setError(null);
        onOpenChange(next);
    }

    function onSubmit(values: RegisterDriverForm) {
        setError(null);

        register.mutate(
            { ...values, carrierId },
            {
                onSuccess: (driver) => onRegistered(driver),
                onError: (err) => setError(domainErrorCode(err, DRIVER_ERROR_CODES, "UNKNOWN")),
            },
        );
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("register.title")}</DialogTitle>
                    <DialogDescription>{t("register.description")}</DialogDescription>
                </DialogHeader>

                <form id="register-driver-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        <TextInput
                            name="name"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.name.label")}
                            placeholder={t("register.fields.name.placeholder")}
                        />
                        <TextInput
                            name="email"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.email.label")}
                            placeholder={t("register.fields.email.placeholder")}
                        />
                        <TextInput
                            name="phoneNumber"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.phone.label")}
                            placeholder={t("register.fields.phone.placeholder")}
                        />
                        <TextInput
                            name="passport"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.passport.label")}
                            placeholder={t("register.fields.passport.placeholder")}
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
                        form="register-driver-form"
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
