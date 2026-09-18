import { IconMapQuestion } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { getTranslations } from "@workspace/i18n/server";
import { Link } from "@/i18n/navigation";

import { Button } from "@workspace/ui/components/button";

// Next drops the metadata of a segment that throws notFound(), so the tab
// for a 404 is named here rather than in the catch-all page
export async function generateMetadata() {
    const t = await getTranslations("Admin.errors.not-found");

    return { title: t("title") };
}

export default function NotFound() {
    const t = useTranslations("Admin.errors.not-found")

    return (
        <div className="flex h-svh flex-col items-center justify-center gap-4 p-6 text-center">
            <IconMapQuestion className="size-16 text-muted-foreground" stroke={1} />
            <h1 className="font-heading text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="max-w-sm text-sm text-muted-foreground">{t("description")}</p>
            <Button asChild>
                <Link href="/dashboard">{t("home")}</Link>
            </Button>
        </div>
    )
}
