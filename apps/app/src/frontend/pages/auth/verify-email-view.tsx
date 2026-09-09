"use client";

import { useSearchParams } from "next/navigation";
import { IconMailForward, IconMailOpened } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { Link } from "@/i18n/navigation";
import { authClient } from "@workspace/auth/client";

import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardTitle } from "@workspace/ui/components/card";

import { useResendCooldown } from "@/frontend/pages/auth/hooks/use-resend-cooldown";

/**
 * The waiting room between signing up and being let in. The link in the
 * email hits Better Auth's own `/api/auth/verify-email`, which signs the
 * account in (`autoSignInAfterVerification`) and lands it on `/onboarding` —
 * so nothing on this page has to poll or redirect.
 *
 * Reachable signed in and signed out alike (see src/routes.ts): an account
 * whose address is still unverified is sent here by the protected layout.
 */
export function VerifyEmailView() {
    const t = useTranslations("App.auth")

    const searchParams = useSearchParams()
    const email = searchParams.get("email")

    const { isSending, secondsLeft, resend } = useResendCooldown(async () => {
        if (!email) return false

        const { error } = await authClient.sendVerificationEmail({
            email,
            callbackURL: "/onboarding",
        })

        if (error) {
            toast.error(t("verify.error"))
            return false
        }

        toast.success(t("verify.resent"))
        return true
    })

    return (
        <Card className="overflow-hidden p-0 shadow-none text-card-foreground md:shadow-xl w-full">
            <CardContent className="grid gap-6 p-6 md:p-8">
                <div className="flex flex-col gap-2">
                    <IconMailOpened className="size-10 text-muted-foreground" stroke={1} />
                    <CardTitle className="text-2xl font-bold">{t("verify.title")}</CardTitle>
                    <CardDescription className="text-muted-foreground text-balance">
                        {email
                            ? t("verify.description", { email })
                            : t("verify.description-generic")}
                    </CardDescription>
                </div>

                <p className="text-sm text-muted-foreground">{t("verify.hint")}</p>

                {/* Resending needs an address, and the only one this page has
                    is the query param it was opened with */}
                {email && (
                    <Button
                        type="button"
                        variant="outline"
                        onClick={resend}
                        disabled={isSending || secondsLeft > 0}
                    >
                        <IconMailForward />
                        {secondsLeft > 0
                            ? t("verify.resend-wait", { seconds: secondsLeft })
                            : t("verify.resend")}
                    </Button>
                )}

                <Link
                    href="/sign-in"
                    className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                    {t("verify.sign-in")}
                </Link>
            </CardContent>
        </Card>
    )
}
