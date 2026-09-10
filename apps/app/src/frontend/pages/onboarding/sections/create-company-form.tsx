"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconArrowLeft, IconBuildingPlus } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";

import { TextInput } from "@workspace/ui/inputs/text";
import { Button } from "@workspace/ui/components/button";
import { LocationInput } from "@workspace/ui/inputs/location";
import { FieldGroup } from "@workspace/ui/components/field";
import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@workspace/ui/components/card";

import { useTRPC } from "@/backend/api/client";
import { domainErrorCode } from "@workspace/trpc/errors";
import { CreateCompanySchema, type CreateCompanyForm } from "@/frontend/pages/onboarding/types";

const ERROR_MESSAGE_KEYS = {
    "ALREADY_MEMBER": "alreadyMember",
    "EMAIL_UNVERIFIED": "emailUnverified",
    "DUPLICATE_NUIT": "duplicateNuit",
    "DUPLICATE_EMAIL": "duplicateEmail",
    "DUPLICATE_PHONE": "duplicatePhone",
    "UNKNOWN": "unknown",
} as const;

type CreateErrorCode = keyof typeof ERROR_MESSAGE_KEYS;

const CREATE_ERROR_CODES = Object.keys(ERROR_MESSAGE_KEYS) as CreateErrorCode[];

const EMPTY_LOCATION = { address: "", placeId: "", country: "", state: "" };

/**
 * Registration of a company nobody had yet. The type is not asked for: it
 * is the account's own (`user.type`), decided at sign-up and re-read
 * server-side.
 */
export function CreateCompanyForm({
    nuit,
    onBack,
    onRegistered,
}: {
    nuit: string;
    onBack: () => void;
    onRegistered: (organizationId: string) => void;
}) {
    const t = useTranslations("App.onboarding")
    const trpc = useTRPC()

    const [error, setError] = useState<CreateErrorCode | null>(null)

    const create = useMutation(trpc.onboarding.createOrganization.mutationOptions())

    const FormSchema = useMemo(() => CreateCompanySchema(t), [t])

    const form = useForm<CreateCompanyForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            name: "",
            nuit,
            email: "",
            phone: "",
            billingAddress: { ...EMPTY_LOCATION },
            physicalAddress: { ...EMPTY_LOCATION },
        },
    })

    const isPending = create.isPending

    function onSubmit(values: CreateCompanyForm) {
        setError(null)

        create.mutate(values, {
            onSuccess: ({ organizationId }) => onRegistered(organizationId),
            onError: (err) => setError(domainErrorCode(err, CREATE_ERROR_CODES, "UNKNOWN")),
        })
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("create.title")}</CardTitle>
                <CardDescription>{t("create.description")}</CardDescription>
            </CardHeader>

            <CardContent className="grid gap-4">
                {error && (
                    <Alert variant="destructive">
                        <AlertTitle>{t(`errors.${ERROR_MESSAGE_KEYS[error]}`)}</AlertTitle>
                    </Alert>
                )}

                <form id="create-company-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        <TextInput
                            name="name"
                            control={form.control}
                            isPending={isPending}
                            label={t("create.fields.name.label")}
                            placeholder={t("create.fields.name.placeholder")}
                        />
                        <TextInput
                            name="nuit"
                            control={form.control}
                            isPending={isPending}
                            label={t("create.fields.nuit.label")}
                            placeholder={t("create.fields.nuit.placeholder")}
                        />
                        <TextInput
                            name="email"
                            control={form.control}
                            isPending={isPending}
                            label={t("create.fields.email.label")}
                            placeholder={t("create.fields.email.placeholder")}
                            description={t("create.fields.email.description")}
                        />
                        <TextInput
                            name="phone"
                            control={form.control}
                            isPending={isPending}
                            label={t("create.fields.phone.label")}
                            placeholder={t("create.fields.phone.placeholder")}
                        />
                        <LocationInput
                            name="billingAddress.address"
                            control={form.control}
                            isPending={isPending}
                            label={t("create.fields.billingAddress.label")}
                            placeholder={t("create.fields.billingAddress.placeholder")}
                            setPlaceId={(value) => form.setValue("billingAddress.placeId", value, { shouldDirty: true })}
                            setCountry={(value) => form.setValue("billingAddress.country", value, { shouldDirty: true })}
                            setState={(value) => form.setValue("billingAddress.state", value, { shouldDirty: true })}
                        />
                        <LocationInput
                            name="physicalAddress.address"
                            control={form.control}
                            isPending={isPending}
                            label={t("create.fields.physicalAddress.label")}
                            placeholder={t("create.fields.physicalAddress.placeholder")}
                            setPlaceId={(value) => form.setValue("physicalAddress.placeId", value, { shouldDirty: true })}
                            setCountry={(value) => form.setValue("physicalAddress.country", value, { shouldDirty: true })}
                            setState={(value) => form.setValue("physicalAddress.state", value, { shouldDirty: true })}
                        />
                    </FieldGroup>
                </form>
            </CardContent>

            <CardFooter className="gap-2">
                <Button type="submit" form="create-company-form" disabled={isPending}>
                    <IconBuildingPlus />
                    {isPending ? t("create.submitting") : t("create.submit")}
                </Button>
                <Button type="button" variant="outline" disabled={isPending} onClick={onBack}>
                    <IconArrowLeft />
                    {t("create.back")}
                </Button>
            </CardFooter>
        </Card>
    )
}
