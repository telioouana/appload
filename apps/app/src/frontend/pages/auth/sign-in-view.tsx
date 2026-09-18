"use client";

import { z } from "zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form"
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod"
import { IconAlertCircle, IconLogin } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { Link } from "@/i18n/navigation";
import { authClient } from "@workspace/auth/client";

import { Button } from "@workspace/ui/components/button";
import { EmailInput } from "@workspace/ui/inputs/email";
import { PasswordInput } from "@workspace/ui/inputs/password";
import { FieldGroup, FieldSet } from "@workspace/ui/components/field";
import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Card, CardContent, CardDescription, CardTitle } from "@workspace/ui/components/card";

import { DEFAULT_LOGIN_REDIRECT } from "@/routes";
import { SignInSchema } from "@/backend/schemas/sign-in";

export function SignInView() {
    const t = useTranslations("App.auth")

    const searchParams = useSearchParams()

    const [formError, setFormError] = useState<string | null>(null)

    // Where the proxy sent us from; only same-app paths are honoured so the
    // param cannot become an open redirect. Resolved against this origin
    // rather than prefix-matched: the URL parser folds a backslash into a
    // slash for http(s), so "/\evil.com" passes a startsWith("/") test and
    // still lands on another site — with the victim one step out of a
    // successful sign-in. Computed at submit time because `window` is not
    // there while this client component renders on the server.
    function resolveCallbackUrl(): string {
        const param = searchParams.get("callbackUrl")

        if (!param) return DEFAULT_LOGIN_REDIRECT

        try {
            const target = new URL(param, window.location.origin)

            return target.origin === window.location.origin
                ? `${target.pathname}${target.search}`
                : DEFAULT_LOGIN_REDIRECT
        } catch {
            return DEFAULT_LOGIN_REDIRECT
        }
    }

    const FormSchema = useMemo(() => SignInSchema(t), [t])
    type TypeSchema = z.infer<typeof FormSchema>

    const { clearErrors, control, handleSubmit, formState: { isSubmitting } } = useForm<TypeSchema>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            email: "",
            password: "",
        }
    })

    async function onSubmit(data: TypeSchema) {
        clearErrors()
        setFormError(null)

        const { error } = await authClient.signIn.email({
            email: data.email,
            password: data.password,
        })

        if (error) {
            setFormError(
                error.code === "INVALID_EMAIL_OR_PASSWORD" ? t("errors.invalid_credentials")
                    : error.code === "EMAIL_NOT_VERIFIED" ? t("errors.email_not_verified")
                        : error.status === 429 ? t("errors.too_many_requests")
                            : t("errors.default")
            )
            return
        }

        // Full page load so the server picks up the fresh session cookie
        window.location.assign(resolveCallbackUrl())
    }

    return (
        <Card className="overflow-hidden p-0 shadow-none text-card-foreground md:shadow-xl w-full">
            <CardContent className="grid gap-6 p-6 md:p-8">
                <div className="flex flex-col">
                    <CardTitle className="text-2xl font-bold">{t("title")}</CardTitle>
                    <CardDescription className="text-muted-foreground text-balance">{t("description")}</CardDescription>
                </div>

                {formError && (
                    <Alert variant="destructive">
                        <IconAlertCircle />
                        <AlertTitle>{formError}</AlertTitle>
                    </Alert>
                )}

                <div className="w-full">
                    <form onSubmit={handleSubmit(onSubmit)}>
                        <FieldGroup>
                            <FieldSet>
                                <FieldGroup>
                                    <EmailInput
                                        name="email"
                                        label={t("email.label")}
                                        placeholder={t("email.placeholder")}
                                        control={control}
                                        isPending={isSubmitting}
                                    />

                                    <PasswordInput
                                        name="password"
                                        label={t("password.label")}
                                        placeholder={t("password.placeholder")}
                                        control={control}
                                        isPending={isSubmitting}
                                    />

                                    <div className="flex justify-end">
                                        <Link
                                            href="/forgot-password"
                                            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                                        >
                                            {t("forgot-link")}
                                        </Link>
                                    </div>

                                    <Button disabled={isSubmitting}>
                                        {t("sign-in")}
                                        <IconLogin />
                                    </Button>
                                </FieldGroup>
                            </FieldSet>
                        </FieldGroup>
                    </form>
                </div>

                <p className="text-center text-sm text-muted-foreground">
                    {t("no-account")}{" "}
                    <Link href="/sign-up" className="text-foreground underline-offset-4 hover:underline">
                        {t("sign-up-link")}
                    </Link>
                </p>
            </CardContent>
        </Card>
    )
}
