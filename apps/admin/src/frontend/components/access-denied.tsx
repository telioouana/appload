"use client"

import { IconLock, IconLogout } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { useRouter } from "@workspace/i18n/navigation";
import { authClient } from "@workspace/auth/client";

import { Button } from "@workspace/ui/components/button";

/**
 * Rendered by the (protected) layout instead of the admin shell when the
 * session belongs to a non-staff account (driver, shipper, carrier).
 * Deliberately a screen and not a redirect: proxy.ts bounces authenticated
 * users off /sign-in, so redirecting there would loop.
 */
export function AccessDenied() {
    const t = useTranslations("Admin.access-denied")
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
            <p className="max-w-sm text-sm text-muted-foreground">{t("description")}</p>
            <Button variant="outline" onClick={onSignOut}>
                <IconLogout />
                {t("sign-out")}
            </Button>
        </div>
    )
}
