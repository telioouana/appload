"use client"

import { useParams } from "next/navigation";
import { IconCheck, IconLanguage } from "@tabler/icons-react";

import { useLocale, type Locale } from "@workspace/i18n";
import { usePathname, useRouter } from "@workspace/i18n/navigation";

import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu";

// Language names are shown in their own language on purpose — a user who
// doesn't read the current one must still recognise their own.
export const LOCALE_NAMES: Record<Locale, string> = {
    pt: "Português",
    en: "English",
};

/**
 * Re-enters the current route under another locale. With localized
 * pathnames, `usePathname` returns the route template and `params` fills it
 * back in, so dynamic routes (e.g. order details) survive the switch.
 */
export function useLocaleSwitch() {
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const params = useParams();

    function switchTo(next: Locale) {
        if (next === locale) return;

        router.replace(
            // @ts-expect-error -- the pathname/params pair is validated by
            // the runtime; TypeScript cannot narrow the union here (the
            // pattern from the next-intl locale-switcher docs)
            { pathname, params },
            { locale: next },
        );
    }

    return { locale, switchTo };
}

/** Standalone globe dropdown — used on the auth screens. */
export function LocaleSwitcher({ className }: { className?: string }) {
    const { locale, switchTo } = useLocaleSwitch();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className={cn("text-muted-foreground", className)}>
                    <IconLanguage />
                    <span className="sr-only">{LOCALE_NAMES[locale as Locale]}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {(Object.keys(LOCALE_NAMES) as Locale[]).map((code) => (
                    <DropdownMenuItem key={code} onClick={() => switchTo(code)}>
                        {LOCALE_NAMES[code]}
                        {code === locale && <IconCheck className="ml-auto size-4" />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
