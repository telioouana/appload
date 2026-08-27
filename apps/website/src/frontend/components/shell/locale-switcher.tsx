"use client"

import { useLocale } from "@workspace/i18n"
import { LOCALES } from "@workspace/i18n/locales"
import { cn } from "@workspace/ui/lib/utils"

import { Link, usePathname } from "@/i18n/navigation"

// Real links (not buttons) so crawlers can discover both language
// versions; next-intl's Link also stores the choice in the NEXT_LOCALE
// cookie, which the proxy reads to route returning visitors.
export function LocaleSwitcher({ className, onCanvas = false }: { className?: string; onCanvas?: boolean }) {
    const locale = useLocale()
    const pathname = usePathname()

    return (
        <div
            className={cn(
                "flex items-center rounded-3xl border p-0.5 text-xs font-medium transition-colors",
                onCanvas ? "border-white/30" : "border-border",
                className,
            )}
        >
            {LOCALES.map((entry) => (
                <Link
                    key={entry}
                    href={pathname}
                    locale={entry}
                    hrefLang={entry}
                    aria-current={entry === locale ? "true" : undefined}
                    className={cn(
                        "rounded-3xl px-2.5 py-1 uppercase transition-colors",
                        entry === locale
                            ? onCanvas
                                ? "bg-white text-(--canvas)"
                                : "bg-foreground text-background"
                            : onCanvas
                                ? "text-white/60 hover:text-white"
                                : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    {entry}
                </Link>
            ))}
        </div>
    )
}
