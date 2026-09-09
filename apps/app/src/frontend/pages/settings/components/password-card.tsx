"use client"

import { z } from "zod";
import { toast } from "sonner";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconKey } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";

import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { PasswordInput } from "@workspace/ui/inputs/password";
import { CheckboxInput } from "@workspace/ui/inputs/checkbox";
import { FieldGroup, FieldSet } from "@workspace/ui/components/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";

import { useTRPC } from "@/backend/api/client";
import { domainErrorCode } from "@/lib/trpc-error";
import { PasswordSchema } from "@/backend/schemas/settings";

// Better Auth's own codes, forwarded by `me.changePassword`
const TOAST_CODES = ["PASSWORD_TOO_SHORT", "PASSWORD_TOO_LONG", "CREDENTIAL_ACCOUNT_NOT_FOUND", "UNKNOWN"] as const
const ERROR_CODES = ["INVALID_PASSWORD", ...TOAST_CODES] as const

export function PasswordCard() {
    const t = useTranslations("App.settings")
    const trpc = useTRPC()

    const change = useMutation(trpc.me.changePassword.mutationOptions())

    const FormSchema = useMemo(() => PasswordSchema(t), [t])
    type TypeSchema = z.infer<typeof FormSchema>

    const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<TypeSchema>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            currentPassword: "",
            newPassword: "",
            confirmPassword: "",
            revokeOtherSessions: true,
        },
    })

    async function onSubmit(data: TypeSchema) {
        try {
            await change.mutateAsync({
                currentPassword: data.currentPassword,
                newPassword: data.newPassword,
                revokeOtherSessions: data.revokeOtherSessions,
            })
        } catch (error) {
            const code = domainErrorCode(error, ERROR_CODES, "UNKNOWN")

            // A wrong current password is the overwhelmingly common failure,
            // and it belongs on the field rather than in a toast
            if (code === "INVALID_PASSWORD") {
                setError("currentPassword", { message: t("password.current.invalid") })
                return
            }

            toast.error(t(`password.errors.${code}`))
            return
        }

        reset()
        toast.success(t("password.success"))
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("password.title")}</CardTitle>
                <CardDescription>{t("password.description")}</CardDescription>
            </CardHeader>

            <CardContent>
                <form onSubmit={handleSubmit(onSubmit)}>
                    <FieldGroup>
                        <FieldSet>
                            <FieldGroup>
                                <PasswordInput
                                    name="currentPassword"
                                    control={control}
                                    isPending={isSubmitting}
                                    label={t("password.current.label")}
                                    placeholder={t("password.current.placeholder")}
                                />

                                <PasswordInput
                                    name="newPassword"
                                    control={control}
                                    isPending={isSubmitting}
                                    label={t("password.new.label")}
                                    placeholder={t("password.new.placeholder")}
                                    description={t("password.new.description")}
                                />

                                <PasswordInput
                                    name="confirmPassword"
                                    control={control}
                                    isPending={isSubmitting}
                                    label={t("password.confirm.label")}
                                    placeholder={t("password.confirm.placeholder")}
                                />

                                <CheckboxInput
                                    name="revokeOtherSessions"
                                    control={control}
                                    isPending={isSubmitting}
                                    label={t("password.revoke.label")}
                                    description={t("password.revoke.description")}
                                />

                                <Button className="justify-self-start" disabled={isSubmitting}>
                                    {t("password.submit")}
                                    {isSubmitting ? <Spinner /> : <IconKey />}
                                </Button>
                            </FieldGroup>
                        </FieldSet>
                    </FieldGroup>
                </form>
            </CardContent>
        </Card>
    )
}
