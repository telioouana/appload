"use client"

import { useEffect } from "react";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";

import { Button } from "@workspace/ui/components/button";

// Sits inside the (protected) layout, so the sidebar stays up and the user
// can navigate away even when a page crashes
export default function ProtectedError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    const t = useTranslations("Admin.errors.boundary")

    useEffect(() => {
        console.error(error)
    }, [error])

    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <IconAlertTriangle className="size-16 text-muted-foreground" stroke={1} />
            <h1 className="font-heading text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="max-w-sm text-sm text-muted-foreground">{t("description")}</p>
            <Button onClick={reset}>
                <IconRefresh />
                {t("retry")}
            </Button>
        </div>
    )
}
