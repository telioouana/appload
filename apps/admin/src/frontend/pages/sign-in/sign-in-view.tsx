"use client";

import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form"
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod"
import { IconAlertCircle, IconBrandGoogle, IconLogin } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { Link } from "@workspace/i18n/navigation";
import { authClient } from "@workspace/auth/client";

import { Button } from "@workspace/ui/components/button";
import { UsernameInput } from "@workspace/ui/inputs/username";
import { PasswordInput } from "@workspace/ui/inputs/password";
import { FieldGroup, FieldSet } from "@workspace/ui/components/field";
import { Marker, MarkerContent } from "@workspace/ui/components/marker";
import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Card, CardContent, CardDescription, CardTitle } from "@workspace/ui/components/card";

import { SignInSchema, staffEmail } from "@/backend/schemas/sign-in";

const KNOWN_AUTH_ERRORS = ["unable_to_get_user_info", "access_denied"] as const

export function SignInView() {
    const t = useTranslations("Admin.auth")

    const searchParams = useSearchParams()

    // Better Auth redirect-flow failures (e.g. Google callback errors) come
    // back as an `error` query param instead of the onError callback
    const errorParam = searchParams.get("error")
    const [formError, setFormError] = useState<string | null>(null)
    const authError = formError ?? (errorParam
        ? t(`errors.${KNOWN_AUTH_ERRORS.find((code) => code === errorParam) ?? "default"}`)
        : null)

    // Where the proxy sent us from; only same-app paths are honoured so the
    // param cannot become an open redirect
    const callbackParam = searchParams.get("callbackUrl")
    const callbackUrl =
        callbackParam?.startsWith("/") && !callbackParam.startsWith("//")
            ? callbackParam
            : "/orders/all"

    const FormSchema = useMemo(() => SignInSchema(t), [t])
    type TypeSchema = z.infer<typeof FormSchema>

    const { clearErrors, control, handleSubmit, formState: { isSubmitting } } = useForm<TypeSchema>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            username: "",
            password: "",
        }
    })

    async function onSubmit(data: TypeSchema) {
        clearErrors()
        setFormError(null)

        const { error } = await authClient.signIn.email({
            email: staffEmail(data.username),
            password: data.password,
        })

        if (error) {
            setFormError(
                error.code === "INVALID_EMAIL_OR_PASSWORD" ? t("errors.invalid_credentials")
                    : error.status === 429 ? t("errors.too_many_requests")
                        : t("errors.default")
            )
            return
        }

        // Full page load so the server picks up the fresh session cookie
        window.location.assign(callbackUrl)
    }

    // Popup OAuth flow. The popup lands on /api/oauth-popup, which
    // postMessages the outcome back and closes itself; a closed-poll covers
    // the user dismissing the window (or a lost message).
    const [isSocialPending, setSocialPending] = useState(false)
    const popupRef = useRef<Window | null>(null)
    const settledRef = useRef(false)

    async function settleSocial() {
        if (settledRef.current) return
        settledRef.current = true

        const { data: session } = await authClient.getSession()

        if (session) {
            // Full page load so the server picks up the fresh session cookie
            window.location.assign(callbackUrl)
            return
        }

        setSocialPending(false)
    }

    useEffect(() => {
        function onMessage(event: MessageEvent) {
            if (event.origin !== window.location.origin) return
            if ((event.data as { type?: string })?.type !== "appload:oauth") return

            const error = (event.data as { error?: string | null }).error

            popupRef.current?.close()

            if (error) {
                settledRef.current = true
                setSocialPending(false)
                setFormError(t(`errors.${KNOWN_AUTH_ERRORS.find((code) => code === error) ?? "default"}`))
                return
            }

            void settleSocial()
        }

        window.addEventListener("message", onMessage)
        return () => window.removeEventListener("message", onMessage)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [callbackUrl])

    async function onSocial() {
        setFormError(null)

        const { data, error } = await authClient.signIn.social({
            provider: "google",
            disableRedirect: true,
            callbackURL: "/api/oauth-popup",
            errorCallbackURL: "/api/oauth-popup",
            // Sheets access comes from the shared service account while the
            // spreadsheets scope is pending Google verification
            scopes: process.env.NEXT_PUBLIC_GOOGLE_SHEETS_AUTH_MODE === "service-account"
                ? undefined
                : ["https://www.googleapis.com/auth/spreadsheets"],
        })

        if (error || !data?.url) {
            setFormError(t("errors.default"))
            return
        }

        const popup = window.open(data.url, "appload-google", "popup,width=500,height=650")

        if (!popup) {
            // Popup blocked — fall back to the same-tab redirect flow (its
            // ?error= handling on this page already exists)
            window.location.assign(data.url)
            return
        }

        popupRef.current = popup
        settledRef.current = false
        setSocialPending(true)

        const poll = setInterval(() => {
            if (!popup.closed) return
            clearInterval(poll)
            void settleSocial()
        }, 500)
    }

    return (
        <Card className="overflow-hidden p-0 shadow-none text-card-foreground md:shadow-xl w-full">
            <CardContent className="grid gap-6 p-6 md:p-8">
                <div className="flex flex-col">
                    <CardTitle className="text-2xl font-bold">{t("title")}</CardTitle>
                    <CardDescription className="text-muted-foreground text-balance">{t("description")}</CardDescription>
                </div>

                {authError && (
                    <Alert variant="destructive">
                        <IconAlertCircle />
                        <AlertTitle>{authError}</AlertTitle>
                    </Alert>
                )}

                <div className="w-full">
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

                                <Marker variant="separator">
                                    <MarkerContent >{t("sign-with")}</MarkerContent>
                                </Marker>

                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={onSocial}
                                    disabled={isSocialPending}
                                >
                                    <IconBrandGoogle />
                                    Google
                                </Button>
                            </FieldSet>
                        </FieldGroup>
                    </form>
                </div>
            </CardContent>
        </Card>
    )
}
