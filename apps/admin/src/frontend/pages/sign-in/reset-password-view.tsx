"use client";

import { z } from "zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconAlertCircle, IconArrowLeft, IconShieldCheck } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { Link, useRouter } from "@workspace/i18n/navigation";
import { authClient } from "@workspace/auth/client";

import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { PasswordInput } from "@workspace/ui/inputs/password";
import { FieldGroup, FieldSet } from "@workspace/ui/components/field";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Card, CardContent, CardDescription, CardTitle } from "@workspace/ui/components/card";

import { ResetPasswordSchema } from "@/backend/schemas/reset-password";

export function ResetPasswordView() {
    const t = useTranslations("Admin.auth")
    const router = useRouter()

    // Better Auth lands here as either ?token=... or ?error=INVALID_TOKEN
    const searchParams = useSearchParams()
    const token = searchParams.get("token")
    const invalidLink = !token || searchParams.get("error") !== null

    const [formError, setFormError] = useState<string | null>(null)

    const FormSchema = useMemo(() => ResetPasswordSchema(t), [t])
    type TypeSchema = z.infer<typeof FormSchema>

    const { control, handleSubmit, formState: { isSubmitting } } = useForm<TypeSchema>({
        resolver: zodResolver(FormSchema),
        defaultValues: { newPassword: "", confirmPassword: "" },
    })

    async function onSubmit(data: TypeSchema) {
        if (!token) return
        setFormError(null)

        const { error } = await authClient.resetPassword({
            newPassword: data.newPassword,
            token,
        })

        if (error) {
            setFormError(
                error.code === "INVALID_TOKEN" ? t("reset.errors.invalid_token")
                    : t("errors.default")
            )
            return
        }

        toast.success(t("reset.success"))
        router.push("/sign-in")
    }

    return (
        <Card className="overflow-hidden p-0 shadow-none text-card-foreground md:shadow-xl w-full">
            <CardContent className="grid gap-6 p-6 md:p-8">
                <div className="flex flex-col">
                    <CardTitle className="text-2xl font-bold">{t("reset.title")}</CardTitle>
                    <CardDescription className="text-muted-foreground text-balance">
                        {t("reset.description")}
                    </CardDescription>
                </div>

                {formError && (
                    <Alert variant="destructive">
                        <IconAlertCircle />
                        <AlertTitle>{formError}</AlertTitle>
                    </Alert>
                )}

                {invalidLink ? (
                    <Alert variant="destructive">
                        <IconAlertCircle />
                        <AlertTitle>{t("reset.errors.invalid_token")}</AlertTitle>
                        <AlertDescription>{t("reset.errors.invalid_token_hint")}</AlertDescription>
                    </Alert>
                ) : (
                    <form onSubmit={handleSubmit(onSubmit)}>
                        <FieldGroup>
                            <FieldSet>
                                <FieldGroup>
                                    <PasswordInput
                                        name="newPassword"
                                        label={t("reset.password.label")}
                                        placeholder={t("reset.password.placeholder")}
                                        control={control}
                                        isPending={isSubmitting}
                                    />

                                    <PasswordInput
                                        name="confirmPassword"
                                        label={t("reset.confirm.label")}
                                        placeholder={t("reset.confirm.placeholder")}
                                        control={control}
                                        isPending={isSubmitting}
                                    />

                                    <Button disabled={isSubmitting}>
                                        {t("reset.submit")}
                                        <IconShieldCheck />
                                    </Button>
                                </FieldGroup>
                            </FieldSet>
                        </FieldGroup>
                    </form>
                )}

                <Link
                    href="/forgot-password"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                    <IconArrowLeft className="size-4" />
                    {t("reset.request-again")}
                </Link>
            </CardContent>
        </Card>
    )
}
