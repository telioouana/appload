"use client";

import { z } from "zod";
import { useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconAlertCircle, IconMailForward, IconUserPlus } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { Link } from "@/i18n/navigation";
import { authClient } from "@workspace/auth/client";

import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { TextInput } from "@workspace/ui/inputs/text";
import { EmailInput } from "@workspace/ui/inputs/email";
import { PasswordInput } from "@workspace/ui/inputs/password";
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet, FieldTitle } from "@workspace/ui/components/field";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Card, CardContent, CardDescription, CardTitle } from "@workspace/ui/components/card";

import { useTRPC } from "@/backend/api/client";
import { domainErrorCode } from "@/lib/trpc-error";
import { SignUpSchema } from "@/backend/schemas/sign-up";
import { useResendCooldown } from "@/frontend/pages/auth/hooks/use-resend-cooldown";

const ERROR_MESSAGE_KEYS = {
    "EMAIL_TAKEN": "emailTaken",
    "INVALID_INVITATION": "invitationInvalid",
    "RATE_LIMITED": "rateLimited",
    "UNKNOWN": "unknown",
} as const;

type SignUpErrorCode = keyof typeof ERROR_MESSAGE_KEYS;

const SIGN_UP_ERROR_CODES = Object.keys(ERROR_MESSAGE_KEYS) as SignUpErrorCode[];

const COMPANY_TYPES = ["shipper", "carrier"] as const;

/**
 * Account creation. Nothing here writes the account: `onboarding.signUp`
 * does, server-side, so `user.type` is never posted by the browser.
 *
 * An invitation locks the address and the company type to what was invited —
 * accepting on a different email would fail Better Auth's own check later,
 * so the form does not offer it.
 */
export function SignUpView({
    invitation,
}: {
    invitation?: {
        id: string;
        email: string;
        organizationName: string;
        organizationType: "shipper" | "carrier";
    };
}) {
    const t = useTranslations("App.auth")
    const trpc = useTRPC()

    const [error, setError] = useState<SignUpErrorCode | null>(null)
    const [sentTo, setSentTo] = useState<string | null>(null)

    const signUp = useMutation(trpc.onboarding.signUp.mutationOptions())

    const FormSchema = useMemo(() => SignUpSchema(t), [t])
    type TypeSchema = z.infer<typeof FormSchema>

    const { control, handleSubmit, formState: { isSubmitting } } = useForm<TypeSchema>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            name: "",
            email: invitation?.email ?? "",
            password: "",
            companyType: invitation?.organizationType ?? "shipper",
        },
    })

    const isPending = isSubmitting || signUp.isPending

    // Verifying takes an invitee back to the invitation, not to the NUIT
    // step: a company registered there would make the invitation
    // unacceptable (organizationLimit is 1). Same value the procedure uses
    // for the first send.
    const callbackURL = invitation ? `/accept-invitation/${invitation.id}` : "/onboarding"

    async function onSubmit(data: TypeSchema) {
        setError(null)

        signUp.mutate(
            { ...data, invitationId: invitation?.id },
            {
                onSuccess: ({ email }) => setSentTo(email),
                onError: (err) => setError(domainErrorCode(err, SIGN_UP_ERROR_CODES, "UNKNOWN")),
            },
        )
    }

    const { isSending, secondsLeft, resend } = useResendCooldown(async () => {
        if (!sentTo) return false

        const { error: resendError } = await authClient.sendVerificationEmail({
            email: sentTo,
            callbackURL,
        })

        if (resendError) {
            toast.error(t("verify.error"))
            return false
        }

        toast.success(t("sign-up.sent.resent"))
        return true
    })

    if (sentTo) {
        return (
            <Card className="overflow-hidden p-0 shadow-none text-card-foreground md:shadow-xl w-full">
                <CardContent className="grid gap-6 p-6 md:p-8">
                    <div className="flex flex-col">
                        <CardTitle className="text-2xl font-bold">{t("sign-up.sent.title")}</CardTitle>
                        <CardDescription className="text-muted-foreground text-balance">
                            {t("sign-up.sent.description", { email: sentTo })}
                        </CardDescription>
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        onClick={resend}
                        disabled={isSending || secondsLeft > 0}
                    >
                        <IconMailForward />
                        {secondsLeft > 0
                            ? t("verify.resend-wait", { seconds: secondsLeft })
                            : t("sign-up.sent.resend")}
                    </Button>

                    <Link
                        href="/sign-in"
                        className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
                    >
                        {t("sign-up.sent.sign-in")}
                    </Link>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="overflow-hidden p-0 shadow-none text-card-foreground md:shadow-xl w-full">
            <CardContent className="grid gap-6 p-6 md:p-8">
                <div className="flex flex-col">
                    <CardTitle className="text-2xl font-bold">{t("sign-up.title")}</CardTitle>
                    <CardDescription className="text-muted-foreground text-balance">
                        {t("sign-up.description")}
                    </CardDescription>
                </div>

                {invitation && (
                    <Alert>
                        <IconMailForward />
                        <AlertTitle>{t("sign-up.invited.title")}</AlertTitle>
                        <AlertDescription>
                            {t("sign-up.invited.description", {
                                email: invitation.email,
                                organization: invitation.organizationName,
                            })}
                        </AlertDescription>
                    </Alert>
                )}

                {error && (
                    <Alert variant="destructive">
                        <IconAlertCircle />
                        <AlertTitle>{t(`sign-up.errors.${ERROR_MESSAGE_KEYS[error]}`)}</AlertTitle>
                    </Alert>
                )}

                <form onSubmit={handleSubmit(onSubmit)}>
                    <FieldGroup>
                        <FieldSet>
                            <FieldGroup>
                                <TextInput
                                    name="name"
                                    label={t("sign-up.name.label")}
                                    placeholder={t("sign-up.name.placeholder")}
                                    control={control}
                                    isPending={isPending}
                                />

                                <EmailInput
                                    name="email"
                                    label={t("sign-up.email.label")}
                                    placeholder={t("sign-up.email.placeholder")}
                                    control={control}
                                    isPending={isPending}
                                    disabled={Boolean(invitation)}
                                />

                                <PasswordInput
                                    name="password"
                                    label={t("sign-up.password.label")}
                                    placeholder={t("sign-up.password.placeholder")}
                                    control={control}
                                    isPending={isPending}
                                />

                                {/* An invitation already answers this: the
                                    company decides what its members are */}
                                {!invitation && (
                                    <Controller
                                        control={control}
                                        name="companyType"
                                        render={({ field, fieldState }) => (
                                            <Field>
                                                <FieldTitle>{t("sign-up.company-type.label")}</FieldTitle>
                                                <RadioGroup
                                                    value={field.value}
                                                    onValueChange={field.onChange}
                                                    disabled={isPending}
                                                    className="gap-3"
                                                >
                                                    {COMPANY_TYPES.map((type) => (
                                                        <FieldLabel key={type} htmlFor={`company-type-${type}`}>
                                                            <Field orientation="horizontal">
                                                                <RadioGroupItem value={type} id={`company-type-${type}`} />
                                                                <div className="grid gap-1">
                                                                    <FieldTitle>{t(`sign-up.company-type.${type}`)}</FieldTitle>
                                                                    <FieldDescription>
                                                                        {t(`sign-up.company-type.${type}-hint`)}
                                                                    </FieldDescription>
                                                                </div>
                                                            </Field>
                                                        </FieldLabel>
                                                    ))}
                                                </RadioGroup>
                                                {fieldState.error && (
                                                    <FieldError errors={[fieldState.error]} />
                                                )}
                                            </Field>
                                        )}
                                    />
                                )}

                                <Button disabled={isPending}>
                                    {t("sign-up.submit")}
                                    <IconUserPlus />
                                </Button>
                            </FieldGroup>
                        </FieldSet>
                    </FieldGroup>
                </form>

                <p className="text-center text-sm text-muted-foreground">
                    {t("have-account")}{" "}
                    <Link href="/sign-in" className="text-foreground underline-offset-4 hover:underline">
                        {t("sign-in-link")}
                    </Link>
                </p>
            </CardContent>
        </Card>
    )
}
