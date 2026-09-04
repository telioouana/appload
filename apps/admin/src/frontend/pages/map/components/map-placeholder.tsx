"use client"

import { IconMapOff } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { cn } from "@workspace/ui/lib/utils"

type Props = {
    className?: string
    /** Overrides the default "map not configured" copy. */
    message?: string
}

/**
 * What sits where a map would be when we cannot draw one: no browser API key,
 * or a caller that knows the map is pointless for this order. Same footprint
 * as the map itself, so nothing jumps when the key is added.
 */
export function MapPlaceholder({ className, message }: Props) {
    const t = useTranslations("Admin.map.detail")

    return (
        <div
            className={cn(
                "flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/40 p-6 text-center",
                className,
            )}
        >
            <IconMapOff size={20} className="text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{message ?? t("missing-key")}</p>
        </div>
    )
}
