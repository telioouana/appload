"use client"

import { z } from "zod"
import { toast } from "sonner"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconAlertCircle, IconBrandGoogleFilled, IconKey, IconLink, IconRefresh, IconTrash } from "@tabler/icons-react"

import { authClient } from "@workspace/auth/client"
import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { PasswordInput } from "@workspace/ui/inputs/password"
import { FieldGroup, FieldSet } from "@workspace/ui/components/field"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@workspace/ui/components/alert-dialog"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@/lib/trpc-error"
import { SetPasswordSchema } from "@/backend/schemas/settings"

import { SIGN_IN_METHODS_KEY, useSignInMethods } from "../hooks/use-sign-in-methods"

type SessionUser = typeof authClient.$Infer.Session.user

const SPREADSHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"

/**
 * The link redirect reports failures as an `error` query param on a fresh
 * page load, never through a rejected promise — the checks run in Better
 * Auth's OAuth *callback*, not at /link-social. Codes are mapped to slugs
 * because one of them contains an apostrophe and would be a hostile
 * message key.
 */
const LINK_ERROR_KEYS = {
    "unable_to_link_account": "untrusted",
    "email_doesn't_match": "emailMismatch",
    "account_already_linked_to_different_user": "otherUser",
    "state_mismatch": "expired",
    "access_denied": "cancelled",
} as const

// Kept a literal union rather than `string`, so the message key stays
// checkable against the catalogue
type LinkErrorKey = (typeof LINK_ERROR_KEYS)[keyof typeof LINK_ERROR_KEYS] | "default"

const SET_PASSWORD_CODES = ["PASSWORD_ALREADY_SET", "PASSWORD_TOO_SHORT", "SET_PASSWORD_FAILED"] as const

/**
 * The inventory of ways into this account. The cards below it operate on
 * individual entries; this one is what makes a missing method visible —
 * a social-only user has no way to discover that a password is possible
 * unless the empty slot says so.
 *
 * Two rules are enforced here that Better Auth will not enforce for us:
 * the last remaining method cannot be removed (it will, but the error is
 * opaque), and the password cannot be removed while 2FA is on (Better Auth
 * happily deletes it, and the user is then permanently unable to turn 2FA
 * off — `shouldRequirePassword` returns true unconditionally under the
 * current bare `twoFactor()` config).
 */
export function SignInMethodsCard({ user }: { user: SessionUser }) {
    const t = useTranslations("Admin.settings")
    const f = useFormatter()

    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { isPending, isError, refetch, credential, google, hasPassword, canUnlink } = useSignInMethods()

    const [adding, setAdding] = useState(false)
    const [confirming, setConfirming] = useState<"credential" | "google" | null>(null)
    const [unlinking, setUnlinking] = useState(false)
    const [linking, setLinking] = useState(false)
    const [banner, setBanner] = useState<string | null>(null)

    const setPassword = useMutation(trpc.settings.setPassword.mutationOptions())

    const FormSchema = useMemo(() => SetPasswordSchema(t), [t])
    type TypeSchema = z.infer<typeof FormSchema>

    const form = useForm<TypeSchema>({
        resolver: zodResolver(FormSchema),
        defaultValues: { newPassword: "", confirmPassword: "" },
    })

    // The OAuth link returns via a full page load, so its outcome arrives as a
    // query param rather than a resolved promise. Read from `window.location`
    // rather than `useSearchParams()` so this page needs no Suspense boundary,
    // and strip the param so a refresh does not replay the outcome.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const error = params.get("error")
        const linked = params.get("linked")

        if (!error && !linked) return

        if (error) {
            const slug: LinkErrorKey = LINK_ERROR_KEYS[error as keyof typeof LINK_ERROR_KEYS] ?? "default"

            // Deriving this during render instead would read `window` on the
            // server (undefined) and again on the client (a string), which is
            // a hydration mismatch. A mount-time read of a browser API is the
            // case this rule cannot express; it runs once and never cascades.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setBanner(t(`methods.errors.${slug}`))
        } else if (linked) {
            toast(t("methods.google.linked"))
        }

        window.history.replaceState(null, "", window.location.pathname)
    }, [t])

    async function onAddPassword(data: TypeSchema) {
        try {
            await setPassword.mutateAsync({ newPassword: data.newPassword })
        } catch (error) {
            const code = domainErrorCode(error, SET_PASSWORD_CODES, "SET_PASSWORD_FAILED")

            if (code === "PASSWORD_ALREADY_SET") {
                // The list was stale — another tab got there first
                form.setError("newPassword", { message: t("methods.password.already") })
                await queryClient.invalidateQueries({ queryKey: SIGN_IN_METHODS_KEY })
                return
            }

            toast(t("methods.password.failed"))
            return
        }

        form.reset()
        setAdding(false)
        await queryClient.invalidateQueries({ queryKey: SIGN_IN_METHODS_KEY })
        toast(t("methods.password.success"))
    }

    function onLinkGoogle() {
        setLinking(true)

        // `callbackURL` is not optional here: `generateState` falls back to
        // `context.options.baseURL`, which this app sets to an object — it
        // would stringify into the redirect target. Relative paths pass the
        // origin check, and taking the path from the browser keeps the
        // localized route (/settings vs /definicoes) intact.
        authClient.linkSocial({
            provider: "google",
            callbackURL: `${window.location.pathname}?linked=google`,
            errorCallbackURL: window.location.pathname,
            // Same conditional scope as sign-in: the spreadsheets scope is
            // pending Google verification
            scopes: process.env.NEXT_PUBLIC_GOOGLE_SHEETS_AUTH_MODE === "service-account"
                ? undefined
                : [SPREADSHEETS_SCOPE],
        })
    }

    async function onUnlink() {
        if (!confirming) return

        const providerId = confirming
        const method = t(providerId === "credential" ? "methods.password.title" : "methods.google.title")

        setUnlinking(true)

        try {
            const { error } = await authClient.unlinkAccount({ providerId })

            if (error) {
                // Still branch on the server's code even though the button is
                // disabled for the last method: a second tab could have
                // unlinked in between
                if (error.code === "FAILED_TO_UNLINK_LAST_ACCOUNT") toast(t("methods.unlink.last"))
                else if (error.code === "SESSION_NOT_FRESH") toast(t("methods.unlink.stale"))
                else toast(t("methods.unlink.failed", { method }))
                return
            }

            await queryClient.invalidateQueries({ queryKey: SIGN_IN_METHODS_KEY })
            toast(t("methods.unlink.success", { method }))
        } finally {
            setUnlinking(false)
            setConfirming(null)
        }
    }

    // 2FA is confirmed with the password, and Better Auth will not let it be
    // disabled without one — removing the password would strand the account
    const passwordLocked = Boolean(user.twoFactorEnabled)

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("methods.title")}</CardTitle>
                <CardDescription>{t("methods.description")}</CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
                {banner && (
                    <Alert variant="destructive">
                        <IconAlertCircle />
                        <AlertTitle>{banner}</AlertTitle>
                    </Alert>
                )}

                {isPending ? (
                    <>
                        <Skeleton className="h-20 w-full rounded-2xl" />
                        <Skeleton className="h-20 w-full rounded-2xl" />
                    </>
                ) : isError ? (
                    // Never guess at what is linked — show nothing and offer a retry
                    <Alert variant="destructive">
                        <IconAlertCircle />
                        <AlertTitle>{t("methods.loadFailed")}</AlertTitle>
                        <AlertDescription>
                            <Button type="button" size="sm" variant="outline" onClick={() => refetch()}>
                                {t("methods.retry")}
                                <IconRefresh />
                            </Button>
                        </AlertDescription>
                    </Alert>
                ) : (
                    <>
                        <MethodRow
                            icon={<IconKey className="size-5" stroke={1.5} />}
                            title={t("methods.password.title")}
                            detail={hasPassword
                                ? t("methods.password.active", { email: user.email })
                                : t("methods.password.inactive")}
                            meta={credential ? t("methods.added", { date: f.dateTime(new Date(credential.createdAt), { dateStyle: "medium" }) }) : null}
                            status={
                                <Badge variant={hasPassword ? "default" : "outline"}>
                                    {t(hasPassword ? "methods.status.active" : "methods.status.inactive")}
                                </Badge>
                            }
                            reason={
                                hasPassword && !canUnlink ? t("methods.unlink.last")
                                    : hasPassword && passwordLocked ? t("methods.unlink.twoFactor")
                                        : null
                            }
                            action={hasPassword ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={!canUnlink || passwordLocked}
                                    onClick={() => setConfirming("credential")}
                                >
                                    {t("methods.unlink.action")}
                                    <IconTrash />
                                </Button>
                            ) : !adding ? (
                                <Button type="button" size="sm" onClick={() => setAdding(true)}>
                                    {t("methods.password.add")}
                                    <IconKey />
                                </Button>
                            ) : null}
                        />

                        {adding && !hasPassword && (
                            <form onSubmit={form.handleSubmit(onAddPassword)} className="rounded-2xl border p-4">
                                <FieldGroup>
                                    <FieldSet>
                                        <FieldGroup>
                                            <PasswordInput
                                                name="newPassword"
                                                control={form.control}
                                                isPending={form.formState.isSubmitting}
                                                label={t("methods.password.new.label")}
                                                placeholder={t("methods.password.new.placeholder")}
                                                description={t("methods.password.new.description")}
                                            />

                                            <PasswordInput
                                                name="confirmPassword"
                                                control={form.control}
                                                isPending={form.formState.isSubmitting}
                                                label={t("methods.password.confirm.label")}
                                                placeholder={t("methods.password.confirm.placeholder")}
                                            />

                                            <div className="flex gap-2">
                                                <Button disabled={form.formState.isSubmitting}>
                                                    {t("methods.password.submit")}
                                                    {form.formState.isSubmitting ? <Spinner /> : <IconKey />}
                                                </Button>

                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    disabled={form.formState.isSubmitting}
                                                    onClick={() => {
                                                        form.reset()
                                                        setAdding(false)
                                                    }}
                                                >
                                                    {t("methods.password.cancel")}
                                                </Button>
                                            </div>
                                        </FieldGroup>
                                    </FieldSet>
                                </FieldGroup>
                            </form>
                        )}

                        <MethodRow
                            icon={<IconBrandGoogleFilled className="size-5" stroke={1.5} />}
                            title={t("methods.google.title")}
                            detail={google
                                ? t("methods.google.active", { email: user.email })
                                : t("methods.google.inactive")}
                            meta={google ? t("methods.added", { date: f.dateTime(new Date(google.createdAt), { dateStyle: "medium" }) }) : null}
                            status={
                                <Badge variant={google ? "default" : "outline"}>
                                    {t(google ? "methods.status.active" : "methods.status.inactive")}
                                </Badge>
                            }
                            reason={google && !canUnlink ? t("methods.unlink.last") : null}
                            action={google ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={!canUnlink}
                                    onClick={() => setConfirming("google")}
                                >
                                    {t("methods.unlink.action")}
                                    <IconTrash />
                                </Button>
                            ) : (
                                <Button type="button" size="sm" disabled={linking} onClick={onLinkGoogle}>
                                    {t("methods.google.link")}
                                    {linking ? <Spinner /> : <IconLink />}
                                </Button>
                            )}
                        />
                    </>
                )}
            </CardContent>

            <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t("methods.unlink.title", {
                                method: t(confirming === "credential" ? "methods.password.title" : "methods.google.title"),
                            })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>{t("methods.unlink.description")}</AlertDialogDescription>
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={unlinking}>{t("methods.unlink.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={unlinking}
                            onClick={(event) => {
                                // Kept open until the request settles, so the
                                // outcome is not reported to a closed dialog
                                event.preventDefault()
                                void onUnlink()
                            }}
                        >
                            {t("methods.unlink.confirm")}
                            {unlinking && <Spinner />}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    )
}

/**
 * One sign-in method. Present methods and absent ones use the same row so
 * the absent one reads as a slot to fill rather than as missing UI.
 * `reason` is why the action is disabled — never a bare greyed-out button.
 */
function MethodRow({
    icon,
    title,
    detail,
    meta,
    status,
    reason,
    action,
}: {
    icon: React.ReactNode
    title: string
    detail: string
    meta: string | null
    status: React.ReactNode
    reason: string | null
    action: React.ReactNode
}) {
    return (
        <div className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start">
            <div className="text-muted-foreground shrink-0 pt-0.5">{icon}</div>

            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{title}</span>
                    {status}
                </div>

                <p className="text-muted-foreground text-sm">{detail}</p>
                {meta && <p className="text-muted-foreground text-xs">{meta}</p>}
                {reason && <p className="text-muted-foreground text-xs">{reason}</p>}
            </div>

            {action && <div className="shrink-0">{action}</div>}
        </div>
    )
}
