"use client"

import { z } from "zod"
import { toast } from "sonner"
import { useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconAlertTriangle, IconCheck, IconPhoneCheck, IconSend } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { authClient } from "@workspace/auth/client"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { OTPInput } from "@workspace/ui/inputs/otp"
import { PhoneInput } from "@workspace/ui/inputs/phone"
import { fromE164, toE164 } from "@workspace/ui/lib/phone"
import { Spinner } from "@workspace/ui/components/spinner"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { FieldGroup, FieldSet } from "@workspace/ui/components/field"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { PhoneCodeSchema, PhoneSchema } from "@/backend/schemas/settings"

type SessionUser = typeof authClient.$Infer.Session.user

/**
 * Phone verification is a two-step OTP: `sendOtp` texts a code against the
 * submitted number, `verify` binds it to the account.
 *
 * The number is typed through the shared `PhoneInput`. That component renders
 * a country selector but never folds the dial code into the field value, so
 * the form carries the country as a sibling field and `toE164` composes the
 * two at submit — which is also what `PhoneSchema` validates.
 *
 * NOTE: `phoneNumber({ sendOTP, verifyOTP })` in packages/auth/src/server.ts
 * is still stubbed — `sendOTP` only logs and `verifyOTP` returns false — so
 * this flow cannot complete until an SMS provider is wired in. The banner
 * below says so rather than leaving the user waiting for a text that was
 * never sent.
 */
export function PhoneCard({ user }: { user: SessionUser }) {
    const t = useTranslations("Admin.settings")

    const [pending, setPending] = useState<string | null>(null)

    const NumberFormSchema = useMemo(() => PhoneSchema(t), [t])
    type NumberSchemaType = z.infer<typeof NumberFormSchema>

    const CodeFormSchema = useMemo(() => PhoneCodeSchema(t), [t])
    type CodeSchemaType = z.infer<typeof CodeFormSchema>

    // `PhoneInput` needs the country and the national part separately, so a
    // stored E.164 number is split back apart on mount
    const stored = useMemo(() => fromE164(user.phoneNumber), [user.phoneNumber])

    const numberForm = useForm<NumberSchemaType>({
        resolver: zodResolver(NumberFormSchema),
        defaultValues: { country: stored.country, phoneNumber: stored.national },
    })

    // `useWatch` rather than `watch` so React Compiler can still memoize
    const country = useWatch({ control: numberForm.control, name: "country" })

    const codeForm = useForm<CodeSchemaType>({
        resolver: zodResolver(CodeFormSchema),
        defaultValues: { code: "" },
    })

    async function onSend({ country, phoneNumber }: NumberSchemaType) {
        // The plugin stores and dials exactly what it is given, so it is the
        // composed E.164 value that goes over the wire and into `pending`
        const e164 = toE164(country, phoneNumber)

        const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: e164 })

        if (error) {
            numberForm.setError("phoneNumber", { message: t("phone.number.failed") })
            return
        }

        setPending(e164)
        toast(t("phone.sent"))
    }

    async function onVerify({ code }: CodeSchemaType) {
        if (!pending) return

        const { error } = await authClient.phoneNumber.verify({
            phoneNumber: pending,
            code,
        })

        if (error) {
            codeForm.setError("code", { message: t("phone.code.invalid") })
            return
        }

        setPending(null)
        codeForm.reset()
        toast(t("phone.verified"))
    }

    const isBusy = numberForm.formState.isSubmitting || codeForm.formState.isSubmitting
    const verified = Boolean(user.phoneNumberVerified)

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("phone.title")}</CardTitle>
                <CardDescription>{t("phone.description")}</CardDescription>
                {user.phoneNumber && (
                    <CardAction>
                        <Badge variant={verified ? "default" : "outline"}>
                            {t(verified ? "phone.status.verified" : "phone.status.unverified")}
                        </Badge>
                    </CardAction>
                )}
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
                <Alert>
                    <IconAlertTriangle />
                    <AlertTitle>{t("phone.unavailable.title")}</AlertTitle>
                    <AlertDescription>{t("phone.unavailable.description")}</AlertDescription>
                </Alert>

                <form onSubmit={numberForm.handleSubmit(onSend)}>
                    <FieldGroup>
                        <FieldSet>
                            <FieldGroup>
                                {/* No `placeholder`: PhoneInput supplies its
                                    own from the selected country. Validating
                                    on country change clears a stale "not a
                                    valid number" when the dial code moves */}
                                <PhoneInput
                                    name="phoneNumber"
                                    control={numberForm.control}
                                    isPending={isBusy}
                                    country={country}
                                    setCountry={(value) =>
                                        numberForm.setValue("country", value, {
                                            shouldDirty: true,
                                            shouldValidate: true,
                                        })
                                    }
                                    label={t("phone.number.label")}
                                    description={t("phone.number.description")}
                                />

                                <Button className="justify-self-start" disabled={isBusy}>
                                    {t("phone.send")}
                                    {numberForm.formState.isSubmitting ? <Spinner /> : <IconSend />}
                                </Button>
                            </FieldGroup>
                        </FieldSet>
                    </FieldGroup>
                </form>

                {pending && (
                    <form onSubmit={codeForm.handleSubmit(onVerify)}>
                        <FieldGroup>
                            <FieldSet>
                                <FieldGroup>
                                    <OTPInput
                                        name="code"
                                        control={codeForm.control}
                                        isPending={isBusy}
                                        label={t("phone.code.label")}
                                        description={t("phone.code.description", { phone: pending })}
                                    />

                                    <Button className="justify-self-start" disabled={isBusy}>
                                        {t("phone.verify")}
                                        {codeForm.formState.isSubmitting ? <Spinner /> : <IconCheck />}
                                    </Button>
                                </FieldGroup>
                            </FieldSet>
                        </FieldGroup>
                    </form>
                )}

                {verified && !pending && (
                    <Alert>
                        <IconPhoneCheck />
                        <AlertTitle>{t("phone.active.title")}</AlertTitle>
                        <AlertDescription>{user.phoneNumber}</AlertDescription>
                    </Alert>
                )}
            </CardContent>
        </Card>
    )
}
