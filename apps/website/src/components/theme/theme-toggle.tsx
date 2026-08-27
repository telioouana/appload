"use client"

import { IconMoon, IconSun } from "@tabler/icons-react"
import { useTheme } from "next-themes"

import { useTranslations } from "@workspace/i18n"
import { cn } from "@workspace/ui/lib/utils"

export function ThemeToggle({ onCanvas = false }: { onCanvas?: boolean }) {
    const { resolvedTheme, setTheme } = useTheme()
    const t = useTranslations("header")

    return (
        <button
            type="button"
            aria-label={t("theme")}
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className={cn(
                "flex size-8 items-center justify-center rounded-3xl border transition-colors",
                onCanvas
                    ? "border-white/30 text-white/80 hover:bg-white/10 hover:text-white"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
        >
            {/* Both icons rendered; CSS picks by theme — no hydration flash */}
            <IconSun className="size-4.5 dark:hidden" aria-hidden />
            <IconMoon className="hidden size-4.5 dark:block" aria-hidden />
        </button>
    )
}
