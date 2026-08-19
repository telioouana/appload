import { IconMapQuestion } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { Link } from "@workspace/i18n/navigation";

import { Button } from "@workspace/ui/components/button";

export default function NotFound() {
    const t = useTranslations("Admin.errors.not-found")

    return (
        <div className="flex h-svh flex-col items-center justify-center gap-4 p-6 text-center">
            <IconMapQuestion className="size-16 text-muted-foreground" stroke={1} />
            <h1 className="font-heading text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="max-w-sm text-sm text-muted-foreground">{t("description")}</p>
            <Button asChild>
                <Link href="/orders/all">{t("home")}</Link>
            </Button>
        </div>
    )
}
