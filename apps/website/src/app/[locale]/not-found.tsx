import { IconMapQuestion } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { Button } from "@workspace/ui/components/button";

import { Link } from "@/i18n/navigation";
import { PageHero } from "@/frontend/components/sections/page-hero";

// Opens on a dark canvas like every route — the transparent fixed header
// needs a dark surface under it on first paint
export default function NotFound() {
    const t = useTranslations("not_found")

    return (
        <>
            <PageHero title={t("title")} subtitle={t("description")} />
            <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
                <IconMapQuestion className="size-14 text-muted-foreground" stroke={1} />
                <Button asChild className="bg-(--brand-red) text-white hover:bg-(--brand-red-hover)">
                    <Link href="/">{t("home")}</Link>
                </Button>
            </div>
        </>
    )
}
