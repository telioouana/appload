"use client";

import { z } from "zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconArrowLeft, IconMailForward } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { Link } from "@workspace/i18n/navigation";
import { authClient } from "@workspace/auth/client";

import { Button } from "@workspace/ui/components/button";
import { UsernameInput } from "@workspace/ui/inputs/username";
import { FieldGroup, FieldSet } from "@workspace/ui/components/field";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Card, CardContent, CardDescription, CardTitle } from "@workspace/ui/components/card";

import { staffEmail } from "@/backend/schemas/sign-in";
import { ForgotPasswordSchema } from "@/backend/schemas/reset-password";

export function ForgotPasswordView() {
    const t = useTranslations("Admin.auth")

    const [sent, setSent] = useState(false)

    const FormSchema = useMemo(() => ForgotPasswordSchema(t), [t])
    type TypeSchema = z.infer<typeof FormSchema>

    const { control, handleSubmit, formState: { isSubmitting } } = useForm<TypeSchema>({
        resolver: zodResolver(FormSchema),
        defaultValues: { username: "" },
    })

    async function onSubmit(data: TypeSchema) {
        await authClient.requestPasswordReset({
            email: staffEmail(data.username),
            redirectTo: "/reset-password",
        })

        // Always the same outcome, whether or not the address exists — the
        // server answers 200 either way and this screen must not become an
        // account-enumeration oracle
        setSent(true)
    }

    return (
        <Card className="overflow-hidden p-0 shadow-none text-card-foreground md:shadow-xl w-full">
            <CardContent className="grid gap-6 p-6 md:p-8">
                <div className="flex flex-col">
                    <CardTitle className="text-2xl font-bold">{t("forgot.title")}</CardTitle>
                    <CardDescription className="text-muted-foreground text-balance">
                        {t("forgot.description")}
                    </CardDescription>
                </div>

                {sent ? (
                    <Alert>
                        <IconMailForward />
                        <AlertTitle>{t("forgot.sent-title")}</AlertTitle>
                        <AlertDescription>{t("forgot.sent-description")}</AlertDescription>
                    </Alert>
                ) : (
                    <form onSubmit={handleSubmit(onSubmit)}>
                        <FieldGroup>
                            <FieldSet>
                                <FieldGroup>
                                    <UsernameInput
                                        name="username"
                                        label={t("username.label")}
                                        placeholder={t("username.placeholder")}
                                        control={control}
                                        isPending={isSubmitting}
                                        example={"@apploadafrica.com"}
                                        description={t("username.description")}
                                    />

                                    <Button disabled={isSubmitting}>
                                        {t("forgot.submit")}
                                        <IconMailForward />
                                    </Button>
                                </FieldGroup>
                            </FieldSet>
                        </FieldGroup>
                    </form>
                )}

                <Link
                    href="/sign-in"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                    <IconArrowLeft className="size-4" />
                    {t("forgot.back")}
                </Link>
            </CardContent>
        </Card>
    )
}
