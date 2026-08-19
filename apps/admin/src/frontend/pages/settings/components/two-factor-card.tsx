"use client"

import { z } from "zod"
import { toast } from "sonner"
import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconAlertTriangle, IconCheck, IconCopy, IconRefresh, IconShieldCheck, IconShieldOff } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { authClient } from "@workspace/auth/client"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { OTPInput } from "@workspace/ui/inputs/otp"
import { Spinner } from "@workspace/ui/components/spinner"
import { PasswordInput } from "@workspace/ui/inputs/password"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { FieldGroup, FieldSet } from "@workspace/ui/components/field"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { TotpCodeSchema, TwoFactorPasswordSchema } from "@/backend/schemas/settings"

/**
 * Enrolment is two server calls, not one: `enable` stores an unverified
 * secret and hands back the URI plus backup codes, and only `verifyTotp`
 * marks it verified. The plugin is configured without
 * `skipVerificationOnEnable`, so a user who abandons this card midway has
 * 2FA switched on but unverified — which is why `enrolling` keeps the codes
 * on screen until the verify step succeeds.
 *
 * Every path through the plugin verifies a password — `shouldRequirePassword`
 * returns true unconditionally unless `allowPasswordless` is set, and it is
 * not — so this card is inert on an account with no credential row. A
 * social-only user pressing Enable would get a bare INVALID_PASSWORD, so
 * `hasPassword` replaces the controls with an explanation instead.
 */
type Enrolling = {
    totpURI: string
    backupCodes: string[]
}

// `idle` is the resting state; the others are which password prompt is open.
type Intent = "idle" | "enable" | "disable" | "regenerate"

export function TwoFactorCard({ enabled, hasPassword }: { enabled: boolean; hasPassword: boolean }) {
    const t = useTranslations("Admin.settings")

    const [intent, setIntent] = useState<Intent>("idle")
    const [enrolling, setEnrolling] = useState<Enrolling | null>(null)
    const [freshCodes, setFreshCodes] = useState<string[] | null>(null)

    const PasswordFormSchema = useMemo(() => TwoFactorPasswordSchema(t), [t])
    type PasswordSchemaType = z.infer<typeof PasswordFormSchema>

    const CodeFormSchema = useMemo(() => TotpCodeSchema(t), [t])
    type CodeSchemaType = z.infer<typeof CodeFormSchema>

    const passwordForm = useForm<PasswordSchemaType>({
        resolver: zodResolver(PasswordFormSchema),
        defaultValues: { password: "" },
    })

    const codeForm = useForm<CodeSchemaType>({
        resolver: zodResolver(CodeFormSchema),
        defaultValues: { code: "" },
    })

    function close() {
        setIntent("idle")
        passwordForm.reset()
    }

    async function onPassword({ password }: PasswordSchemaType) {
        if (intent === "enable") {
            const { data, error } = await authClient.twoFactor.enable({ password })

            if (error || !data) {
                passwordForm.setError("password", { message: t("twoFactor.password.invalid") })
                return
            }

            setEnrolling({ totpURI: data.totpURI, backupCodes: data.backupCodes })
            close()
            return
        }

        if (intent === "disable") {
            const { error } = await authClient.twoFactor.disable({ password })

            if (error) {
                passwordForm.setError("password", { message: t("twoFactor.password.invalid") })
                return
            }

            setEnrolling(null)
            setFreshCodes(null)
            close()
            toast(t("twoFactor.disabled"))
            return
        }

        const { data, error } = await authClient.twoFactor.generateBackupCodes({ password })

        if (error || !data) {
            passwordForm.setError("password", { message: t("twoFactor.password.invalid") })
            return
        }

        // Replacing the old set invalidates it, so the new codes are shown
        // immediately — there is no second chance to read them
        setFreshCodes(data.backupCodes)
        close()
    }

    async function onVerify({ code }: CodeSchemaType) {
        const { error } = await authClient.twoFactor.verifyTotp({ code })

        if (error) {
            codeForm.setError("code", { message: t("twoFactor.code.invalid") })
            return
        }

        setEnrolling(null)
        codeForm.reset()
        toast(t("twoFactor.enabled"))
    }

    async function copy(value: string) {
        try {
            await navigator.clipboard.writeText(value)
            toast(t("twoFactor.copied"))
        } catch {
            toast(t("twoFactor.copyFailed"))
        }
    }

    const isBusy = passwordForm.formState.isSubmitting || codeForm.formState.isSubmitting

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("twoFactor.title")}</CardTitle>
                <CardDescription>{t("twoFactor.description")}</CardDescription>
                <CardAction>
                    <Badge variant={enabled ? "default" : "outline"}>
                        {t(enabled ? "twoFactor.status.on" : "twoFactor.status.off")}
                    </Badge>
                </CardAction>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
                {/* Step 2 of enrolment: the secret exists but is unverified
                    until a code from the authenticator proves it was stored */}
                {enrolling && (
                    <div className="flex flex-col gap-4 rounded-2xl border p-4">
                        <div className="grid gap-1">
                            <span className="text-sm font-medium">{t("twoFactor.setup.title")}</span>
                            <span className="text-muted-foreground text-sm">{t("twoFactor.setup.description")}</span>
                        </div>

                        <SecretRow
                            label={t("twoFactor.setup.secret")}
                            value={totpSecret(enrolling.totpURI)}
                            onCopy={copy}
                        />

                        <SecretRow
                            label={t("twoFactor.setup.uri")}
                            value={enrolling.totpURI}
                            onCopy={copy}
                        />

                        <BackupCodes
                            title={t("twoFactor.backup.title")}
                            description={t("twoFactor.backup.description")}
                            codes={enrolling.backupCodes}
                            copyLabel={t("twoFactor.backup.copy")}
                            onCopy={copy}
                        />

                        <form onSubmit={codeForm.handleSubmit(onVerify)}>
                            <FieldGroup>
                                <FieldSet>
                                    <FieldGroup>
                                        <OTPInput
                                            name="code"
                                            control={codeForm.control}
                                            isPending={isBusy}
                                            label={t("twoFactor.code.label")}
                                            description={t("twoFactor.code.description")}
                                        />

                                        <Button className="justify-self-start" disabled={isBusy}>
                                            {t("twoFactor.setup.confirm")}
                                            {codeForm.formState.isSubmitting ? <Spinner /> : <IconCheck />}
                                        </Button>
                                    </FieldGroup>
                                </FieldSet>
                            </FieldGroup>
                        </form>
                    </div>
                )}

                {/* Regenerated codes replace the previous set the moment the
                    server answers, so they are shown outside the enrol flow too */}
                {freshCodes && (
                    <div className="rounded-2xl border p-4">
                        <BackupCodes
                            title={t("twoFactor.backup.newTitle")}
                            description={t("twoFactor.backup.description")}
                            codes={freshCodes}
                            copyLabel={t("twoFactor.backup.copy")}
                            onCopy={copy}
                        />

                        <Button
                            type="button"
                            variant="outline"
                            className="mt-4"
                            onClick={() => setFreshCodes(null)}
                        >
                            {t("twoFactor.backup.dismiss")}
                        </Button>
                    </div>
                )}

                {!hasPassword ? (
                    <Alert>
                        <IconAlertTriangle />
                        <AlertTitle>{t("twoFactor.requiresPassword.title")}</AlertTitle>
                        <AlertDescription>{t("twoFactor.requiresPassword.description")}</AlertDescription>
                    </Alert>
                ) : intent !== "idle" ? (
                    <form onSubmit={passwordForm.handleSubmit(onPassword)}>
                        <FieldGroup>
                            <FieldSet>
                                <FieldGroup>
                                    <PasswordInput
                                        name="password"
                                        control={passwordForm.control}
                                        isPending={isBusy}
                                        label={t("twoFactor.password.label")}
                                        placeholder={t("twoFactor.password.placeholder")}
                                        description={t(`twoFactor.password.reason.${intent}`)}
                                    />

                                    <div className="flex gap-2">
                                        <Button
                                            disabled={isBusy}
                                            variant={intent === "disable" ? "destructive" : "default"}
                                        >
                                            {t(`twoFactor.actions.${intent}`)}
                                            {passwordForm.formState.isSubmitting ? <Spinner /> : <IconShieldCheck />}
                                        </Button>

                                        <Button type="button" variant="ghost" disabled={isBusy} onClick={close}>
                                            {t("twoFactor.actions.cancel")}
                                        </Button>
                                    </div>
                                </FieldGroup>
                            </FieldSet>
                        </FieldGroup>
                    </form>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {enabled ? (
                            <>
                                <Button type="button" variant="destructive" onClick={() => setIntent("disable")}>
                                    {t("twoFactor.actions.disable")}
                                    <IconShieldOff />
                                </Button>

                                <Button type="button" variant="outline" onClick={() => setIntent("regenerate")}>
                                    {t("twoFactor.actions.regenerate")}
                                    <IconRefresh />
                                </Button>
                            </>
                        ) : (
                            <Button type="button" onClick={() => setIntent("enable")}>
                                {t("twoFactor.actions.enable")}
                                <IconShieldCheck />
                            </Button>
                        )}
                    </div>
                )}

                {enabled && !enrolling && (
                    <Alert>
                        <IconShieldCheck />
                        <AlertTitle>{t("twoFactor.active.title")}</AlertTitle>
                        <AlertDescription>{t("twoFactor.active.description")}</AlertDescription>
                    </Alert>
                )}
            </CardContent>
        </Card>
    )
}

/**
 * Pulls the shared secret out of the otpauth URI for manual entry. Apps that
 * cannot scan (and this card has no QR renderer) need the bare secret, not
 * the whole URI. Falls back to the URI if the shape is ever not what the
 * plugin builds today.
 */
function totpSecret(totpURI: string): string {
    try {
        return new URL(totpURI).searchParams.get("secret") ?? totpURI
    } catch {
        return totpURI
    }
}

function SecretRow({
    label,
    value,
    onCopy,
}: {
    label: string
    value: string
    onCopy: (value: string) => void
}) {
    return (
        <div className="grid gap-1">
            <span className="text-sm font-medium">{label}</span>
            <div className="flex items-center gap-2">
                <code className="bg-muted min-w-0 flex-1 truncate rounded-lg px-3 py-2 font-mono text-xs">
                    {value}
                </code>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => onCopy(value)}>
                    <IconCopy />
                </Button>
            </div>
        </div>
    )
}

function BackupCodes({
    title,
    description,
    codes,
    copyLabel,
    onCopy,
}: {
    title: string
    description: string
    codes: string[]
    copyLabel: string
    onCopy: (value: string) => void
}) {
    return (
        <div className="grid gap-2">
            <div className="grid gap-1">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-muted-foreground text-sm">{description}</span>
            </div>

            <div className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-3 font-mono text-xs sm:grid-cols-5">
                {codes.map((code) => (
                    <span key={code}>{code}</span>
                ))}
            </div>

            <Button
                type="button"
                size="sm"
                variant="outline"
                className="justify-self-start"
                onClick={() => onCopy(codes.join("\n"))}
            >
                {copyLabel}
                <IconCopy />
            </Button>
        </div>
    )
}
