"use client"

import { IconLock, IconLogout } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@workspace/auth/client";

import { Button } from "@workspace/ui/components/button";

/**
 * Rendered instead of the portal shell when the session cannot become a
 * tenant: a staff or driver account, a banned one, or a company Appload has
 * closed. Deliberately a screen and not a redirect: proxy.ts bounces
 * authenticated users off /sign-in, so redirecting there would loop.
 */
export function AccessDenied({ reason }: { reason?: "closed" }) {
    const t = useTranslations("App.access-denied")
    const router = useRouter()

    const onSignOut = async () => {
        await authClient.signOut({
            fetchOptions: {
                onSuccess: () => router.push("/sign-in"),
            },
        })
    }

    return (
        <div className="flex h-svh flex-col items-center justify-center gap-4 p-6 text-center">
            <IconLock className="size-16 text-muted-foreground" stroke={1} />
            <h1 className="font-heading text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
                {reason === "closed" ? t("closed") : t("description")}
            </p>
            <Button variant="outline" onClick={onSignOut}>
                <IconLogout />
                {t("sign-out")}
            </Button>
        </div>
    )
}
